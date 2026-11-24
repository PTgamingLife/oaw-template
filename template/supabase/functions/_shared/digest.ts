// Pure helpers for the nightly digest (testable with Node).
import { BRAND } from './onboarding.ts';

type Digest = {
  events?: { date: string; time: string; title: string }[];
  expenses?: { date: string; amount: number; note: string }[];
  todos?: { text: string }[];
  life?: { date: string; text: string }[];
  summary?: string;
};

/** Shared secret header: hex HMAC-SHA256(channelSecret, "oaw-digest:" + UTC date). */
export async function digestKey(secret: string, ymd: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`oaw-digest:${ymd}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rows for {px}_records; every row carries the same keys (bulk insert needs that). */
export function digestRows(d: Digest, sourceId: string | null = null) {
  const row = (
    kind: string,
    day: string | null,
    title: string,
    time = '',
    amount: number | null = null,
  ) => ({ kind, day, time, title, amount, source_id: sourceId });
  return [
    ...(d.events ?? []).map((e) => row('event', e.date, e.title, e.time)),
    ...(d.expenses ?? []).map((e) => row('expense', e.date, e.note || '支出', '', e.amount)),
    ...(d.todos ?? []).map((t) => row('todo', null, t.text)),
    ...(d.life ?? []).map((l) => row('life', l.date, l.text)),
  ];
}

/** One digest from several chats (each chat is read by the AI separately). */
export function mergeDigests(list: Digest[]): Digest {
  return {
    events: list.flatMap((d) => d.events ?? []),
    expenses: list.flatMap((d) => d.expenses ?? []),
    todos: list.flatMap((d) => d.todos ?? []),
    life: list.flatMap((d) => d.life ?? []),
    summary: list.find((d) => d.summary)?.summary ?? '',
  };
}

const line = (t: string) => ({ type: 'text', text: t, wrap: true, size: 'sm' });
const section = (title: string, rows: string[]) =>
  rows.length
    ? [{ type: 'text', text: title, weight: 'bold', margin: 'md' }, ...rows.slice(0, 8).map(line)]
    : [];

/** Summary card pushed to the owner; null when nothing was recorded. */
export function digestCard(d: Digest, liffUrl = '', title = '🌙 今天的整理') {
  const events = (d.events ?? []).map((e) =>
    `${e.date.slice(5)} ${e.time} ${e.title}`.replace('  ', ' '),
  );
  const expenses = (d.expenses ?? []).map((e) => `${e.note || '支出'} ${e.amount} 元`);
  const todos = (d.todos ?? []).map((t) => `・${t.text}`);
  const life = (d.life ?? []).map((l) => `${l.date.slice(5)} ${l.text}`);
  if (!events.length && !expenses.length && !todos.length && !life.length) return null;
  const total = (d.expenses ?? []).reduce((s, e) => s + e.amount, 0);
  return {
    type: 'flex',
    altText: title,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        contents: [{ type: 'text', text: title, weight: 'bold', color: BRAND.ink }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          ...(d.summary ? [line(d.summary)] : []),
          ...section('📅 行程', events),
          ...section(`💰 支出${total ? `（共 ${total} 元）` : ''}`, expenses),
          ...section('✅ 待辦', todos),
          ...section('📝 生活紀錄', life),
        ],
      },
      ...(liffUrl
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: BRAND.button,
                  action: {
                    type: 'uri',
                    label: '打開秘書',
                    uri: `${liffUrl}?view=orbs`,
                  },
                },
              ],
            },
          }
        : {}),
    },
  };
}
