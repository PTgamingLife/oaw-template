// 每日關心 for one OA app: the morning card with a voice message, and the evening questions.
// Shapes, wording and the step logic live in daily-model.ts; Aprico writes the words
// (/morning, /night) and turns the briefing into speech (/speak), billed to the owner.
import {
  cleanDaily,
  currentNight,
  lastMood,
  MOOD_PREFIX,
  morningCard,
  newNight,
  nightAdvance,
  nightCard,
  NIGHT_FALLBACK,
  scoreTitle,
  secretaryImage,
  type Morning,
} from './daily-model.ts';
import { digestKey } from './digest.ts';
import { ownerLocked } from './guard.ts';
import { syncCron, loadOrbs, sharedPersona } from './orbs.ts';
import { DEFAULT_PERSONA } from './persona.ts';
import { PX } from './px.ts';
import { apricoKey, db, env, loadDaily, onceToday, saveMessage, saveRecords, T } from './store.ts';

type Line = {
  reply: (token: string, messages: unknown[]) => Promise<unknown>;
  push: (to: string, messages: unknown[]) => Promise<unknown>;
};
const taipeiDay = (offset = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000).toISOString().slice(0, 10);
const NIGHT_KEY = 'daily:night';
/** The briefing's audio lives in this OA app's own public bucket; only the newest is kept. */
const VOICE_BUCKET = `${PX}-voice`;

async function aprico(route: string, body: unknown, timeout = 30000) {
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) return null;
  return await fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  }).catch(() => null);
}
const persona = async () => ((await sharedPersona().catch(() => '')) || DEFAULT_PERSONA).slice(0, 800);

// ---- Settings (the 更多設定 page) ----
export async function dailyAction(action: string, body: any) {
  if (action === 'daily_save') {
    const next = cleanDaily(body.daily);
    const { error } = await db.from(T('owner')).update({ daily: next }).eq('id', 1);
    if (error) throw Error('daily_save_failed');
    await syncCron(await loadOrbs());
  }
  const daily = await loadDaily();
  return { daily, available: Boolean(daily) };
}

// ---- 早晨鼓勵 ----
async function morningData(owner: string) {
  const today = taipeiDay(),
    since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [events, todos, life] = await Promise.all([
    db
      .from(T('records'))
      .select('day,time,title')
      .eq('kind', 'event')
      .gte('day', today)
      .lte('day', taipeiDay(1))
      .order('day', { ascending: true })
      .order('time', { ascending: true })
      .limit(30),
    db
      .from(T('records'))
      .select('title')
      .eq('kind', 'todo')
      .eq('done', false)
      .eq('source_id', owner)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(8),
    db
      .from(T('records'))
      .select('day,title,amount')
      .eq('kind', 'life')
      .eq('source_id', owner)
      .gte('day', taipeiDay(-3))
      .order('created_at', { ascending: false })
      .limit(20),
  ]);
  const rows = (life.data ?? []) as { day: string | null; title: string; amount: number | null }[];
  const mood = lastMood(rows, taipeiDay(-1));
  return {
    events: (events.data ?? []).map((e: any) => ({ day: e.day, time: e.time ?? '', title: String(e.title).slice(0, 120) })),
    todos: (todos.data ?? []).map((t: any) => String(t.title).slice(0, 120)),
    // Mood and score lines are sent as `mood`, not repeated as notes.
    notes: rows
      .filter((r) => r.day && r.amount == null && !r.title.startsWith(MOOD_PREFIX))
      .slice(0, 8)
      .map((r) => ({ day: r.day as string, text: r.title.slice(0, 120) })),
    ...(mood ? { mood } : {}),
  };
}

