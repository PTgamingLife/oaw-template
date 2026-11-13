// 個人健康 AI 秘書: pure rules shared by the API, the webhook and the scheduler.
// Records and reminders only — never a diagnosis. Every alert carries DISCLAIMER.

export const DISCLAIMER = '僅供紀錄參考，請諮詢醫師；緊急狀況請撥 119。';

export type Thresholds = {
  sysHigh: number;
  sysLow: number;
  diaHigh: number;
  diaLow: number;
  gluHigh: number;
  gluLow: number;
};
export const DEFAULT_THRESHOLDS: Thresholds = {
  sysHigh: 140,
  sysLow: 90,
  diaHigh: 90,
  diaLow: 60,
  gluHigh: 130,
  gluLow: 70,
};

export type Reminder = { time: string; kind: 'med' | 'measure'; label: string };
export const DEFAULT_REMINDERS: Reminder[] = [
  { time: '08:00', kind: 'measure', label: '早上量血壓' },
  { time: '08:30', kind: 'med', label: '早餐後吃藥' },
  { time: '20:00', kind: 'med', label: '晚餐後吃藥' },
];

const between = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

/** Accept only sane threshold values; anything missing or odd falls back to the default. */
export function thresholds(raw: any): Thresholds {
  const t = { ...DEFAULT_THRESHOLDS };
  for (const k of Object.keys(t) as (keyof Thresholds)[])
    if (between(raw?.[k], 30, 400)) t[k] = Math.round(raw[k]);
  return t;
}

