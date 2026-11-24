// Pure parts of the 介面設計中心: what the AI may change, and picture checks. Testable with Node.
import { CARD_HEADS, CARD_SIZES, type Config } from './logic.ts';

export const MAX_PHOTO = 600_000; // the page shrinks pictures before sending

/**
 * The AI may change text, layout and the card look, never pictures: those are placed by the
 * owner on the page, so they are carried over from the draft.
 */
export function keepPictures(ai: any, draft: Config) {
  const look =
    CARD_HEADS.includes(ai?.card?.head) && CARD_SIZES.includes(ai?.card?.size)
      ? { head: ai.card.head, size: ai.card.size }
      : {};
  return {
    ...ai,
    card: { ...draft.card, ...look },
    cells: (Array.isArray(ai?.cells) ? ai.cells : []).map((c: any, i: number) => ({
      ...c,
      img: draft.cells[i]?.img ?? '',
    })),
  };
}

/** JPEG bytes from base64. Throws photo_invalid. */
export function decodeJpeg(b64: unknown, max = MAX_PHOTO) {
  if (typeof b64 !== 'string' || b64.length > (max * 4) / 3 + 4) throw Error('photo_invalid');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } catch {
    throw Error('photo_invalid');
  }
  if (bytes.length < 100 || bytes.length > max || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw Error('photo_invalid');
  return bytes;
}

/** Width and height from a JPEG's frame header, or null. */
export function jpegSize(bytes: Uint8Array) {
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const m = bytes[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return null;
}
