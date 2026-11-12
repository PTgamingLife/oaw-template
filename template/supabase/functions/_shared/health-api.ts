// LIFF actions for the health template, called from {px}-api after the ID token check.
// The owner (elder) can do everything; an active caregiver can read 今天 (only when the
// elder agreed to share) and use the shared calendar. Everyone else is refused.
import {
  DISCLAIMER,
  describe,
  flagReason,
  measure,
  notifySettings,
  reminders,
  taipei,
  thresholds,
} from './health.ts';
import { lineClient, statelessToken } from './line.ts';
import { noticeCard } from './onboarding.ts';
import { apricoKey, db, env, ownerId, T } from './store.ts';

type Role = 'owner' | 'caregiver' | 'none';
const fail = (code: string) => {
  throw Error(code);
};
const ymd = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function profile() {
  const { data } = await db.from(T('h_profile')).select('*').eq('id', 1).maybeSingle();
  return data ?? { consent_at: null, share_at: null, thresholds: {}, reminders: null };
}

export async function healthRole(userId: string): Promise<Role> {
  if ((await ownerId()) === userId) return 'owner';
  const { data } = await db
    .from(T('h_caregivers'))
    .select('status')
    .eq('line_user_id', userId)
    .maybeSingle();
  return data?.status === 'active' ? 'caregiver' : 'none';
}

/** Push to caregivers who want this kind of notice. Failures never block the elder. */
export async function notifyCaregivers(kind: 'alert' | 'missed' | 'weekly', messages: unknown[]) {
  const p = await profile();
  if (!p.share_at) return 0;
  const { data } = await db
    .from(T('h_caregivers'))
    .select('line_user_id,notify')
    .eq('status', 'active');
  const to = (data ?? []).filter((c: any) => notifySettings(c.notify)[kind]);
  if (!to.length) return 0;
  const line = lineClient(await statelessToken(env('LINE_MSG_ID'), env('LINE_MSG_SECRET')));
  await Promise.all(to.map((c: any) => line.push(c.line_user_id, messages).catch(() => {})));
  return to.length;
}

/** Save one measurement; alerts caregivers when it is outside the elder's range. */
export async function saveMeasure(raw: unknown) {
  const m = measure(raw) ?? fail('measure_invalid');
  const p = await profile();
  const reason = flagReason(m!, thresholds(p.thresholds));
  await db.from(T('h_measures')).insert({ ...m, flagged: Boolean(reason) });
  if (reason)
    await notifyCaregivers('alert', [
      noticeCard('⚠️ 數值提醒', `${reason}\n記錄時間 ${taipei().time}\n\n${DISCLAIMER}`),
    ]);
  return { saved: describe(m!), flagged: reason };
}