/** The briefing as a LINE audio message, or null when speech is unavailable (the card goes alone). */
async function voiceMessage(say: string, requestId: string) {
  const res = await aprico('speak', { requestId, text: say.slice(0, 320) }, 60000);
  const ms = Number(res?.headers.get('X-Audio-Ms'));
  if (!res?.ok || !(ms > 0)) return null;
  const audio = new Uint8Array(await res.arrayBuffer());
  const made = await db.storage.createBucket(VOICE_BUCKET, {
    public: true,
    fileSizeLimit: 2_000_000,
    allowedMimeTypes: ['audio/mpeg'],
  });
  if (made.error && !/exist/i.test(made.error.message)) return null;
  const bucket = db.storage.from(VOICE_BUCKET);
  const { data: old } = await bucket.list('', { limit: 50 });
  // The name is random: the address is only ever sent to the owner's own chat.
  const name = `${crypto.randomUUID().replaceAll('-', '')}.mp3`;
  const { error } = await bucket.upload(name, audio, { contentType: 'audio/mpeg', cacheControl: '86400' });
  if (error) return null;
  if (old?.length) await bucket.remove(old.map((f) => f.name)).catch(() => null);
  return {
    type: 'audio',
    originalContentUrl: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/${VOICE_BUCKET}/${name}`,
    duration: ms,
  };
}

export async function runMorning(owner: string, line: Line) {
  const daily = await loadDaily();
  if (!daily?.morning.on) return 'off';
  if ((await ownerLocked()) === true) return 'locked';
  if (!(await onceToday('daily-morning'))) return 'already_sent';
  const rid = `morning-${taipeiDay()}-${crypto.randomUUID().slice(0, 8)}`;
  const res = await aprico('morning', { requestId: rid, ...(await morningData(owner)), persona: await persona() }, 45000);
  // Out of quota or unreachable: a quiet morning, nothing is sent.
  if (res?.status === 402) return 'quota';
  const m = (res?.ok ? await res.json().catch(() => null) : null) as Morning | null;
  if (typeof m?.say !== 'string' || typeof m.headline !== 'string' || !Array.isArray(m.points)) return 'failed';
  const voice = await voiceMessage(m.say, `speak-${rid}`).catch(() => null);
  await line.push(owner, [morningCard(m, secretaryImage(env('PAGES_URL')), env('LIFF_URL')), ...(voice ? [voice] : [])]);
  return voice ? 'sent' : 'sent_card_only';
}

// ---- 晚間關心 ----
const saveNight = (talk: unknown) =>
  db.from(T('pending')).upsert({ line_user_id: NIGHT_KEY, proposal: talk, created_at: new Date().toISOString() });
const endNight = () => db.from(T('pending')).delete().eq('line_user_id', NIGHT_KEY);

/**
 * Why tonight's organise run should wait, or '' to run now. With the evening questions on,
 * the summary card comes last: not before the questions are asked, and not while they are
 * open (the run starts right after the last answer; the timed run is the fallback).
 */
export async function organiseHold() {
  const daily = await loadDaily().catch(() => null);
  if (!daily?.night.on) return '';
  const { data } = await db
    .from(T('pending'))
    .select('line_user_id,proposal')
    .in('line_user_id', [NIGHT_KEY, 'notice:daily-night']);
  const row = (id: string) => data?.find((r: { line_user_id: string }) => r.line_user_id === id)?.proposal;
  if (currentNight(row(NIGHT_KEY), Date.now())) return 'night_open';
  const clock = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16);
  const asked = row('notice:daily-night')?.day === taipeiDay();
  return !asked && clock >= '12:00' && clock < daily.night.time ? 'before_night' : '';
}

export async function runNight(owner: string, line: Line) {
  const daily = await loadDaily();
  if (!daily?.night.on) return 'off';
  if ((await ownerLocked()) === true) return 'locked';
  if (!(await onceToday('daily-night'))) return 'already_sent';
  await saveNight(newNight(Date.now()));
  await line.push(owner, [nightCard(secretaryImage(env('PAGES_URL')))]);
  return 'asked';
}

/** Start tonight's organise run now (the summary card comes last). Fire and forget. */
function organiseNow() {
  const secret = env('LINE_MSG_SECRET');
  const run = digestKey(secret, new Date().toISOString().slice(0, 10)).then((key) =>
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/${PX}-digest`, {
      method: 'POST',
      headers: { 'x-oaw-digest': key },
      signal: AbortSignal.timeout(120000),
    }).catch(() => null),
  );
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(run);
  else void run;
}

/**
 * The owner's free text while tonight's questions are open. Returns false when no talk is
 * open (the text is handled as usual). Answers are replies, so they use no push quota.
 */
export async function nightAnswer(event: any, owner: string, line: Line) {
  const { data } = await db.from(T('pending')).select('proposal').eq('line_user_id', NIGHT_KEY).maybeSingle();
  const talk = currentNight(data?.proposal, Date.now());
  if (!talk) return false;
  const step = nightAdvance(talk, String(event.message.text), Date.now());
  // What to record is a note for the organise run; mood and score are life records as they are.
  if (!step.done && step.plans) await saveMessage(owner, true, step.plans, owner);
  if (step.mood)
    await saveRecords([
      { kind: 'life', day: taipeiDay(), time: '', title: (MOOD_PREFIX + step.mood).slice(0, 200), amount: null, source_id: owner },
    ]);
  if (!step.done) {
    await saveNight(step.talk);
    await line.reply(event.replyToken, [step.reply]);
    return true;
  }
  await endNight();
  if (step.score)
    await saveRecords([
      { kind: 'life', day: taipeiDay(), time: '', title: scoreTitle(step.score), amount: step.score, source_id: owner },
    ]);
  const res = await aprico('night', {
    requestId: String(event.webhookEventId ?? crypto.randomUUID()),
    plans: step.talk.plans,
    mood: step.talk.mood,
    score: step.score,
    persona: await persona(),
  });
  const out = res?.ok ? await res.json().catch(() => null) : null;
  await line.reply(event.replyToken, [
    { type: 'text', text: typeof out?.say === 'string' && out.say ? out.say.slice(0, 400) : NIGHT_FALLBACK },
  ]);
  organiseNow();
  return true;
}
