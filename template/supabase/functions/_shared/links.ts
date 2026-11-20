// Cross-account links (e.g. 行政部 ⇄ 設計部) on the app side. Aprico pairs and relays;
// every message is sealed here for the receiving app (link-crypto.ts), so Aprico cannot
// read it. Received text is only shown to the owner (or kept for tonight's digest when
// they allow it) — it is never treated as an instruction.
import { newKeyPair, open, seal } from './link-crypto.ts';
import { noticeCard } from './onboarding.ts';
import { PX } from './px.ts';
export { sendIntent } from './link-intent.ts';
import { apricoKey, db, env, saveMessage, T } from './store.ts';

export const LINK_KINDS = ['manual', 'events', 'todos', 'expenses', 'notices'] as const;
export const KIND_LABEL: Record<string, string> = {
  manual: '訊息',
  events: '行程',
  todos: '待辦',
  expenses: '帳務',
  notices: '公告',
};

export async function aprLink(op: string, body: Record<string, unknown> = {}) {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) throw Error('aprico_not_connected');
  const res = await fetch(`${base}/link`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...body }),
    signal: AbortSignal.timeout(10000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(typeof data.error === 'string' ? data.error : 'link_failed');
  return data;
}

/** This app's key pair, made on first use; the private key stays in this database. */
async function myKeys(): Promise<{ privateJwk: JsonWebKey; publicKey: string }> {
  const { data } = await db.from(T('owner')).select('link_key').eq('id', 1).maybeSingle();
  if (data?.link_key?.publicKey) return data.link_key;
  const k = await newKeyPair();
  await db.from(T('owner')).update({ link_key: k }).eq('id', 1);
  return k;
}
const inbox = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/${PX}-api`;

export async function createLink(label: string) {
  return aprLink('create', { label, key: (await myKeys()).publicKey, inbox: inbox() });
}
export async function acceptLink(code: string, label: string, scope: unknown) {
  return aprLink('accept', { code, label, scope, key: (await myKeys()).publicKey, inbox: inbox() });
}
export const listLinks = async () => (await aprLink('list')).links as any[];

/** Seal and send. Throws scope_closed / daily_limit / link_not_found from Aprico. */
export async function sendLink(linkId: string, kind: string, text: string) {
  const link = (await listLinks()).find((l) => l.id === linkId && l.status === 'active');
  if (!link?.peerKey) throw Error('link_not_found');
  return aprLink('send', { linkId, kind, sealed: await seal(link.peerKey, text.slice(0, 2000)) });
}

export function sendConfirmCard(label: string, text: string) {
  return noticeCard(`📤 傳給 ${label}`, `${text}\n\n確認送出嗎？`, {
    label: '送出',
    data: 'link-send-ok',
    text: '送出',
  });
}

export function sendErrorText(code: string) {
  return (
    {
      scope_closed: '對方目前沒有開放接收這類訊息，或你還沒開放傳出。',
      daily_limit: '這條連結今天的傳送次數已用完，明天再試。',
      link_not_found: '找不到這條連結，可能已被解除。',
    }[code] ?? '暫時無法傳送，請稍後再試。'
  );
}

/** Pull sealed messages for this app, show them to the owner, then confirm delivery. */
export async function pullInbox(push: (messages: unknown[]) => Promise<unknown>) {
  // A ping can come from anyone; pull at most every 5 seconds.
  const { data: o } = await db
    .from(T('owner'))
    .select('line_user_id,link_key,link_pulled_at')
    .eq('id', 1)
    .maybeSingle();
  if (!o?.line_user_id || !o.link_key) return 0;
  if (o.link_pulled_at && Date.now() - Date.parse(o.link_pulled_at) < 5000) return 0;
  await db.from(T('owner')).update({ link_pulled_at: new Date().toISOString() }).eq('id', 1);
  const [{ messages = [] }, links] = await Promise.all([aprLink('inbox'), listLinks()]);
  const ids: string[] = [];
  for (const m of messages) {
    try {
      if (m.kind === 'accepted' || m.kind === 'revoked') {
        await push([
          noticeCard(
            m.kind === 'accepted' ? '🔗 連結已建立' : '🔗 連結已解除',
            m.kind === 'accepted'
              ? `「${m.from_label}」已同意連結。可以到「跨帳號連結」調整要傳出、接收的內容。`
              : `「${m.from_label}」已解除和你的連結。`,
          ),
        ]);
      } else {
        const text = await open(o.link_key.privateJwk, m.sealed);
        const auto = links.find((l) => l.id === m.link_id)?.scope?.autoDigest === true;
        await db.from(T('link_inbox')).upsert({
          id: m.id,
          from_label: m.from_label,
          kind: m.kind,
          text,
          saved: auto,
        });
        if (auto) await saveMessage(o.line_user_id, false, `［來自${m.from_label}］${text}`);
        await push([
          noticeCard(
            `📨 來自 ${m.from_label}・${KIND_LABEL[m.kind] ?? '訊息'}`,
            text.slice(0, 1500),
            auto
              ? undefined
              : { label: '加入今晚整理', data: `link-save:${m.id}`, text: '加入今晚整理' },
          ),
        ]);
      }
      ids.push(m.id);
    } catch {
      // A message that cannot be opened stays in Aprico's queue and expires in 7 days.
    }
  }
  if (ids.length) await aprLink('ack', { ids });
  return ids.length;
}

/** 「加入今晚整理」: keep a received message for this app's own nightly digest. */
export async function saveReceived(id: string, owner: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return false;
  const { data } = await db.from(T('link_inbox')).select('*').eq('id', id).maybeSingle();
  if (!data || data.saved) return Boolean(data);
  await saveMessage(owner, false, `［來自${data.from_label}］${data.text}`);
  await db.from(T('link_inbox')).update({ saved: true }).eq('id', id);
  return true;
}

/** Nightly: copy tonight's digest to links that opened automatic copies. */
export async function autoSend(d: any) {
  const lines: Record<string, string[]> = {
    events: (d.events ?? []).map((e: any) =>
      `${e.date?.slice(5) ?? ''} ${e.time ?? ''} ${e.title}`.trim(),
    ),
    todos: (d.todos ?? []).map((t: any) => `・${t.text}`),
    expenses: (d.expenses ?? []).map((e: any) => `${e.note || '支出'} ${e.amount} 元`),
    notices: d.summary ? [String(d.summary)] : [],
  };
  let sent = 0;
  for (const link of (await listLinks().catch(() => [])).filter((l) => l.status === 'active'))
    for (const kind of ['events', 'todos', 'expenses', 'notices'])
      if (link.scope?.send?.[kind] && link.peerScope?.accept?.[kind] && lines[kind].length)
        await sendLink(link.id, kind, lines[kind].join('\n'))
          .then(() => sent++)
          .catch(() => {});
  return sent;
}
