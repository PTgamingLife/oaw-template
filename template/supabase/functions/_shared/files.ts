// Files and file commands in the owner's own chat. A file is only read after the owner said
// what it is for: 「學習資料」 (study material for the 學習 piece) or 「適合功能」 (exported
// chats to find fitting functions). A file sent with no command gets a question, and is
// remembered for a few minutes so it need not be sent again.
import { db, T } from './store.ts';
import { noticeCard } from './onboarding.ts';
import { docxText } from './docx.ts';
import { FIT_COMMAND, FIT_FILE_BYTES, FIT_GO } from './fit-model.ts';
import { fitFile, fitRun, fitStart, fitStop, fitWaiting } from './fit.ts';
import { orbFor, pieceOf } from './orb-logic.ts';
import { loadOrbs } from './orbs.ts';
import { STUDY_COMMAND, cleanMaterial, minDays } from './study-model.ts';
import { studyCreate } from './study.ts';
import { env } from './store.ts';

type Line = { reply: (token: string, m: unknown[]) => Promise<unknown>; push: (to: string, m: unknown[]) => Promise<unknown> };
const WAIT = 'study:wait',
  DRAFT = 'study:draft',
  LAST = 'file:last';
const quick = (card: any, labels: string[]) => ({
  ...card,
  quickReply: { items: labels.map((l) => ({ type: 'action', action: { type: 'message', label: l, text: l } })) },
});
async function get(key: string, minutes: number) {
  const { data } = await db.from(T('pending')).select('proposal,created_at').eq('line_user_id', key).maybeSingle();
  return data && Date.now() - new Date(data.created_at).getTime() <= minutes * 60000 ? data.proposal : null;
}
const put = (key: string, proposal: unknown) =>
  db.from(T('pending')).upsert({ line_user_id: key, proposal, created_at: new Date().toISOString() });
const drop = (...keys: string[]) => db.from(T('pending')).delete().in('line_user_id', keys);

const kind = (m: any) => (/\.docx$/i.test(String(m?.fileName ?? '')) ? 'docx' : /\.txt$/i.test(String(m?.fileName ?? '')) ? 'txt' : '');
const sizeOk = (m: any) => Number(m?.fileSize) > 0 && Number(m.fileSize) <= FIT_FILE_BYTES;

/** Study material from a .txt or .docx: read it and ask over how many days to learn it. */
async function studyFile(message: any, token: string) {
  const type = kind(message);
  if (!type || !sizeOk(message)) return noticeCard('這個檔案不能用', '學習資料請傳 .txt 或 Word（.docx）檔，5MB 以內。舊版的 .doc 請先另存成 .docx。');
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  const bytes = res?.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  const m = cleanMaterial(bytes ? (type === 'docx' ? await docxText(bytes) : new TextDecoder('utf-8').decode(bytes)) : '');
  if (m.length < 200) return noticeCard('這份讀不到足夠的內容', '至少需要 200 字的文字。Word 裡的圖片和掃描頁讀不到，請確認檔案裡是可以選取的文字。');
  await put(DRAFT, { text: m.text });
  await drop(WAIT, LAST);
  const least = minDays(m.length);
  const days = [1, 2, 3, 4, 5].filter((d) => d >= least);
  return quick(
    noticeCard(
      `讀到 ${m.length.toLocaleString('en-US')} 字`,
      `${m.cut ? '內容超過 12,000 字，這次只取前面 12,000 字，其餘請分次上傳。\n\n' : ''}要分幾天學完？每天晚上考 5 題，隔天早上複習答錯的。${least > 1 ? `這份比較長，最少要 ${least} 天。` : ''}\n\n出題只做這一次，會用到 AI 額度；之後每天考試都不再扣。`,
    ),
    days.map((d) => `${d} 天`),
  );
}

/** A file from the owner. */
export async function ownerFile(message: any, token: string) {
  if (await fitWaiting()) return fitFile(message, token);
  if (await get(WAIT, 30)) return studyFile(message, token);
  await put(LAST, { id: message.id, fileName: String(message.fileName ?? ''), fileSize: Number(message.fileSize) || 0, type: 'file' });
  return quick(noticeCard('收到一個檔案', '這個檔案要用來做什麼？\n\n「學習資料」：當成教材，每晚出題考你、隔天早上複習。\n「適合功能」：當成 LINE 聊天記錄，找出適合你的秘書功能。'), [STUDY_COMMAND, FIT_COMMAND]);
}

/** Owner text that belongs to these flows. Returns false when the text is something else. */
export async function ownerCommand(text: string, replyToken: string, owner: string, line: Line, token: string) {
  const reply = (...m: unknown[]) => line.reply(replyToken, m);
  if (text === FIT_GO) return fitRun(replyToken, owner, line);
  if (text === FIT_COMMAND) {
    const last = await get(LAST, 10);
    await drop(WAIT, DRAFT, LAST);
    const start = await fitStart();
    const first = last ? await fitFile(last, token) : null;
    await reply(...(first ? [start, first] : [start]));
    return true;
  }
  if (text === STUDY_COMMAND) {
    const piece = pieceOf(orbFor(await loadOrbs(), 'me'), 'study');
    const liff = env('LIFF_URL');
    if (!piece) {
      await reply(noticeCard('還沒有「學習」拼圖', '請先在個人對話的光球放上「學習」拼圖並啟動，再回來輸入「學習資料」。', liff ? { label: '打開我的 AI 秘書', uri: `${liff}?view=orbs` } : undefined));
      return true;
    }
    const last = await get(LAST, 10);
    await fitStop();
    await put(WAIT, { at: Date.now() });
    await reply(last ? await studyFile(last, token) : noticeCard('📖 上傳學習資料', '請把教材傳給我：.txt 或 Word（.docx）檔，最多 12,000 字，只讀文字（圖片和表格讀不到）。\n\n我會依內容一次出好選擇題，之後每晚考你、隔天早上複習答錯的。'));
    return true;
  }
  const days = Number(text.match(/^([1-5])\s*天$/)?.[1] ?? 0);
  const draft = days ? await get(DRAFT, 30) : null;
  if (!draft?.text) return false;
  if (days < minDays(draft.text.length)) {
    await reply(noticeCard('天數太少', `這份資料最少要分 ${minDays(draft.text.length)} 天。`));
    return true;
  }
  const piece = pieceOf(orbFor(await loadOrbs(), 'me'), 'study');
  // Taken first, so a repeated webhook cannot write (and bill) the questions twice.
  await drop(DRAFT);
  await reply(noticeCard('出題中…', '大約需要一分鐘，完成後我會通知你。'));
  const made = await studyCreate(draft.text, days, String(piece?.params?.time ?? '21:00'));
  const liff = env('LIFF_URL');
  const card =
    'error' in made
      ? noticeCard('出題沒有完成', made.error === 'quota' ? '這個月的額度用完了，請到建置中心加值後，再輸入「學習資料」重新上傳。' : '這次沒有成功，請再輸入「學習資料」重新上傳。已經完成的部分可能已經用掉一些額度。')
      : noticeCard(
          `✅ 「${made.title}」準備好了`,
          `${made.days} 天、共 ${made.total} 題。` +
            (made.queued ? '目前還有一份在進行，這份會排在後面，前一份學完就開始。' : `${made.start.slice(5).replace('-', '/')} 晚上 ${String(piece?.params?.time ?? '21:00')} 開始第一次小考。`),
          liff ? { label: '看學習紀錄', uri: `${liff}?view=study` } : undefined,
        );
  await line.push(owner, [card]).catch(() => {});
  return true;
}
