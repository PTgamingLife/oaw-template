// 卜卦拼圖: the pure parts (testable in Node): throwing the coins and keeping each day's lines.
const KEEP_DAYS = 30;
export type Day = { lines: number[]; coins: number[][]; at?: string };

/** Three coins: heads 3, tails 2. The sum is the line: 6 老陰 (changes), 7 少陽, 8 少陰, 9 老陽 (changes). */
export function castYao(random: () => number = () => crypto.getRandomValues(new Uint8Array(1))[0] / 256) {
  const coins = [0, 1, 2].map(() => (random() < 0.5 ? 2 : 3));
  return { value: coins[0] + coins[1] + coins[2], coins };
}

/** Add one line to a day (at most six) and drop days older than the keep window. */
export function addYao(all: Record<string, Day>, day: string, yao: { value: number; coins: number[] }, at = new Date().toISOString()) {
  const cur = all[day] ?? { lines: [], coins: [] };
  if (cur.lines.length >= 6) return all;
  const next: Day = { lines: [...cur.lines, yao.value], coins: [...cur.coins, yao.coins] };
  if (next.lines.length === 6) next.at = at;
  const kept = Object.keys({ ...all, [day]: next }).sort().slice(-KEEP_DAYS);
  return Object.fromEntries(kept.map((k) => [k, k === day ? next : all[k]]));
}

export const cleanDivine = (v: unknown): Record<string, Day> => {
  const out: Record<string, Day> = {};
  for (const [k, d] of Object.entries((v && typeof v === 'object' ? v : {}) as Record<string, any>))
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(d?.lines) && d.lines.length <= 6 && d.lines.every((n: unknown) => [6, 7, 8, 9].includes(n as number)))
      out[k] = { lines: d.lines, coins: Array.isArray(d.coins) ? d.coins : [], ...(typeof d.at === 'string' ? { at: d.at } : {}) };
  return out;
};