export function reminders(raw: unknown): Reminder[] {
  // A new profile starts with an empty list: use the defaults until the elder saves their own.
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_REMINDERS;
  return raw
    .filter(
      (r: any) =>
        r &&
        /^([01]\d|2[0-3]):[0-5]\d$/.test(r.time) &&
        ['med', 'measure'].includes(r.kind) &&
        typeof r.label === 'string' &&
        r.label.trim(),
    )
    .slice(0, 8)
    .map((r: any) => ({ time: r.time, kind: r.kind, label: r.label.trim().slice(0, 20) }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

export type Measure =
  | { kind: 'bp'; v1: number; v2: number; v3: number | null; tag: '' }
  | { kind: 'glucose'; v1: number; v2: null; v3: null; tag: 'fasting' | 'after' }
  | { kind: 'weight'; v1: number; v2: null; v3: null; tag: '' }
  | { kind: 'med'; v1: null; v2: null; v3: null; tag: string };

/** Validate one measurement from the LIFF form or the chat parser. Null when implausible. */
export function measure(raw: any): Measure | null {
  const n = (v: unknown) => (typeof v === 'string' && v.trim() ? Number(v) : v);
  const [a, b, c] = [n(raw?.v1), n(raw?.v2), n(raw?.v3)];
  if (
    raw?.kind === 'bp' &&
    between(a, 50, 260) &&
    between(b, 30, 160) &&
    (a as number) > (b as number)
  )
    return {
      kind: 'bp',
      v1: Math.round(a as number),
      v2: Math.round(b as number),
      v3: between(c, 30, 220) ? Math.round(c as number) : null,
      tag: '',
    };
  if (raw?.kind === 'glucose' && between(a, 20, 600))
    return {
      kind: 'glucose',
      v1: Math.round(a as number),
      v2: null,
      v3: null,
      tag: raw.tag === 'after' ? 'after' : 'fasting',
    };
  if (raw?.kind === 'weight' && between(a, 20, 250))
    return { kind: 'weight', v1: Math.round((a as number) * 10) / 10, v2: null, v3: null, tag: '' };
  if (raw?.kind === 'med')
    return { kind: 'med', v1: null, v2: null, v3: null, tag: String(raw.tag ?? '').slice(0, 20) };
  return null;
}

/** Why a value is outside the owner's range, or '' when it is fine. */
export function flagReason(m: Measure, t: Thresholds) {
  if (m.kind === 'bp') {
    if (m.v1 >= t.sysHigh || m.v2 >= t.diaHigh) return `血壓偏高（${m.v1}/${m.v2}）`;
    if (m.v1 <= t.sysLow || m.v2 <= t.diaLow) return `血壓偏低（${m.v1}/${m.v2}）`;
  }
  // Post-meal readings use a higher ceiling (fasting high + 50).
  if (m.kind === 'glucose') {
    const high = m.tag === 'after' ? t.gluHigh + 50 : t.gluHigh;
    if (m.v1 >= high) return `血糖偏高（${m.v1}）`;
    if (m.v1 <= t.gluLow) return `血糖偏低（${m.v1}）`;
  }
  return '';
}

/** Chat shortcut: 「血壓 135/85 72」「血糖 110」「飯後血糖 160」「體重 62.5」「吃藥了」. */
export function parseMeasureText(text: string) {
  const t = text.trim().replace(/／/g, '/');
  let m = t.match(/^血壓\s*(\d{2,3})\s*\/\s*(\d{2,3})(?:\s+(\d{2,3}))?$/);
  if (m) return measure({ kind: 'bp', v1: +m[1], v2: +m[2], v3: m[3] ? +m[3] : null });
  m = t.match(/^(飯後)?血糖\s*(\d{2,3})$/);
  if (m) return measure({ kind: 'glucose', v1: +m[2], tag: m[1] ? 'after' : 'fasting' });
  m = t.match(/^體重\s*(\d{2,3}(?:\.\d)?)$/);
  if (m) return measure({ kind: 'weight', v1: +m[1] });
  if (/^(吃藥了|已吃藥|吃過藥了)$/.test(t)) return measure({ kind: 'med', tag: '' });
  return null;
}

export const describe = (m: Measure) =>
  m.kind === 'bp'
    ? `血壓 ${m.v1}/${m.v2}${m.v3 ? `，心跳 ${m.v3}` : ''}`
    : m.kind === 'glucose'
      ? `${m.tag === 'after' ? '飯後' : '飯前'}血糖 ${m.v1}`
      : m.kind === 'weight'
        ? `體重 ${m.v1} 公斤`
        : '已吃藥';

/** Taipei calendar day and HH:MM for scheduling. */
export function taipei(now = new Date()) {
  const s = new Date(now.getTime() + 8 * 3600 * 1000).toISOString();
  return { day: s.slice(0, 10), time: s.slice(11, 16) };
}

const mins = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

/**
 * Reminders whose time has come within the last two hours. The scheduler sends each
 * once a day (it remembers what it sent), so a late GitHub run still delivers them.
 */
export function dueSlots(list: Reminder[], time: string) {
  const now = mins(time);
  return list
    .map((r, slot) => ({ ...r, slot }))
    .filter((r) => now >= mins(r.time) && now - mins(r.time) < 120);
}

/** Reminders not done 2–4 hours after their time (each caregiver gets one notice). */
export function missedSlots(list: Reminder[], time: string, done: number[]) {
  const now = mins(time);
  return list
    .map((r, slot) => ({ ...r, slot }))
    .filter((r) => !done.includes(r.slot) && now - mins(r.time) >= 120 && now - mins(r.time) < 240);
}

/** Sunday 20:00–23:59 Taipei is when the weekly report goes out. */
export const weeklyDue = (now = new Date()) => {
  const t = new Date(now.getTime() + 8 * 3600 * 1000);
  return t.getUTCDay() === 0 && t.getUTCHours() >= 20;
};

/** 20:00–23:59 Taipei: remind about tomorrow's events. */
export const eveningDue = (time: string) => mins(time) >= 20 * 60;

export const notifySettings = (raw: any) => ({
  alert: raw?.alert !== false,
  missed: raw?.missed !== false,
  weekly: raw?.weekly !== false,
});
