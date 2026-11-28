// 早晨語音播報: the pure parts (testable in Node). A talk is a few turns kept for a short
// while: what was said, and a change that waits for the owner's yes.
export type Op = { op: 'add' | 'move' | 'remove'; id: number; day: string; time: string; title: string };
export type Turn = { who: 'secretary' | 'owner'; text: string };
export type Talk = { at: number; turns: Turn[]; pending: Op[]; changed: string[] };

export const TALK_MINUTES = 20;
export const DAILY_TURNS = 40;
const DAY = /^\d{4}-\d{2}-\d{2}$/,
  TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export const newTalk = (now: number): Talk => ({ at: now, turns: [], pending: [], changed: [] });

/** The saved talk if it is still going; a new one after a pause or for an opening call. */
export function currentTalk(saved: unknown, now: number, opening: boolean): Talk {
  const t = saved as Talk | null;
  if (opening || !t || typeof t.at !== 'number' || now - t.at > TALK_MINUTES * 60000) return newTalk(now);
  return {
    at: t.at,
    turns: Array.isArray(t.turns) ? t.turns.slice(-12) : [],
    pending: cleanOps(t.pending),
    changed: Array.isArray(t.changed) ? t.changed.filter((c) => typeof c === 'string').slice(0, 20) : [],
  };
}

/** Changes as the AI service returned them, checked again before they are kept or applied. */
export function cleanOps(ops: unknown): Op[] {
  const out: Op[] = [];
  for (const o of Array.isArray(ops) ? ops.slice(0, 5) : []) {
    if (!o || !['add', 'move', 'remove'].includes(o.op) || !DAY.test(o.day ?? '')) continue;
    const title = typeof o.title === 'string' ? o.title.trim().slice(0, 120) : '';
    const id = Number.isSafeInteger(o.id) && o.id > 0 ? o.id : 0;
    if (!title || (o.op === 'add') !== (id === 0)) continue;
    out.push({ op: o.op, id, day: o.day, time: TIME.test(o.time ?? '') ? o.time : '', title });
  }
  return out;
}

const when = (o: Op) => `${o.day.slice(5).replace('-', '/')}${o.time ? ' ' + o.time : ''}`;
export const opLine = (o: Op) =>
  o.op === 'add' ? `新增：${when(o)} ${o.title}` : o.op === 'move' ? `改到 ${when(o)}：${o.title}` : `取消：${o.title}`;

/** One step of the talk after the AI answered: what to apply now and what the talk becomes. */
export function advance(talk: Talk, heard: string, out: { say: string; ops: unknown; answer: string; done: boolean }, now: number) {
  const apply = out.answer === 'yes' ? talk.pending : [];
  const pending = out.answer === 'yes' ? [] : cleanOps(out.ops).length ? cleanOps(out.ops) : out.answer === 'no' ? [] : talk.pending;
  const turns = [...talk.turns, ...(heard ? [{ who: 'owner' as const, text: heard }] : []), { who: 'secretary' as const, text: out.say }].slice(-12);
  return {
    apply,
    talk: { at: now, turns, pending, changed: [...talk.changed, ...apply.map(opLine)].slice(0, 20) } as Talk,
    // The shortcut keeps listening while something waits for an answer.
    more: !out.done || pending.length > 0,
  };
}

/** The record of the talk that is sent to the owner's LINE chat when it ends. */
export function transcript(talk: Talk) {
  if (!talk.turns.length) return '';
  const lines = talk.turns.map((t) => `${t.who === 'owner' ? '你' : '秘書'}：${t.text}`);
  const changed = talk.changed.length ? `\n\n已更改\n${talk.changed.map((c) => '・' + c).join('\n')}` : '';
  return `🎙️ 早晨語音播報\n${lines.join('\n')}${changed}`.slice(0, 4500);
}
