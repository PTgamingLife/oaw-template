// Nightly digest for one OA app. Deployed as `{px}-digest` (verify_jwt=false) and called
// by the repo's oaw-nightly workflow. Auth: HMAC of the date with the LINE channel secret,
// which both the workflow (GitHub secret) and this function (Supabase secret) already hold.
import { lineClient, statelessToken } from '../_shared/line.ts';
import { digestCard, digestKey, digestRows } from '../_shared/digest.ts';
import { noticeCard, quotaCard } from '../_shared/onboarding.ts';
import {
  env,
  markProcessed,
  onceToday,
  ownerId,
  pendingMessages,
  purgeOldMessages,
  saveRecords,
} from '../_shared/store.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  const secret = env('LINE_MSG_SECRET');
  const today = new Date().toISOString().slice(0, 10);
  const given = req.headers.get('x-oaw-digest') ?? '';
  if (!secret || given !== (await digestKey(secret, today)))
    return json({ error: 'unauthorized' }, 401);

  await purgeOldMessages();
  const base = env('APRICO_URL'),
    key = env('APRICO_KEY'),
    owner = await ownerId();
  if (!base || !key || !owner) return json({ skipped: 'not_configured' });
  const msgs = await pendingMessages();
  if (!msgs.length) return json({ messages: 0 });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
  const res = await fetch(`${base}/digest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: `digest-${today}-${msgs[0].id}`,
      messages: msgs.map((m) => ({
        at: fmt(m.sent_at),
        who: m.is_owner ? 'owner' : 'friend',
        text: m.text,
      })),
    }),
  });
  const token = await statelessToken(env('LINE_MSG_ID'), secret);
  const line = lineClient(token);
  if (res.status === 402) {
    if (await onceToday('quota'))
      await line.push(owner, [
        noticeCard('今天的紀錄先保留', '額度恢復後會一起整理，不會遺漏。'),
        quotaCard(env('APRICO_SUBSCRIBE_URL')),
      ]);
    return json({ error: 'points_insufficient' }, 402);
  }
  if (!res.ok) return json({ error: 'aprico_failed', status: res.status }, 502);
  const digest = await res.json();
  await saveRecords(digestRows(digest));
  await markProcessed(msgs.map((m) => m.id));
  const card = digestCard(digest, env('LIFF_URL'));
  if (card) await line.push(owner, [card]);
  return json({ messages: msgs.length, records: digestRows(digest).length });
});
