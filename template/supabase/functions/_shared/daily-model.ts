// 每日關心: the pure parts (testable in Node). Two routines of a personal secretary:
//  - 早晨鼓勵: a card with the secretary's picture and a voice message built from today's
//    events, open todos, recent notes and last night's mood.
//  - 晚間關心: three questions in the owner's own chat (anything to record, good things or
//    worries, a score for the day), a closing encouragement, then tonight's summary card.
import { BRAND } from './onboarding.ts';

export type Daily = { morning: { on: boolean; time: string }; night: { on: boolean; time: string } };
export const DAILY_DEFAULT: Daily = {
  morning: { on: true, time: '07:30' },
  night: { on: true, time: '21:30' },
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOUR = (t: string) => Number(t.slice(0, 2));

/** Saved settings with defaults; times outside the routine's part of the day are refused. */
export function cleanDaily(v: unknown): Daily {
  const d = (v ?? {}) as any;
  const pick = (k: 'morning' | 'night', from: number, to: number) => {
    const t = d[k]?.time;
    return {
      on: typeof d[k]?.on === 'boolean' ? d[k].on : DAILY_DEFAULT[k].on,
      time: typeof t === 'string' && TIME.test(t) && HOUR(t) >= from && HOUR(t) <= to ? t : DAILY_DEFAULT[k].time,
    };
  };
  // Morning 05:00–11:59; evening 18:00–22:59 (the summary card follows within the same day).
  return { morning: pick('morning', 5, 11), night: pick('night', 18, 22) };
}

/** HH:MM plus minutes, within the same day. */
export function addMinutes(hhmm: string, minutes: number) {
  const total = Math.min(23 * 60 + 55, HOUR(hhmm) * 60 + Number(hhmm.slice(3)) + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
/** The summary card waits this long for the owner's answers before it is sent anyway. */
export const NIGHT_WAIT_MINUTES = 60;

// ---- 晚間關心: the talk ----
export type NightTalk = { at: number; step: 1 | 2 | 3; plans: string; mood: string; retried?: boolean };
export const newNight = (now: number): NightTalk => ({ at: now, step: 1, plans: '', mood: '' });

/** The talk if it is still open (asked within the waiting time). */
export function currentNight(saved: unknown, now: number): NightTalk | null {
  const t = saved as NightTalk | null;
  if (!t || typeof t.at !== 'number' || now - t.at > NIGHT_WAIT_MINUTES * 60000 || now < t.at) return null;
  if (![1, 2, 3].includes(t.step)) return null;
  return {
    at: t.at,
    step: t.step,
    plans: typeof t.plans === 'string' ? t.plans.slice(0, 500) : '',
    mood: typeof t.mood === 'string' ? t.mood.slice(0, 500) : '',
    ...(t.retried ? { retried: true } : {}),
  };
}

const norm = (s: string) => s.trim().replace(/[\s。．.!！~～，,、]+$/g, '');
/** 「沒有」「跳過」…: nothing for this question. */
export const isSkip = (text: string) =>
  /^(沒有?|沒了|無|跳過|略過|不用|不用了|沒事|沒有了|沒什麼|沒有耶|都沒有|no|skip|pass)$/i.test(norm(text));
/** 「先這樣」「結束」: stop asking tonight. */
export const isStop = (text: string) => /^(先這樣|結束|不聊了|今天不用|今天先不用|晚安)$/.test(norm(text));

const DIGIT: Record<string, number> = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** A 1–10 score from 「8」「8分」「八分」「我給 7 分」; 0 when there is none. */
export function parseScore(text: string) {
  const t = text.normalize('NFKC');
  const m = t.match(/(?<![\d.])(10|[1-9])(?![\d.])/);
  if (m) return Number(m[1]);
  const c = t.match(/[一二兩三四五六七八九十]/);
  return c ? DIGIT[c[0]] : 0;
}

export const NIGHT_Q1 = '今天還有什麼行程要特別紀錄的嗎？';
export const NIGHT_Q2 =
  '今天有沒有什麼好事，或讓你擔心的事呢？\n有研究發現，只要說出來、寫下來，心情就會更好唷～';
export const NIGHT_Q3 = '最後，給今天的自己評個分吧！1 到 10 分，你會給幾分？';
export const NIGHT_FALLBACK = '今天辛苦了。不管今天過得怎麼樣，你都已經很努力了，今晚對自己好一點，早點休息喔 🌙';

const quick = (labels: string[]) => ({
  items: labels.map((label) => ({ type: 'action', action: { type: 'message', label, text: label } })),
});
export const askText = (text: string, labels: string[]) => ({ type: 'text', text, quickReply: quick(labels) });
export const nightQuestion = (step: 2 | 3) =>
  step === 2
    ? askText(NIGHT_Q2, ['沒有', '先這樣'])
    : askText(NIGHT_Q3, [...Array.from({ length: 10 }, (_, i) => String(i + 1)), '跳過']);

export type NightStep =
  | { done: false; talk: NightTalk; plans?: string; mood?: string; reply: unknown }
  | { done: true; talk: NightTalk; mood?: string; score: number };

/**
 * One answer from the owner. `plans` is kept as a note for tonight's organise run, `mood` and
 * `score` become life records. When `done`, the caller writes the closing words.
 */
export function nightAdvance(talk: NightTalk, text: string, now: number): NightStep {
  const said = text.trim().slice(0, 500);
  if (isStop(said)) return { done: true, talk, score: 0 };
  const skip = isSkip(said);
  if (talk.step === 1) {
    const next = { ...talk, at: now, step: 2 as const, plans: skip ? '' : said };
    return { done: false, talk: next, ...(skip ? {} : { plans: said }), reply: nightQuestion(2) };
  }
  if (talk.step === 2) {
    const next = { ...talk, at: now, step: 3 as const, mood: skip ? '' : said };
    return { done: false, talk: next, ...(skip ? {} : { mood: said }), reply: nightQuestion(3) };
  }
  const score = skip ? 0 : parseScore(said);
  // Not a number: ask once more, then take it as skipped.
  if (!skip && !score && !talk.retried)
    return {
      done: false,
      talk: { ...talk, at: now, retried: true },
      reply: askText('想請你用 1 到 10 的數字幫今天打個分數，點下面的數字也可以。', [
        ...Array.from({ length: 10 }, (_, i) => String(i + 1)),
        '跳過',
      ]),
    };
  return { done: true, talk, score };
}

export const scoreTitle = (score: number) => `今天給自己打 ${score} 分`;
export const MOOD_PREFIX = '今天的心情：';
/** Last night's mood and score from recent life records (newest first), for the morning. */
export function lastMood(rows: { day: string | null; title: string; amount: number | null }[], yesterday: string) {
  const mine = rows.filter((r) => r.day === yesterday);
  const text = mine.find((r) => r.title.startsWith(MOOD_PREFIX))?.title.slice(MOOD_PREFIX.length) ?? '';
  const score = mine.find((r) => r.amount != null && r.title === scoreTitle(r.amount))?.amount ?? 0;
  return text || score ? { text, ...(score ? { score } : {}) } : null;
}

// ---- Cards ----
/** The secretary's picture, served from the app's GitHub Pages. */
export const secretaryImage = (pagesUrl: string) =>
  /^https:\/\//.test(pagesUrl) ? `${pagesUrl.replace(/\/?$/, '/')}assets/secretary.png` : '';

const hero = (image: string) =>
  image
    ? {
        hero: {
          type: 'image',
          url: image,
          size: 'full',
          aspectRatio: '20:13',
          aspectMode: 'fit',
          backgroundColor: BRAND.accent,
        },
      }
    : {};
const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: 'text', text: t, wrap: true, size: 'sm', color: BRAND.ink, ...extra });

export type Morning = { headline: string; points: string[]; cheer: string; say: string };

/** Morning card: picture, headline, today's reminders and one line of encouragement. */
export function morningCard(m: Morning, image = '', liffUrl = '') {
  return {
    type: 'flex',
    altText: `☀️ ${m.headline}`.slice(0, 400),
    contents: {
      type: 'bubble',
      ...hero(image),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        backgroundColor: BRAND.paper,
        contents: [
          text(`☀️ ${m.headline}`, { weight: 'bold', size: 'md' }),
          ...m.points.slice(0, 4).map((p) => text(`・${p}`)),
          ...(m.cheer ? [{ type: 'separator', margin: 'md' }, text(m.cheer, { margin: 'md' })] : []),
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
                  action: { type: 'uri', label: '打開行事曆', uri: `${liffUrl}?view=calendar` },
                },
              ],
            },
          }
        : {}),
    },
  };
}

/** Evening card with the first question; the owner answers by typing in the chat. */
export function nightCard(image = '') {
  return {
    type: 'flex',
    altText: `🌙 ${NIGHT_Q1}`,
    contents: {
      type: 'bubble',
      ...hero(image),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        backgroundColor: BRAND.paper,
        contents: [
          text('🌙 今天辛苦了', { weight: 'bold', size: 'md' }),
          text(NIGHT_Q1),
          text('直接回覆我就可以；沒有的話回「沒有」。', { size: 'xs', color: '#8A8AA3' }),
        ],
      },
    },
    quickReply: quick(['沒有', '先這樣']),
  };
}
