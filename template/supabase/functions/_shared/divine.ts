// 卜卦拼圖 (三錢法・周易 64 卦): one hexagram a day for the owner. The coins are thrown here,
// not in the page, so a day's hexagram cannot be re-rolled; the page only draws it and looks
// the texts up in liff/iching.json. No AI and no quota.
import { db, T } from './store.ts';
import { addYao, castYao, cleanDivine } from './divine-model.ts';

export const DIVINE_COMMAND = '卜卦';
const today = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** divine_get: today's lines and recent days. divine_cast: throw the coins once more today. */
export async function divineAction(action: string) {
  const { data } = await db.from(T('owner')).select('divine').eq('id', 1).maybeSingle();
  let all = cleanDivine(data?.divine);
  const day = today();
  let yao: { value: number; coins: number[] } | null = null;
  if (action === 'divine_cast' && (all[day]?.lines.length ?? 0) < 6) {
    yao = castYao();
    all = addYao(all, day, yao);
    const { error } = await db.from(T('owner')).update({ divine: all }).eq('id', 1);
    if (error) throw Error('divine_save_failed');
  }
  return {
    today: day,
    lines: all[day]?.lines ?? [],
    yao,
    history: Object.keys(all).filter((k) => k !== day && all[k].lines.length === 6).sort().reverse().slice(0, 14).map((k) => ({ day: k, lines: all[k].lines })),
  };
}
