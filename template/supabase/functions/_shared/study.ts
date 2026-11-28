// 學習拼圖 at runtime: store a course, ask the evening quiz, review in the morning, mark the
// owner's taps. Questions were written once when the material was uploaded; nothing here
// calls the AI. Each evening and each morning starts with one push; every answer after that
// is a reply (no push quota).
import { db, env, apricoKey, T } from './store.ts';
import { BRAND, noticeCard } from './onboarding.ts';
import {
  PER_DAY, answer, cleanCourse, dayNumber, emptyLog, nextQuiz, nextReview, question, score, session, splitParts, unlearned, wrong,
  type Course, type Log,
} from './study-model.ts';

type Line = { push: (to: string, m: unknown[]) => Promise<unknown> };
type Row = { id: number; title: string; status: string; start_day: string; course: Course; log: Log };
const today = (offset = 0) => new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);
const page = () => (env('LIFF_URL') ? `${env('LIFF_URL')}?view=study` : '');
const MARK = ['Ａ', 'Ｂ', 'Ｃ', 'Ｄ'];

export async function activeCourse(): Promise<Row | null> {
  const { data } = await db.from(T('study')).select('id,title,status,start_day,course,log').eq('status', 'active').order('id', { ascending: true }).limit(1).maybeSingle();
  return data ? { ...data, log: { ...emptyLog(), ...(data.log ?? {}) } } : null;
}
const saveLog = (id: number, log: Log) => db.from(T('study')).update({ log }).eq('id', id);

/** A question with four answer buttons. kind 'q' = evening quiz, 'r' = morning review. */
function ask(row: Row, kind: 'q' | 'r', n: number, ref: string, head: string, lead = '') {
  const q = question(row.course, ref)!,
    c = kind === 'q' ? q : q.again;
  return {
    type: 'flex',
    altText: `${head}：${c.q}`.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: BRAND.accent, paddingAll: '12px', contents: [{ type: 'text', text: head, weight: 'bold', color: BRAND.ink, size: 'sm' }] },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.paper,
        spacing: 'md',
        contents: [
          ...(lead ? [{ type: 'text', text: lead, wrap: true, size: 'sm', color: '#6B6A8C' }] : []),
          { type: 'text', text: c.q, wrap: true, weight: 'bold', color: BRAND.ink },
          ...c.options.map((o, i) => ({ type: 'text', text: `${MARK[i]} ${o}`, wrap: true, size: 'sm', color: BRAND.ink })),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: c.options.map((o, i) => ({
          type: 'button',
          style: 'primary',
          color: BRAND.button,
          height: 'sm',
          action: { type: 'postback', label: MARK[i], data: `study:${row.id}:${kind}:${n}:${ref}:${i}`, displayText: `${MARK[i]} ${o}`.slice(0, 60) },
        })),
      },
    },
  };
}
const quizCard = (row: Row, n: number, ref: string) => {
  const refs = session(row.course, row.log, n);
  return ask(row, 'q', n, ref, `📖 ${row.title}・第 ${n} 天　${refs.indexOf(ref) + 1}／${refs.length}`);
};
const reviewCard = (row: Row, n: number, ref: string) => {
  const refs = wrong(row.course, row.log, n);
  return ask(row, 'r', n, ref, `🌅 複習　${refs.indexOf(ref) + 1}／${refs.length}`, `重點：${question(row.course, ref)!.point}`);
};

/** Close a finished course and start the next one waiting, from this evening. */
async function finish(row: Row) {
  await db.from(T('study')).update({ status: 'done' }).eq('id', row.id);
  const { data: next } = await db.from(T('study')).select('id,title').eq('status', 'queued').order('id', { ascending: true }).limit(1).maybeSingle();
  if (next) await db.from(T('study')).update({ status: 'active', start_day: today() }).eq('id', next.id);
  const left = unlearned(row.course, row.log);
  return noticeCard(
    `🎓 「${row.title}」學完了`,
    (left.length ? `還要再看一下的重點：\n${left.slice(0, 8).map((p) => '・' + p).join('\n')}` : '每一個重點你都答對了，太棒了！') +
      (next ? `\n\n下一份「${next.title}」今晚開始。` : ''),
    page() ? { label: '看學習紀錄', uri: page() } : undefined,
  );
}

