// 「適合功能」: the pure parts (testable in Node). The owner sends up to three exported LINE
// chats; only a recent excerpt of each is used, with long numbers masked before it leaves.
export const FIT_COMMAND = '適合功能',
  FIT_GO = '開始分析',
  FIT_MAX_FILES = 3,
  FIT_EXCERPT = 5500,
  FIT_FILE_BYTES = 5_000_000;

/** The recent part of an exported chat: blank lines dropped, long numbers and links masked. */
export function excerpt(raw: string, max = FIT_EXCERPT) {
  const lines = raw
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) =>
      l
        .trim()
        .replace(/https?:\/\/\S+/g, '〔連結〕')
        // Phone, account, ID and card numbers: anything with seven or more digits in a row.
        .replace(/\d[\d\- ]{5,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '〔號碼〕' : m))
        .slice(0, 300),
    )
    .filter(Boolean);
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0 && size + lines[i].length + 1 <= max; i--) {
    kept.unshift(lines[i]);
    size += lines[i].length + 1;
  }
  return kept.join('\n');
}

/** A file the owner may send for this: a .txt of a sane size. */
export const fitFileOk = (m: any) =>
  m?.type === 'file' && /\.txt$/i.test(String(m.fileName ?? '')) && Number(m.fileSize) > 0 && Number(m.fileSize) <= FIT_FILE_BYTES;

export const FIT_HOW =
  '我會從你的 LINE 對話裡，找出最常發生、最讓你分心的小事，再建議秘書可以幫你做的 5 到 8 件事。\n\n' +
  '① 打開一個你常用的聊天室（個人或群組都可以）\n' +
  '② 右上角「≡」→ 設定 → 傳送聊天記錄\n' +
  '③ 分享的對象選 LINE，再選我（這個秘書）\n' +
  '④ 最多傳 3 份，傳完按「開始分析」\n\n' +
  '我只看每份最近的一段，電話、帳號這類長號碼和連結會先遮掉；分析完就刪除，不會保存對話內容。對話裡有其他人的訊息，請自行斟酌要傳哪些。';

export type FitItem = { title: string; why: string; often: number; fit: number; text: string };

/** The result as the page shows it; anything malformed is dropped. */
export function cleanFit(out: any) {
  const items: FitItem[] = (Array.isArray(out?.items) ? out.items : [])
    .filter((i: any) => i && typeof i.title === 'string' && typeof i.text === 'string' && i.text.trim())
    .slice(0, 8)
    .map((i: any) => ({
      title: i.title.slice(0, 20),
      why: typeof i.why === 'string' ? i.why.slice(0, 120) : '',
      often: Number.isInteger(i.often) ? i.often : 1,
      fit: Number.isInteger(i.fit) ? i.fit : 1,
      text: i.text.slice(0, 200),
    }));
  return items.length ? { summary: typeof out.summary === 'string' ? out.summary.slice(0, 240) : '', items } : null;
}
