// Scheduler for the health template, deployed as `{px}-health` with verify_jwt=false.
// GitHub Actions calls it about every 15 minutes with the same HMAC header as the nightly
// digest. Each notice is sent at most once a day, so late or repeated runs are harmless.
import { digestKey } from '../_shared/digest.ts';
import {
  DISCLAIMER,
  dueSlots,
  eveningDue,
  missedSlots,
  reminders,
  taipei,
  weeklyDue,
} from '../_shared/health.ts';
import { notifyCaregivers } from '../_shared/health-api.ts';
import { lineClient, statelessToken } from '../_shared/line.ts';
import { noticeCard } from '../_shared/onboarding.ts';
import { db, env, onceToday, ownerId, T } from '../_shared/store.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status });
const avg = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

async function weeklyText(perDay: number) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: rows }, { data: done }, { data: scan }] = await Promise.all([
    db.from(T('h_measures')).select('kind,v1,v2,flagged').gte('measured_at', since),
    db.from(T('h_done')).select('day').gte('day', since.slice(0, 10)),
    db
      .from(T('h_scans'))
      .select('total,report')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const of = (k: string) => (rows ?? []).filter((r: any) => r.kind === k);
  const bp = of('bp'),
    glu = of('glucose');
  const lines = [
    bp.length
      ? `血壓 ${bp.length} 次，平均 ${avg(bp.map((r: any) => +r.v1))}/${avg(bp.map((r: any) => +r.v2))}`
      : '血壓：這週沒有紀錄',
    glu.length
      ? `血糖 ${glu.length} 次，平均 ${avg(glu.map((r: any) => +r.v1))}`
      : '血糖：這週沒有紀錄',
    `超出範圍 ${(rows ?? []).filter((r: any) => r.flagged).length} 次`,
    perDay ? `提醒完成 ${Math.round(((done ?? []).length / (perDay * 7)) * 100)}%` : '',
    scan ? `最近看健 ${scan.total} 分・${scan.report?.constitution?.type ?? ''}` : '',
  ].filter(Boolean);
  return `${lines.join('\n')}\n\n${DISCLAIMER}`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  const secret = env('LINE_MSG_SECRET');
  const today = new Date().toISOString().slice(0, 10);
  if (!secret || req.headers.get('x-oaw-digest') !== (await digestKey(secret, today)))
    return json({ error: 'unauthorized' }, 401);
  const owner = await ownerId();
  const { data: profile } = await db.from(T('h_profile')).select('*').eq('id', 1).maybeSingle();
  if (!owner || !profile?.consent_at) return json({ skipped: 'not_ready' });

  const line = lineClient(await statelessToken(env('LINE_MSG_ID'), secret));
  const { day, time } = taipei();
  const list = reminders(profile.reminders);
  const sent: string[] = [];

  for (const r of dueSlots(list, time))
    if (await onceToday(`rem:${r.slot}`)) {
      await line.push(owner, [
        noticeCard(r.kind === 'med' ? '💊 吃藥時間' : '🩺 量測時間', `${r.time}　${r.label}`, {
          label: '完成了',
          data: `h-done:${r.slot}`,
          text: '完成了',
        }),
      ]);
      sent.push(`rem:${r.slot}`);
    }

  const { data: doneRows } = await db.from(T('h_done')).select('slot').eq('day', day);
  const done = (doneRows ?? []).map((d: any) => d.slot);
  for (const r of missedSlots(list, time, done))
    if (await onceToday(`missed:${r.slot}`)) {
      await notifyCaregivers('missed', [
        noticeCard('提醒還沒完成', `「${r.label}」（${r.time}）到現在還沒有回覆，可以關心一下。`),
      ]);
      sent.push(`missed:${r.slot}`);
    }

  if (eveningDue(time) && (await onceToday('events'))) {
    const tomorrow = taipei(new Date(Date.now() + 864e5)).day;
    const { data: events } = await db
      .from(T('h_events'))
      .select('time,title')
      .eq('day', tomorrow)
      .order('time');
    if (events?.length) {
      const text = events.map((e: any) => `${e.time || '全天'}　${e.title}`).join('\n');
      const card = noticeCard('📅 明天的行程', text);
      await line.push(owner, [card]);
      await notifyCaregivers('alert', [card]);
      sent.push('events');
    }
  }

  if (weeklyDue() && (await onceToday('weekly'))) {
    const card = noticeCard('📋 本週健康週報', await weeklyText(list.length));
    await line.push(owner, [card]);
    await notifyCaregivers('weekly', [card]);
    sent.push('weekly');
  }
  return json({ ok: true, sent });
});
