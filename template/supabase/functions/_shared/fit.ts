// 「適合功能」 in the owner's own chat: 適合功能 → how to export chats → up to three .txt files
// → 開始分析 → suggestions on the ?view=fit page, each with a text to paste into an orb.
// The excerpts wait in this app's own database for at most 30 minutes and are deleted when the
// analysis starts; only the suggestions are kept.
import { db, env, apricoKey, T } from './store.ts';
import { noticeCard } from './onboarding.ts';
import { FIT_GO, FIT_HOW, FIT_MAX_FILES, cleanFit, excerpt, fitFileOk } from './fit-model.ts';

const FILES = 'fit:files',
  RESULT = 'fit:result';
type Line = { reply: (token: string, m: unknown[]) => Promise<unknown>; push: (to: string, m: unknown[]) => Promise<unknown> };
const quick = (labels: string[]) => ({
  items: labels.map((l) => ({ type: 'action', action: { type: 'message', label: l, text: l } })),
});
const withGo = (card: any) => ({ ...card, quickReply: quick([FIT_GO]) });

async function files(): Promise<string[] | null> {
  const { data } = await db.from(T('pending')).select('proposal,created_at').eq('line_user_id', FILES).maybeSingle();
  if (!data) return null;
  if (Date.now() - new Date(data.created_at).getTime() > 30 * 60 * 1000) return void (await clear()), null;
  return Array.isArray(data.proposal?.files) ? data.proposal.files : [];
}
const keep = (list: string[]) =>
  db.from(T('pending')).upsert({ line_user_id: FILES, proposal: { files: list }, created_at: new Date().toISOString() });
/** Drop chat excerpts that were sent but never analysed (also run by the nightly job). */
export const fitPurge = () =>
  db.from(T('pending')).delete().eq('line_user_id', FILES).lt('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
/** True while 「適合功能」 is waiting for chat files. */
export const fitWaiting = async () => (await files()) !== null;
/** Leave 「適合功能」 (the owner chose something else). */
export const fitStop = () => clear();
const clear = () => db.from(T('pending')).delete().eq('line_user_id', FILES);

/** 適合功能: start over and explain how to export a chat. */
export async function fitStart() {
  await keep([]);
  return noticeCard('🔎 找出適合你的功能', FIT_HOW);
}

/** A file from the owner. Returns the reply, or null when no analysis is waiting for files. */
export async function fitFile(message: any, token: string) {
  const list = await files();
  if (list === null) return null;
  if (!fitFileOk(message)) return withGo(noticeCard('這個檔案不能用', '請傳 LINE「傳送聊天記錄」產生的 .txt 文字檔（5MB 以內）。'));
  if (list.length >= FIT_MAX_FILES) return withGo(noticeCard('已經有 3 份了', '按「開始分析」就可以開始。'));
  const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20000),
  }).catch(() => null);
  const text = res?.ok ? excerpt(new TextDecoder('utf-8').decode(await res.arrayBuffer())) : '';
  if (text.length < 40) return withGo(noticeCard('這份讀不到內容', '檔案可能是空的或不是文字檔，請換一份再傳。'));
  await keep([...list, text]);
  const n = list.length + 1;
  return withGo(
    noticeCard(`收到 ${n}／${FIT_MAX_FILES}`, n < FIT_MAX_FILES ? '可以再傳下一份，或按「開始分析」。' : '三份都收到了，按「開始分析」。'),
  );
}

/** 開始分析. Returns false when nothing is waiting, so the text is handled as a normal message. */
export async function fitRun(replyToken: string, owner: string, line: Line) {
  const list = await files();
  if (list === null) return false;
  if (!list.length) {
    await line.reply(replyToken, [noticeCard('還沒有收到對話記錄', '請先傳至少一份 LINE 匯出的 .txt 檔。')]);
    return true;
  }
  // Taken before the call, so a repeated webhook cannot run (or bill) the analysis twice.
  await clear();
  await line.reply(replyToken, [noticeCard('分析中…', '大約需要一分鐘，完成後我會傳結果給你。')]);
  const base = env('APRICO_URL'),
    key = await apricoKey();
  const res =
    base && key
      ? await fetch(`${base}/fit`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: crypto.randomUUID(), chats: list }),
          signal: AbortSignal.timeout(110000),
        }).catch(() => null)
      : null;
  const raw = res?.ok ? await res.json().catch(() => null) : null;
  const out = cleanFit(raw);
  if (!out) {
    const why = res?.status === 402 ? '這個月的額度用完了，請到建置中心加值後再試。' : '這次沒有分析成功，沒有扣額度。請再輸入「適合功能」重新開始。';
    await line.push(owner, [noticeCard('分析沒有完成', why)]).catch(() => {});
    return true;
  }
  await db
    .from(T('pending'))
    .upsert({ line_user_id: RESULT, proposal: { ...out, at: new Date().toISOString() }, created_at: new Date().toISOString() });
  const liff = env('LIFF_URL');
  const top = out.items.slice(0, 3).map((i, n) => `${n + 1}. ${i.title}`).join('\n');
  await line
    .push(owner, [
      noticeCard(
        `✨ 找到 ${out.items.length} 個適合你的功能`,
        `${out.summary}\n\n${top}${out.items.length > 3 ? '\n…' : ''}\n\n打開清單可以複製每一項的文字，貼到光球的說明裡。${raw?.free ? '（這次免費）' : ''}`,
        liff ? { label: '看完整清單', uri: `${liff}?view=fit` } : undefined,
      ),
    ])
    .catch(() => {});
  return true;
}

/** The last result, for the ?view=fit page. */
export async function fitResult() {
  const { data } = await db.from(T('pending')).select('proposal').eq('line_user_id', RESULT).maybeSingle();
  const out = cleanFit(data?.proposal);
  return out ? { ...out, at: data?.proposal?.at ?? '' } : { items: [], summary: '', at: '' };
}
