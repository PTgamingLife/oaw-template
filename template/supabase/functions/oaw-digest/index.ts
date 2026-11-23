// Nightly digest for one OA app. Deployed as `{px}-digest` (verify_jwt=false) and called
// by the repo's oaw-nightly workflow. Auth: HMAC of the date with the LINE channel secret,
// which both the workflow (GitHub secret) and this function (Supabase secret) already hold.
import { lineClient, statelessToken } from '../_shared/line.ts';
import { digestCard, digestKey, digestRows, mergeDigests } from '../_shared/digest.ts';
import { noticeCard, quotaCard } from '../_shared/onboarding.ts';
import { autoSend } from '../_shared/links.ts';
import {
  apricoKey,
  env,
  markProcessed,
  onceToday,
  ownerId,
  pendingMessages,
  pendingSources,
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
    key = await apricoKey(),
    owner = await ownerId();
  if (!base || !key || !owner) return json({ skipped: 'not_configured' });
  const sources = (await pendingSources()).slice(0, 8);
  if (!sources.length) return json({ messages: 0 });

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' }).slice(0, 16);
  const token = await statelessToken(env('LINE_MSG_ID'), secret);
  const line = lineClient(token);
  // Each chat (a group, or the owner's own notes) is read separately so its records keep
  // their source; the owner still gets one card for the whole day.
  const digests = [];
  let count = 0,
    records = 0;
  for (const src of sources) {
    const msgs = await pendingMessages(9000, src);
    if (!msgs.length) continue;
    const res = await fetch(`${base}/digest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: `digest-${today}-${src.slice(-10)}-${msgs[0].id}`,
        messages: msgs.map((m) => ({
          at: fmt(m.sent_at),
          who: m.is_owner ? 'owner' : 'friend',
          text: m.text,
        })),
      }),
    });
    if (res.status === 402) {
      if (await onceToday('quota'))
        await line.push(owner, [
          noticeCard('今天的紀錄先保留', '額度恢復後會一起整理，不會遺漏。'),
          quotaCard(env('APRICO_SUBSCRIBE_URL')),
        ]);
      break;
    }
    if (!res.ok) continue;
    const digest = await res.json();
    const rows = digestRows(digest, src);
    await saveRecords(rows);
    await markProcessed(msgs.map((m) => m.id));
    digests.push(digest);
    count += msgs.length;
    records += rows.length;
  }
  if (!digests.length) return json({ messages: 0, error: 'nothing_processed' });
  const digest = mergeDigests(digests);
  const card = digestCard(digest, env('LIFF_URL'));
  if (card) await line.push(owner, [card]);
  // Copies to linked accounts that opened them (each side's scope is checked by Aprico).
  const linked = await autoSend(digest).catch(() => 0);
  return json({ messages: count, records, linked });
});
