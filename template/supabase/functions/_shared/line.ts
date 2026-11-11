// Minimal LINE API client. Uses stateless channel access tokens (15 minutes),
// so no long-lived token is ever stored.

const API = 'https://api.line.me';
const DATA_API = 'https://api-data.line.me';

let cached: { key: string; token: string; until: number } | null = null;

export async function statelessToken(channelId: string, secret: string, fetcher = fetch) {
  const key = channelId;
  if (cached && cached.key === key && cached.until > Date.now()) return cached.token;
  const res = await fetcher(`${API}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: channelId,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw Error('line_token_failed');
  const data = await res.json();
  if (typeof data.access_token !== 'string') throw Error('line_token_failed');
  // Refresh a minute early.
  cached = { key, token: data.access_token, until: Date.now() + 14 * 60 * 1000 };
  return data.access_token as string;
}

export function lineClient(token: string, fetcher = fetch) {
  async function call(path: string, body?: unknown, method = 'POST', base = API) {
    const res = await fetcher(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw Error(`line_api_${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }
  return {
    call,
    reply: (replyToken: string, messages: unknown[]) =>
      call('/v2/bot/message/reply', { replyToken, messages: messages.slice(0, 5) }),
    push: (to: string, messages: unknown[]) =>
      call('/v2/bot/message/push', { to, messages: messages.slice(0, 5) }),
    profile: (userId: string) =>
      call(`/v2/bot/profile/${encodeURIComponent(userId)}`, undefined, 'GET'),
    async publishMenu(menu: unknown, png: Uint8Array<ArrayBuffer>, name: string) {
      const { richmenus = [] } = await call('/v2/bot/richmenu/list', undefined, 'GET');
      const { richMenuId } = await call('/v2/bot/richmenu', menu);
      const up = await fetcher(`${DATA_API}/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
        body: png,
      });
      if (!up.ok) throw Error(`line_menu_image_${up.status}`);
      await call(`/v2/bot/user/all/richmenu/${richMenuId}`, undefined, 'POST');
      // Remove older menus of this OA app only after the new one is live.
      for (const m of richmenus)
        if (m.name === name && m.richMenuId !== richMenuId)
          await call(`/v2/bot/richmenu/${m.richMenuId}`, undefined, 'DELETE');
      return richMenuId as string;
    },
  };
}

/** Verify a LIFF ID token with LINE. Returns the LINE user ID (sub) and display name. */
export async function verifyIdToken(idToken: string, loginChannelId: string, fetcher = fetch) {
  const res = await fetcher(`${API}/oauth2/v2.1/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: loginChannelId }),
  });
  if (!res.ok) throw Error('id_token_invalid');
  const data = await res.json();
  if (typeof data.sub !== 'string' || !/^U[0-9a-f]{32}$/.test(data.sub))
    throw Error('id_token_invalid');
  return { sub: data.sub as string, name: typeof data.name === 'string' ? data.name : '' };
}
