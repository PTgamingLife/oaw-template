// 學習拼圖: the pure parts (testable in Node). The owner uploads study material; the AI
// service writes every question once. From then on this file decides, without any AI, what is
// asked each evening, what is reviewed the next morning, and what comes back on a later day.
export const STUDY_COMMAND = '學習資料',
  STUDY_MAX = 12000,
  STUDY_PART = 6000,
  PER_DAY = 5,
  CARRY_MAX = 5;

export type Choice = { q: string; options: string[]; answer: number; explain: string };
export type Question = Choice & { point: string; again: Choice };
export type Course = { days: { focus: string; questions: Question[] }[] };
/** quiz / review: answers keyed "session:ref" (ref = "day.index"); flag: questions the owner removed. */
export type Log = { quiz: Record<string, number>; review: Record<string, number>; flag: Record<string, true> };
export const emptyLog = (): Log => ({ quiz: {}, review: {}, flag: {} });

/** Readable text of the material: tidy whitespace, cut at the limit. */
export function cleanMaterial(raw: string) {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: text.slice(0, STUDY_MAX), cut: text.length > STUDY_MAX, length: Math.min(text.length, STUDY_MAX) };
}
/** Each day's part may hold STUDY_PART characters, so long material needs more days. */
export const minDays = (length: number) => Math.max(1, Math.min(5, Math.ceil(length / STUDY_PART)));

/** Cut the material into `days` parts of similar size, at paragraph or line ends where possible. */
export function splitParts(text: string, days: number) {
  const parts: string[] = [];
  let rest = text;
  for (let left = days; left > 1; left--) {
    const want = Math.ceil(rest.length / left);
    const near = (sep: string) => {
      const i = rest.lastIndexOf(sep, want + 200);
      return i > want * 0.6 ? i + sep.length : -1;
    };
    const at = [near('\n\n'), near('\n'), near('。')].find((i) => i > 0) ?? want;
    parts.push(rest.slice(0, at).trim().slice(0, STUDY_PART));
    rest = rest.slice(at);
  }
  parts.push(rest.trim().slice(0, STUDY_PART));
  return parts;
}

/** Day 1 is the calendar day of the first evening quiz (dates are Asia/Taipei YYYY-MM-DD). */
export const dayNumber = (start: string, today: string) =>
  Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / 86400000) + 1;

const key = (session: number, ref: string) => `${session}:${ref}`;
export function question(course: Course, ref: string): Question | null {
  const [d, i] = ref.split('.').map(Number);
  return course.days[d - 1]?.questions[i] ?? null;
}

/**
 * The questions of evening `n`: that day's own, then the ones that come back — wrong again
 * in the morning review after evening n-1, or left unanswered that evening.
 */
export function session(course: Course, log: Log, n: number): string[] {
  if (n < 1 || n > course.days.length) return [];
  const own = course.days[n - 1].questions.map((_, i) => `${n}.${i}`);
  const back =
    n > 1
      ? session(course, log, n - 1).filter((ref) => {
          const quiz = log.quiz[key(n - 1, ref)],
            q = question(course, ref)!;
          if (quiz === undefined) return true;
          const review = log.review[key(n - 1, ref)];
          return quiz !== q.answer && review !== undefined && review !== q.again.answer;
        })
      : [];
  return [...own, ...back.slice(0, CARRY_MAX)].filter((ref) => !log.flag[ref]);
}
/** Answered wrong in evening `n`: these are reviewed the next morning. */
export const wrong = (course: Course, log: Log, n: number) =>
  session(course, log, n).filter((ref) => {
    const a = log.quiz[key(n, ref)];
    return a !== undefined && a !== question(course, ref)!.answer;
  });
export const nextQuiz = (course: Course, log: Log, n: number) =>
  session(course, log, n).find((ref) => log.quiz[key(n, ref)] === undefined) ?? null;
export const nextReview = (course: Course, log: Log, n: number) =>
  wrong(course, log, n).find((ref) => log.review[key(n, ref)] === undefined) ?? null;

/** Record one answer. Returns null when it is not the question that is waiting (old button, repeat). */
export function answer(course: Course, log: Log, kind: 'q' | 'r', n: number, ref: string, pick: number) {
  if (!Number.isInteger(pick) || pick < 0 || pick > 3) return null;
  if ((kind === 'q' ? nextQuiz(course, log, n) : nextReview(course, log, n)) !== ref) return null;
  const q = question(course, ref)!;
  const right = pick === (kind === 'q' ? q.answer : q.again.answer);
  const next: Log = { ...log, [kind === 'q' ? 'quiz' : 'review']: { ...(kind === 'q' ? log.quiz : log.review), [key(n, ref)]: pick } };
  return { log: next, right };
}

/** Evening `n` in numbers. */
export function score(course: Course, log: Log, n: number) {
  const refs = session(course, log, n);
  const done = refs.filter((r) => log.quiz[key(n, r)] !== undefined);
  return { total: refs.length, done: done.length, right: done.length - wrong(course, log, n).length };
}

/** After the last morning: the points still not learned (the latest answer to them was wrong). */
export function unlearned(course: Course, log: Log) {
  const out: string[] = [];
  course.days.forEach((d, di) =>
    d.questions.forEach((q, i) => {
      const ref = `${di + 1}.${i}`;
      if (log.flag[ref]) return;
      let last: boolean | null = null;
      for (let n = di + 1; n <= course.days.length; n++) {
        const a = log.quiz[key(n, ref)],
          r = log.review[key(n, ref)];
        if (a !== undefined) last = a === q.answer;
        if (r !== undefined) last = r === q.again.answer;
      }
      if (last !== true) out.push(q.point);
    }),
  );
  return out;
}

/** A course as the AI service returned it, checked again before it is stored. */
export function cleanCourse(days: any[]): Course | null {
  const ok = (c: any) =>
    c && typeof c.q === 'string' && c.q && Array.isArray(c.options) && c.options.length === 4 &&
    c.options.every((o: unknown) => typeof o === 'string' && o) && Number.isInteger(c.answer) && c.answer >= 0 && c.answer <= 3;
  const short = (c: any): Choice => ({ q: c.q.slice(0, 120), options: c.options.map((o: string) => o.slice(0, 40)), answer: c.answer, explain: String(c.explain ?? '').slice(0, 160) });
  const out = days.map((d) => ({
    focus: typeof d?.focus === 'string' ? d.focus.slice(0, 80) : '',
    questions: (Array.isArray(d?.questions) ? d.questions : [])
      .filter(ok)
      .slice(0, 8)
      .map((q: any) => ({ ...short(q), point: String(q.point ?? '').slice(0, 100), again: ok(q.again) ? short(q.again) : short(q) })),
  }));
  return out.length && out.every((d) => d.questions.length) ? { days: out } : null;
}
