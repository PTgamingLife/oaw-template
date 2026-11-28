// 領航者版: the pure parts of linking the owner's two accounts (AI 秘書 and 對外官方帳號)
// without a pairing code. Testable with Node.

/** The Supabase project this app runs in, from its own address ('' when it cannot be read). */
export const appRef = (supabaseUrl: string) =>
  supabaseUrl.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/)?.[1] ?? '';

/**
 * What this app sends with every /status call. Aprico remembers the project, so the build
 * page can offer the same one when the owner makes their second account.
 */
export const statusBody = (supabaseUrl: string) => {
  const ref = appRef(supabaseUrl);
  return JSON.stringify(ref ? { ref } : {});
};

/** Aprico asks for a pairing call with `pair: true` in its /status reply. */
export const pairAsked = (status: unknown) => (status as any)?.pair === true;

/** The card the owner gets on the account that completed the link. */
export function pairNotice(peerLabel: unknown) {
  const name = typeof peerLabel === 'string' && peerLabel.trim() ? peerLabel.trim().slice(0, 20) : '另一個帳號';
  return {
    title: '🔗 兩個帳號已連結',
    body: `這個帳號已經和你的「${name}」連結，不用輸入配對碼。之後對方整理好的內容會送到這裡；可以到「跨帳號連結」調整要傳出、接收的內容。`,
  };
}
