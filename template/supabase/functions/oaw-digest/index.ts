// Timed work for one OA app. Deployed as `{px}-digest` (verify_jwt=false). Two callers:
//  - this app's database (pg_cron → {px}_tick): header x-oaw-tick is a one-use token whose
//    hash the database stored; body { job } names the nightly organise run or one timed
//    puzzle piece (定時推播 / 提醒 / 統計截止).
//  - the repo's older oaw-nightly workflow: header x-oaw-digest, an HMAC of the date with the
//    LINE channel secret. It only runs the nightly organise.
import { lineClient, statelessToken } from '../_shared/line.ts';
import { digestCard, digestKey, digestRows, mergeDigests } from '../_shared/digest.ts';
import { aprDigest, fmt } from '../_shared/groups.ts';
import { sha256Hex } from '../_shared/logic.ts';
import { noticeCard, quotaCard } from '../_shared/onboarding.ts';
import { autoSend } from '../_shared/links.ts';
import { loadOrbs } from '../_shared/orbs.ts';
import { orbClaims, orbFor, pieceOf } from '../_shared/orb-logic.ts';
import { runJob } from '../_shared/orb-run.ts';
import {
  apricoKey,
  db,
  env,
  markProcessed,
  onceToday,
  ownerId,
  pendingMessages,
  pendingSources,
  purgeOldMessages,
  saveRecords,
  T,
} from '../_shared/store.ts';

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** The job a one-use tick was made for, or '' when the token is unknown, used or expired. */
async function tickJob(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return '';
  const { data } = await db
    .from(T('ticks'))
    .delete()
    .eq('token_hash', await sha256Hex(token))
    .gt('expires_at', new Date().toISOString())
    .select('job');
  return typeof data?.[0]?.job === 'string' ? data[0].job : '';
}

async function organise(owner: string, line: ReturnType<typeof lineClient>) {
  await purgeOldMessages();
  if (!env('APRICO_URL') || !(await apricoKey())) return { skipped: 'not_configured' };
  const orbs = await loadOrbs().catch(() => []);
  const today = new Date().toISOString().slice(0, 10);
  // Each chat (a group, or the owner's own notes) is read separately so its records keep
  // their source. A chat with an orb is organised only while that orb is lit and has 整理.
  const digests = [];
  let count = 0,
    records = 0;
  for (const src of (await pendingSources()).slice(0, 8)) {
    const target = src === owner ? 'me' : src;
    const orb = orbFor(orbs, target);
    if (orbClaims(orbs, target) && !pieceOf(orb, 'organize')) continue;
    const msgs = await pendingMessages(9000, src);
    if (!msgs.length) continue;
    const { status, digest } = await aprDigest(
      `digest-${today}-${src.slice(-10)}-${msgs[0].id}`,
      msgs.map((m) => ({ at: fmt(m.sent_at), who: m.is_owner ? 'owner' : 'friend', text: m.text })),
      String(pieceOf(orb, 'record')?.params?.topic ?? ''),
      // 整理分類: the owner's wish for how things are sorted.
      String(pieceOf(orb, 'organize')?.params?.how ?? ''),
    );
    if (status === 402) {
      if (await onceToday('quota'))
        await line.push(owner, [
          noticeCard('今天的紀錄先保留', '額度恢復後會一起整理，不會遺漏。'),
          quotaCard(env('APRICO_SUBSCRIBE_URL')),
        ]);
      break;
    }
    if (!digest) continue;
    const rows = digestRows(digest, src);
    await saveRecords(rows);
    await markProcessed(msgs.map((m) => m.id));
    count += msgs.length;
    records += rows.length;
    // A chat whose orb has its own 定時推播 announces itself; the others go on tonight's card.
    if (!pieceOf(orb, 'push')) digests.push(digest);
  }
  if (!count) return { messages: 0 };
  let linked = 0;
  if (digests.length) {
    const digest = mergeDigests(digests);
    const card = digestCard(digest, env('LIFF_URL'));
    if (card) await line.push(owner, [card]);
    // Copies to linked accounts that opened them (each side's scope is checked by Aprico).
    linked = await autoSend(digest).catch(() => 0);
  }
  return { messages: count, records, linked };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'not_found' }, 404);
  const secret = env('LINE_MSG_SECRET');
  const tick = req.headers.get('x-oaw-tick') ?? '';
  let job = 'digest';
  if (tick) {
    const body = await req.json().catch(() => ({}));
    job = await tickJob(tick);
    if (!job || job !== body?.job) return json({ error: 'unauthorized' }, 401);
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const given = req.headers.get('x-oaw-digest') ?? '';
    if (!secret || given !== (await digestKey(secret, today)))
      return json({ error: 'unauthorized' }, 401);
  }
  const owner = await ownerId();
  if (!owner) return json({ skipped: 'not_configured' });
  const line = lineClient(await statelessToken(env('LINE_MSG_ID'), secret));
  if (job === 'digest') return json(await organise(owner, line));
  const result = await runJob(job, await loadOrbs(), owner, line).catch(() => 'failed');
  return json({ job, result });
});
