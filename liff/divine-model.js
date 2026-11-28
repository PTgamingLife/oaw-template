// 卜卦 (三錢法・周易): pure helpers shared by the page and its tests. A line is 6 老陰, 7 少陽,
// 8 少陰 or 9 老陽; 6 and 9 are the changing lines. Lines run from the bottom (初) to the top (上).
export const YAO_NAMES = { 6: '老陰', 7: '少陽', 8: '少陰', 9: '老陽' };
const POS = ['初', '二', '三', '四', '五', '上'];

export const yaoBit = (v) => (v === 7 || v === 9 ? '1' : '0');
export const isMoving = (v) => v === 6 || v === 9;
/** The hexagram as six bits, bottom first, 1 = yang. */
export const linesToBits = (lines) => lines.map(yaoBit).join('');
/** The hexagram it turns into ('' when no line changes). */
export function changedBits(lines) {
  if (!lines.some(isMoving)) return '';
  return lines.map((v) => (v === 6 ? '1' : v === 9 ? '0' : yaoBit(v))).join('');
}
/** 初九、六二 … 上六. */
export function yaoLabel(i, v) {
  const n = yaoBit(v) === '1' ? '九' : '六';
  return i === 0 || i === 5 ? `${POS[i]}${n}` : `${n}${POS[i]}`;
}

/**
 * What a finished hexagram says: the main hexagram, the texts of its changing lines (用九 /
 * 用六 when all six change and the hexagram has one), and the hexagram it turns into.
 */
export function reading(lines, book) {
  if (lines.length !== 6) return null;
  const find = (bits) => book.find((h) => h.bits === bits) ?? null;
  const main = find(linesToBits(lines));
  if (!main) return null;
  const moving = lines.map((v, i) => (isMoving(v) ? i : -1)).filter((i) => i >= 0);
  const all = moving.length === 6 && main.extra;
  return {
    main,
    moving: all ? [main.extra] : moving.map((i) => main.lines[i]),
    changed: moving.length ? find(changedBits(lines)) : null,
  };
}