async function latest(kind: string) {
  const { data } = await db
    .from(T('h_measures'))
    .select('v1,v2,v3,tag,flagged,measured_at')
    .eq('kind', kind)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function state(role: Role) {
  const p = await profile();
  const { day } = taipei();
  const month = day.slice(0, 7);
  const [{ data: done }, { data: scan }, { data: events }] = await Promise.all([
    db.from(T('h_done')).select('slot').eq('day', day),
    db
      .from(T('h_scans'))
      .select('total,report,created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from(T('h_events'))
      .select('id,day,time,title')
      .gte('day', `${month}-01`)
      .order('day')
      .limit(200),
  ]);
  const shared = role === 'owner' || Boolean(p.share_at);
  const list = reminders(p.reminders);
  const doneSlots = (done ?? []).map((d: any) => d.slot);
  const out: Record<string, unknown> = {
    role,
    consent: Boolean(p.consent_at),
    share: Boolean(p.share_at),
    day,
    events: events ?? [],
  };
  if (shared)
    Object.assign(out, {
      today: list.map((r, slot) => ({ ...r, slot, done: doneSlots.includes(slot) })),
      latest: {
        bp: await latest('bp'),
        glucose: await latest('glucose'),
        weight: await latest('weight'),
      },
      scan: scan
        ? {
            total: scan.total,
            constitution: scan.report?.constitution?.type ?? '',
            at: scan.created_at,
          }
        : null,
    });
  if (role === 'owner') {
    const { data: cg } = await db
      .from(T('h_caregivers'))
      .select('line_user_id,display_name,status,notify');
    Object.assign(out, {
      thresholds: thresholds(p.thresholds),
      reminders: list,
      caregivers: (cg ?? []).map((c: any) => ({
        id: c.line_user_id,
        name: c.display_name || '家人',
        status: c.status,
        notify: notifySettings(c.notify),
      })),
    });
  }
  return out;
}

async function scan(body: any) {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) fail('aprico_not_connected');
  const res = await fetch(`${base}/health-scan`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: `scan-${crypto.randomUUID()}`,
      face: body.face,
      tongue: body.tongue,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (res.status === 402) fail('points_insufficient');
  if (res.status === 429) fail('rate_limited');
  if (!res.ok) fail('scan_failed');
  const { report } = await res.json();
  // Only the report text is kept; the photos were never stored.
  await db.from(T('h_scans')).insert({ total: report.score.total, report });
  return { report };
}

async function sha256(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function healthAction(action: string, body: any, userId: string) {
  const role = await healthRole(userId);
  if (role === 'none') fail('health_forbidden');
  const owner = role === 'owner';
  const p = owner ? await profile() : null;
  const needConsent = () => p?.consent_at || fail('consent_required');
  switch (action) {
    case 'h_state':
      return state(role);
    case 'h_consent': {
      if (!owner || body.agree !== true) fail('health_forbidden');
      const now = new Date().toISOString();
      await db
        .from(T('h_profile'))
        .upsert({
          id: 1,
          consent_at: p!.consent_at ?? now,
          share_at: body.share === true ? now : null,
        });
      return state(role);
    }
    case 'h_measure':
      if (!owner) fail('health_forbidden');
      needConsent();
      return saveMeasure(body.measure);
    case 'h_done': {
      if (!owner || !Number.isInteger(body.slot) || body.slot < 0 || body.slot > 7)
        fail('health_forbidden');
      await db.from(T('h_done')).upsert({ day: taipei().day, slot: body.slot });
      return state(role);
    }
    case 'h_scan':
      if (!owner) fail('health_forbidden');
      needConsent();
      return scan(body);
    case 'h_event_add': {
      const title = String(body.title ?? '')
        .trim()
        .slice(0, 40);
      const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time) ? body.time : '';
      if (!ymd(body.day) || !title) fail('event_invalid');
      await db.from(T('h_events')).insert({ day: body.day, time, title, created_by: userId });
      return state(role);
    }
    case 'h_event_del':
      if (!Number.isInteger(body.id)) fail('event_invalid');
      // Caregivers can only remove what they added themselves.
      await (owner
        ? db.from(T('h_events')).delete().eq('id', body.id)
        : db.from(T('h_events')).delete().eq('id', body.id).eq('created_by', userId));
      return state(role);
    case 'h_settings':
      if (!owner) fail('health_forbidden');
      await db
        .from(T('h_profile'))
        .upsert({
          id: 1,
          thresholds: thresholds(body.thresholds),
          reminders: reminders(body.reminders),
        });
      return state(role);
    case 'h_invite': {
      if (!owner) fail('health_forbidden');
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(
        6,
        '0',
      );
      await db
        .from(T('h_profile'))
        .upsert({
          id: 1,
          invite_hash: await sha256(`family:${code}`),
          invite_expires: new Date(Date.now() + 864e5).toISOString(),
        });
      return { code, text: `家人 ${code}` };
    }
    case 'h_caregiver': {
      if (!owner || typeof body.id !== 'string') fail('health_forbidden');
      const q = db.from(T('h_caregivers'));
      if (body.remove === true) await q.delete().eq('line_user_id', body.id);
      else if (body.approve === true)
        await q.update({ status: 'active' }).eq('line_user_id', body.id);
      else await q.update({ notify: notifySettings(body.notify) }).eq('line_user_id', body.id);
      return state(role);
    }
  }
  fail('unknown_action');
}
