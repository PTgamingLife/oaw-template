// Pure parsing for 「傳給<名稱>：<內容>」 (no Deno APIs, unit-tested with Node).
/** 「傳給設計部：…」 → the link and the text, or why not. */
export function sendIntent(text: string, links: any[]) {
  const m = text.trim().match(/^傳給\s*(.+?)\s*[:：]\s*([\s\S]+)$/);
  if (!m) return null;
  const active = links.filter((l) => l.status === 'active');
  const link = active.find((l) => l.peerLabel === m[1]);
  return link
    ? { link, text: m[2].trim().slice(0, 2000) }
    : { link: null, names: active.map((l) => l.peerLabel), asked: m[1] };
}
