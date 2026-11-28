// 早晨語音播報: an iPhone shortcut (run when the alarm stops) posts here with the owner's
// voice token. Each call is one turn: the AI service writes what to say and may propose
// changes; a proposal is applied only after the owner's yes. The shortcut speaks `say`,
// listens while `more` is 'yes', and finally calls with end:true, which sends the record of
// the talk to the owner's LINE chat (one push message a day).
import { db, env, ownerId, apricoKey, countToday, T } from './store.ts';
import { ownerLocked } from './guard.ts';
import { sameToken } from './ics.ts';
import { PERSONA_MAX } from './orb-model.ts';
import { DAILY_TURNS, advance, currentTalk, transcript, type Op } from './voice-model.ts';

const taipeiDay = (offset = 0) => new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);
const reply = (say: string, more = false) => ({ say, more: more ? 'yes' : 'no', open: env('LIFF_URL') });

export async function voiceOwner(given: string) {
  const { data } = await db.from(T('owner')).select('voice_token,voice,persona').eq('id', 1).maybeSingle();
  return /^[0-9a-f]{48}$/.test(given) && sameToken(given, data?.voice_token ?? '') ? data : null;
}

async function apply(ops: Op[], owner: string) {
  for (const o of ops) {
    if (o.op === 'add')
      await db.from(T('records')).insert({ kind: 'event', day: o.day, time: o.time, title: o.title, source_id: owner });
    else if (o.op === 'move')
      await db.from(T('records')).update({ day: o.day, time: o.time }).eq('id', o.id).eq('kind', 'event');
    else await db.from(T('records')).delete().eq('id', o.id).eq('kind', 'event');
  }
}

/** One call from the shortcut. `row` is the owner row returned by voiceOwner. */
export async function voiceTurn(row: any, body: any, push: (to: string, messages: unknown[]) => Promise<unknown>) {
  const now = Date.now(),
    owner = await ownerId();
  const heard = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
  const save = (voice: unknown) => db.from(T('owner')).update({ voice }).eq('id', 1);
  // Shortcuts may send the flag as a boolean, a number or text.
  if ([true, 1, 'true', '1', 'yes'].includes(body?.end)) {
    const text = transcript(currentTalk(row.voice, now, false));
    await save(null);
    if (text && owner) await push(owner, [{ type: 'text', text }]).catch(() => {});
    return reply('');
  }
  if (!owner) return reply('這個秘書還沒有綁定主人，請先到 LINE 完成設定。');
  if ((await ownerLocked()) === true) return reply('帳號目前在鎖定狀態，請先到建置中心解除鎖定。');
  if ((await countToday('voice', DAILY_TURNS)) < 0) return reply('今天的語音對話次數用完了，明天再聊。');

  const talk = currentTalk(row.voice, now, !heard);
  const { data: events } = await db
    .from(T('records'))
    .select('id,day,time,title')
    .eq('kind', 'event')
    .gte('day', taipeiDay())
    .lte('day', taipeiDay(7))
    .order('day', { ascending: true })
    .order('time', { ascending: true })
    .limit(60);
  const base = env('APRICO_URL'),
    key = await apricoKey();
  const res =
    base && key
      ? await fetch(`${base}/voice`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestId: crypto.randomUUID(),
            text: heard,
            events: events ?? [],
            turns: talk.turns.slice(-8),
            pending: talk.pending,
            ...(typeof row.persona === 'string' && row.persona.trim() ? { persona: row.persona.slice(0, PERSONA_MAX) } : {}),
          }),
          signal: AbortSignal.timeout(30000),
        }).catch(() => null)
      : null;
  if (res?.status === 402) return reply('這個月的額度用完了，請到建置中心加值後再試。');
  const out = res?.ok ? await res.json().catch(() => null) : null;
  if (typeof out?.say !== 'string' || !out.say) return reply('秘書暫時連不上，請稍後再試一次。');
  const next = advance(talk, heard, out, now);
  if (next.apply.length) await apply(next.apply, owner);
  await save(next.talk);
  return reply(out.say, next.more);
}
