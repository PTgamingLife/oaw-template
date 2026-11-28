// 領航者版: the owner's two accounts link themselves. Aprico knows both belong to one owner;
// each app only has to hand over its public key and inbox address when /status asks for it
// (pair-model.ts). Messages stay sealed for the receiving app, as with any other link.
import { lineClient, statelessToken } from './line.ts';
import { pairAuto } from './links.ts';
import { noticeCard } from './onboarding.ts';
import { pairAsked, pairNotice, statusBody } from './pair-model.ts';
import { env, ownerId } from './store.ts';

/** The body of every /status call made by this app. */
export const STATUS_BODY = statusBody(Deno.env.get('SUPABASE_URL') ?? '');

/** Call with the JSON of a /status reply. Never throws; a failed try is simply asked again. */
export async function afterStatus(status: unknown) {
  if (!pairAsked(status)) return;
  try {
    const done = await pairAuto();
    // No link yet means this app asked first; the other account answers on its next check.
    if (!done?.link) return;
    const owner = await ownerId();
    if (!owner) return;
    const text = pairNotice(done.link.peerLabel);
    await lineClient(await statelessToken(env('LINE_MSG_ID'), env('LINE_MSG_SECRET'))).push(owner, [
      noticeCard(text.title, text.body),
    ]);
  } catch {
    // Not paired this time.
  }
}
