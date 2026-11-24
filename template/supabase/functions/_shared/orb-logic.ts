// Pure runtime helpers for 光球 (testable with Node): which orb answers a conversation,
// the database cron jobs a set of orbs needs, and the arithmetic of a 「統計」 tally.
import type { Orb, Piece } from './orb-model.ts';

/** The lit orb of one conversation ('me' or a group id), if any. */
export const orbFor = (orbs: Orb[], target: string) =>
  orbs.find((o) => o.on && o.target === target) ?? null;
/** True when some orb (lit or not) is set to this conversation. */
export const orbClaims = (orbs: Orb[], target: string) => orbs.some((o) => o.target === target);
export const pieceOf = (orb: Orb | null, type: Piece['type']) =>
  orb?.pieces.find((p) => p.type === type && p.params) ?? null;

/** Taipei HH:MM → a daily pg_cron expression in UTC. */
export function cronAt(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${m} ${(h + 16) % 24} * * *`;
}

export type CronJob = { name: string; cron: string };
/**
 * Jobs for the lit orbs: the nightly organise run (20:55), one per 定時推播 / 提醒 piece, and
 * one per 統計 piece with a closing time (the result goes to the owner privately).
 */
export function cronJobs(orbs: Orb[]): CronJob[] {
  const jobs: CronJob[] = [{ name: 'digest', cron: cronAt('20:55') }];
  for (const o of orbs.filter((o) => o.on))
    for (const p of o.pieces) {
      if (!p.params) continue;
      if (p.type === 'push' || p.type === 'remind')
        jobs.push({ name: `${p.type}-${o.slot}-${p.id}`, cron: cronAt(String(p.params.time)) });
      if (p.type === 'stats' && p.params.close)
        jobs.push({ name: `stats-${o.slot}-${p.id}`, cron: cronAt(String(p.params.close)) });
    }
  return jobs.slice(0, 30);
}
export function parseJob(name: string) {
  if (name === 'digest') return { kind: 'digest' as const, slot: 0, piece: 0 };
  const m = name.match(/^(push|remind|stats)-([1-4])-(\d{1,3})$/);
  return m ? { kind: m[1] as 'push' | 'remind' | 'stats', slot: Number(m[2]), piece: Number(m[3]) } : null;
}

/** Start of today's counting window (Taipei) as an ISO time: `open` today, else midnight. */
export function windowStart(open: string, now = Date.now()) {
  const day = new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
  return new Date(`${day}T${open || '00:00'}:00+08:00`).toISOString();
}

export type TallyEntry = { who: string; item: string; qty: number; note: string; line: number };
type Item = { name: string; price: number };

/**
 * Apply entries in line order. dedupe 'last': a member's newest line replaces their earlier
 * ones (qty 0 cancels). 'sum': quantities add up per item (qty 0 clears that item).
 */
export function tallyTotals(entries: TallyEntry[], items: Item[], dedupe: 'last' | 'sum') {
  const byWho = new Map<string, Map<string, { qty: number; note: string }>>();
  const lastLine = new Map<string, number>();
  for (const e of [...entries].sort((a, b) => a.line - b.line)) {
    let mine = byWho.get(e.who) ?? new Map();
    if (dedupe === 'last' && lastLine.get(e.who) !== e.line) mine = new Map();
    lastLine.set(e.who, e.line);
    if (e.qty === 0) mine.delete(e.item);
    else if (dedupe === 'sum' && mine.has(e.item))
      mine.set(e.item, { qty: mine.get(e.item)!.qty + e.qty, note: e.note || mine.get(e.item)!.note });
    else mine.set(e.item, { qty: e.qty, note: e.note });
    byWho.set(e.who, mine);
  }
  const price = new Map(items.map((i) => [i.name, i.price]));
  const perItem = new Map<string, number>();
  const people: { who: string; lines: string[]; amount: number }[] = [];
  let total = 0;
  for (const [who, mine] of byWho) {
    if (!mine.size) continue;
    let amount = 0;
    const lines: string[] = [];
    for (const [item, v] of mine) {
      perItem.set(item, (perItem.get(item) ?? 0) + v.qty);
      amount += (price.get(item) ?? 0) * v.qty;
      lines.push(`${item}×${v.qty}${v.note ? `（${v.note}）` : ''}`);
    }
    total += amount;
    people.push({ who, lines, amount });
  }
  return { perItem: [...perItem.entries()], people, total, count: people.length };
}

/** Card text for a tally. `nameOf` turns a speaker label back into a display name. */
export function tallyText(
  t: ReturnType<typeof tallyTotals>,
  subject: string,
  showNames: boolean,
  nameOf: (label: string) => string,
  unclear: { who: string; text: string }[] = [],
) {
  if (!t.count) return `目前還沒有人登記${subject}。`;
  const out = [`共 ${t.count} 人`, ...t.perItem.map(([item, qty]) => `・${item}：${qty}`)];
  if (t.total) out.push(`合計 ${t.total} 元`);
  if (showNames) {
    out.push('', '明細');
    for (const p of t.people)
      out.push(`${nameOf(p.who)}：${p.lines.join('、')}${p.amount ? ` ${p.amount} 元` : ''}`);
  }
  if (unclear.length) {
    out.push('', '看不懂的訊息（請本人再說一次）');
    for (const u of unclear.slice(0, 5)) out.push(`${nameOf(u.who)}：${u.text}`);
  }
  return out.join('\n').slice(0, 1900);
}