/** The timed jobs of the 學習 piece: 'studyq' in the evening, 'studyr' the next morning. */
export async function studyJob(kind: 'studyq' | 'studyr', owner: string, line: Line) {
  const row = await activeCourse();
  if (!row) return 'nothing';
  const n = dayNumber(row.start_day, today()),
    days = row.course.days.length;
  if (kind === 'studyq') {
    if (n < 1) return 'nothing';
    // The last morning review was never opened: close the course so the next one can start.
    if (n > days) return n > days + 1 ? (await finish(row), 'closed') : 'nothing';
    const ref = nextQuiz(row.course, row.log, n);
    if (!ref) return 'nothing';
    const total = session(row.course, row.log, n).length;
    await line.push(owner, [
      noticeCard(`📖 今晚的小考：第 ${n}／${days} 天`, `${row.course.days[n - 1].focus}\n\n共 ${total} 題，按下面的 Ａ～Ｄ 作答，答完馬上看解說。睡前考一次，明天早上我再幫你複習。`),
      quizCard(row, n, ref),
    ]);
    return 'sent';
  }
  const m = n - 1; // last night's session
  if (m < 1 || m > days) return 'nothing';
  const s = score(row.course, row.log, m),
    ref = nextReview(row.course, row.log, m);
  if (ref) {
    await line.push(owner, [
      noticeCard('🌅 早安，複習一下昨晚的', `昨晚 ${s.done} 題答對 ${s.right} 題。答錯的 ${wrong(row.course, row.log, m).length} 題我換個問法再問一次。`),
      reviewCard(row, m, ref),
    ]);
    return 'sent';
  }
  const points = session(row.course, row.log, m).map((r) => '・' + question(row.course, r)!.point);
  const recap = s.done
    ? noticeCard('🌅 早安，昨晚全對！', `快速看一眼重點就好：\n${points.slice(0, 6).join('\n')}`)
    : noticeCard('🌅 早安', `昨晚的 ${s.total} 題還沒作答，今晚會再出一次。先看一眼重點：\n${points.slice(0, 6).join('\n')}`);
  await line.push(owner, m === days ? [recap, await finish(row)] : [recap]);
  return 'sent';
}

/** A tap on an answer button. Returns the messages to reply with, or null when it is not ours. */
export async function studyPostback(data: string): Promise<unknown[] | null> {
  const m = data.match(/^study:(\d{1,9}):([qr]):([1-5]):(\d\.\d):([0-3])$/);
  if (!m) return null;
  const row = await activeCourse();
  if (!row || row.id !== Number(m[1])) return [noticeCard('這份考題已經結束', '可以到學習紀錄看結果。', page() ? { label: '看學習紀錄', uri: page() } : undefined)];
  const kind = m[2] as 'q' | 'r',
    n = Number(m[3]),
    ref = m[4];
  const done = answer(row.course, row.log, kind, n, ref, Number(m[5]));
  if (!done) return [noticeCard('這一題已經作答過了', '請回答最新的那一題。')];
  await saveLog(row.id, done.log);
  row.log = done.log;
  const q = question(row.course, ref)!,
    c = kind === 'q' ? q : q.again;
  const result = noticeCard(done.right ? '⭕ 答對了' : '❌ 答錯了', `正確答案：${MARK[c.answer]} ${c.options[c.answer]}\n${c.explain}`);
  const next = kind === 'q' ? nextQuiz(row.course, row.log, n) : nextReview(row.course, row.log, n);
  if (next) return [result, kind === 'q' ? quizCard(row, n, next) : reviewCard(row, n, next)];
  if (kind === 'q') {
    const s = score(row.course, row.log, n);
    return [result, noticeCard(`✅ 今晚考完了：${s.right}／${s.total}`, s.right === s.total ? '全對！好好睡一覺，明天早上我再幫你回顧重點。' : '好好睡一覺，明天早上我會針對答錯的題目幫你複習。')];
  }
  const last = n === row.course.days.length;
  return [result, last ? await finish(row) : noticeCard('🌅 複習完成', '還是答錯的題目，今晚的小考會再出現一次。')];
}

