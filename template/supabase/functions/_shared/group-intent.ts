// Pure helpers for group features (testable with Node): the call word in a group,
// the owner's 「發到群組：…」 command, and the cards for both.
import { BRAND } from './onboarding.ts';

export const DEFAULT_WAKE = '小秘';

/** A call word is 1–8 letters or digits (no spaces or symbols); anything else → 小秘. */
export const cleanWake = (v: unknown) =>
  typeof v === 'string' && /^[\p{L}\p{N}]{1,8}$/u.test(v.trim()) ? v.trim() : DEFAULT_WAKE;

export type GroupCommand =
  | { kind: 'help' }
  | { kind: 'digest' }
  | { kind: 'events' }
  | { kind: 'note'; text: string }
  | { kind: 'ask'; text: string };

/** 「小秘 整理」 / 「小秘 行程」 / 「小秘 記下：…」 / 「小秘 任何問題」; null when not called. */
export function groupCommand(text: string, wake: string): GroupCommand | null {
  const t = text.trim().replace(/^[@＠]/, '');
  if (!wake || !t.startsWith(wake)) return null;
  const rest = t
    .slice(wake.length)
    .replace(/^[\s,，:：、!！~～]+/, '')
    .trim();
  if (!rest) return { kind: 'help' };
  if (/^(整理|整理一下|幫我整理)$/.test(rest)) return { kind: 'digest' };
  if (/^(行程|最近行程|接下來的行程)$/.test(rest)) return { kind: 'events' };
  const note = rest.match(/^記下\s*[:：]?\s*([\s\S]+)$/);
  if (note) return { kind: 'note', text: note[1].trim().slice(0, 500) };
  return { kind: 'ask', text: rest.slice(0, 500) };
}

type Group = { group_id: string; name: string };
export type SendIntent =
  | { text: string; ai: boolean; group: Group }
  | { text: string; ai: boolean; choose: Group[] }
  | { none: true }
  | { missing: string; names: string[] };

/** The owner's 「發到群組：…」 or 「發到家人群：…」. Text starting with 幫我/請 is a request for the AI. */
export function groupSendIntent(text: string, groups: Group[]): SendIntent | null {
  const m = text.trim().match(/^發到\s*(.{1,40}?)\s*[:：]\s*([\s\S]+)$/);
  if (!m) return null;
  const body = m[2].trim().slice(0, 1000),
    target = m[1];
  if (!body) return null;
  const ai = /^(請幫我|幫我|請)/.test(body);
  if (!groups.length) return { none: true };
  if (target === '群組' || target === '群') {
    return groups.length === 1
      ? { text: body, ai, group: groups[0] }
      : { text: body, ai, choose: groups.slice(0, 13) };
  }
  const group = groups.find((g) => g.name === target);
  if (group) return { text: body, ai, group };
  return { missing: target, names: groups.map((g) => g.name || '未命名群組') };
}

const label = (g: Group, i: number) => (g.name || `群組 ${i + 1}`).slice(0, 20);

/** Quick-reply list of groups; the choice is a postback with the index. */
export function pickGroupMessage(groups: Group[]) {
  return {
    type: 'text',
    text: '要發到哪個群組？',
    quickReply: {
      items: groups.slice(0, 13).map((g, i) => ({
        type: 'action',
        action: { type: 'postback', label: label(g, i), data: `grp-pick:${i}`, displayText: label(g, i) },
      })),
    },
  };
}

const button = (text: string, data: string, primary = false) => ({
  type: 'button',
  style: primary ? 'primary' : 'secondary',
  color: primary ? BRAND.button : undefined,
  height: 'sm',
  action: { type: 'postback', label: text, data, displayText: text },
});

/** Owner confirmation: 送出 / 幫我潤飾 / 取消, with the push cost (LINE counts each member). */
export function groupConfirmCard(name: string, text: string, members: number) {
  const cost = members > 0 ? `\n\n群組約 ${members} 人，送出會用掉約 ${members} 則推播額度。` : '';
  return {
    type: 'flex',
    altText: `發到 ${name}：${text}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        paddingAll: '12px',
        contents: [{ type: 'text', text: `📢 發到〈${name}〉`, weight: 'bold', color: BRAND.ink }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.paper,
        contents: [
          { type: 'text', text: `${text}${cost}`.slice(0, 2000), wrap: true, size: 'sm', color: BRAND.ink },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          button('送出', 'grp-send', true),
          button('幫我潤飾', 'grp-polish'),
          button('取消', 'grp-cancel'),
        ],
      },
    },
  };
}

/** What the group sees: a card titled 「📢 〇〇公告」. */
export function announcementCard(oaName: string, text: string) {
  const title = `📢 ${(oaName || '').slice(0, 30)}公告`;
  return {
    type: 'flex',
    altText: `${title}：${text}`.slice(0, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        paddingAll: '12px',
        contents: [{ type: 'text', text: title, weight: 'bold', color: BRAND.ink, wrap: true }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.paper,
        contents: [{ type: 'text', text: text.slice(0, 2000), wrap: true, color: BRAND.ink }],
      },
    },
  };
}

export const groupHelp = (wake: string) =>
  `在群組這樣叫我：\n` +
  `・${wake} 整理：把還沒整理的對話整理成重點\n` +
  `・${wake} 行程：接下來 7 天的行程\n` +
  `・${wake} 記下：週六 10 點聚餐\n` +
  `・${wake} 加上任何問題`;