/** Write the questions for every day (one AI call per day, at the same time) and store the course. */
export async function studyCreate(text: string, days: number, quizTime: string) {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return { error: 'unavailable' as const };
  const parts = splitParts(text, days);
  const made = await Promise.all(
    parts.map(async (material, i) => {
      const res = await fetch(`${base}/study`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: crypto.randomUUID(), material, day: i + 1, days, count: PER_DAY }),
        signal: AbortSignal.timeout(110000),
      }).catch(() => null);
      return { status: res?.status ?? 503, data: res?.ok ? await res.json().catch(() => null) : null };
    }),
  );
  if (made.some((m) => m.status === 402)) return { error: 'quota' as const };
  const course = cleanCourse(made.map((m) => m.data));
  if (!course) return { error: 'failed' as const };
  const title = String(made.find((m) => m.data?.title)?.data.title ?? '學習資料').slice(0, 24);
  const busy = Boolean(await activeCourse());
  // Starts this evening when the quiz time has not passed yet, otherwise tomorrow.
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
  const start = today(now < quizTime ? 0 : 1);
  const { error } = await db.from(T('study')).insert({ title, status: busy ? 'queued' : 'active', start_day: start, course, log: emptyLog() });
  if (error) return { error: 'failed' as const };
  return { title, days, total: course.days.reduce((n, d) => n + d.questions.length, 0), queued: busy, start };
}

/** For the ?view=study page: every course with its scores; the active one with its questions. */
export async function studyView() {
  const { data } = await db.from(T('study')).select('id,title,status,start_day,course,log,created_at').order('id', { ascending: false }).limit(12);
  return {
    today: today(),
    courses: (data ?? []).map((r: any) => {
      const log: Log = { ...emptyLog(), ...(r.log ?? {}) },
        course: Course = r.course;
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        start: r.start_day,
        day: dayNumber(r.start_day, today()),
        days: course.days.map((d, i) => ({ focus: d.focus, ...score(course, log, i + 1) })),
        unlearned: r.status === 'queued' ? [] : unlearned(course, log).slice(0, 20),
        questions: r.status === 'active' ? course.days.flatMap((d, di) => d.questions.map((q, i) => ({ ref: `${di + 1}.${i}`, q: q.q, off: Boolean(log.flag[`${di + 1}.${i}`]) }))) : [],
      };
    }),
  };
}

/** Owner actions from the page: remove a course, or take one question out of the quiz. */
export async function studyEdit(body: any) {
  if (!Number.isSafeInteger(body?.id) || body.id < 1) throw Error('invalid_study');
  if (body.action === 'study_delete') {
    const { data } = await db.from(T('study')).delete().eq('id', body.id).select('status');
    // Removing the running course lets the next waiting one start this evening.
    if (data?.[0]?.status === 'active') {
      const { data: next } = await db.from(T('study')).select('id').eq('status', 'queued').order('id', { ascending: true }).limit(1).maybeSingle();
      if (next) await db.from(T('study')).update({ status: 'active', start_day: today() }).eq('id', next.id);
    }
  } else if (/^\d\.\d$/.test(body.ref ?? '')) {
    const { data } = await db.from(T('study')).select('log').eq('id', body.id).maybeSingle();
    if (data) await saveLog(body.id, { ...emptyLog(), ...data.log, flag: { ...(data.log?.flag ?? {}), [body.ref]: true } });
  }
  return studyView();
}
