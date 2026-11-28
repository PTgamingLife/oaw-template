import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_DEFAULT,
  MOOD_PREFIX,
  NIGHT_Q1,
  NIGHT_Q2,
  NIGHT_Q3,
  NIGHT_WAIT_MINUTES,
  addMinutes,
  cleanDaily,
  currentNight,
  isSkip,
  isStop,
  lastMood,
  morningCard,
  newNight,
  nightAdvance,
  nightCard,
  parseScore,
  scoreTitle,
  secretaryImage,
} from '../template/supabase/functions/_shared/daily-model.ts';
import { cronJobs } from '../template/supabase/functions/_shared/orb-logic.ts';

const NOW = Date.parse('2026-11-30T13:30:00Z'); // 21:30 in Taipei

test('settings: both routines are on by default; times must fit their part of the day', () => {
  assert.deepEqual(cleanDaily(null), DAILY_DEFAULT);
  assert.deepEqual(cleanDaily({ morning: { on: false, time: '06:15' }, night: { on: true, time: '22:00' } }), {
    morning: { on: false, time: '06:15' },
    night: { on: true, time: '22:00' },
  });
  // A morning time in the afternoon, a night time after 23:00 and junk fall back to the defaults.
  assert.deepEqual(cleanDaily({ morning: { on: 'yes', time: '15:00' }, night: { time: '23:30' } }), DAILY_DEFAULT);
  assert.equal(cleanDaily({ night: { time: '9pm' } }).night.time, '21:30');
});

test('cron jobs: the summary waits for the evening questions; morning and night get their own jobs', () => {
  assert.deepEqual(cronJobs([], DAILY_DEFAULT), [
    { name: 'digest', cron: '30 14 * * *' }, // 22:30 Taipei: one hour after the questions
    { name: 'morning', cron: '30 23 * * *' },
    { name: 'night', cron: '30 13 * * *' },
  ]);
  // Evening questions off: the organise run keeps its old time and nothing else is added.
  const off = { morning: { on: false, time: '07:30' }, night: { on: false, time: '21:30' } };
  assert.deepEqual(cronJobs([], off), [{ name: 'digest', cron: '55 12 * * *' }]);
  assert.deepEqual(cronJobs([]), [{ name: 'digest', cron: '55 12 * * *' }]);
  assert.equal(addMinutes('22:59', NIGHT_WAIT_MINUTES), '23:55'); // never past midnight
});

test('skip, stop and score words', () => {
  for (const t of ['沒有', '沒有。', ' 跳過 ', '不用了', '沒事～', 'skip']) assert.equal(isSkip(t), true, t);
  for (const t of ['沒有時間運動', '明天沒有會議', '跳過早餐很餓']) assert.equal(isSkip(t), false, t);
  assert.equal(isStop('先這樣'), true);
  assert.equal(isStop('先這樣安排明天的會'), false);
  assert.deepEqual(
    ['8', '8分', '我給 7 分', '１０', '八分吧', '十分', '10/10', '3.5', '100', '還不錯'].map(parseScore),
    [8, 8, 7, 10, 8, 10, 10, 0, 0, 0],
  );
});

test('the evening talk: three questions, answers kept, then done', () => {
  let s = nightAdvance(newNight(NOW), '明天下午三點跟王先生開會', NOW);
  assert.equal(s.done, false);
  assert.equal((s as any).plans, '明天下午三點跟王先生開會'); // becomes a note for tonight's organise run
  assert.equal((s as any).reply.text, NIGHT_Q2);
  assert.match(NIGHT_Q2, /說出來、寫下來，心情就會更好/);
  s = nightAdvance(s.talk, '今天提案過了很開心，但有點擔心下週的報告', NOW);
  assert.equal((s as any).mood, '今天提案過了很開心，但有點擔心下週的報告');
  assert.equal((s as any).reply.text, NIGHT_Q3);
  assert.equal((s as any).reply.quickReply.items.length, 11); // 1–10 and 跳過
  s = nightAdvance(s.talk, '8', NOW);
  assert.deepEqual([s.done, (s as any).score], [true, 8]);
  assert.equal(s.talk.plans, '明天下午三點跟王先生開會');
  assert.equal(s.talk.mood, '今天提案過了很開心，但有點擔心下週的報告');
});

test('the evening talk: skipping, stopping, and a score that is not a number', () => {
  let s = nightAdvance(newNight(NOW), '沒有', NOW);
  assert.equal('plans' in s, false);
  s = nightAdvance(s.talk, '跳過', NOW);
  assert.equal('mood' in s, false);
  const again = nightAdvance(s.talk, '還可以啦', NOW);
  assert.equal(again.done, false); // asked once more
  assert.deepEqual([nightAdvance(again.talk, '嗯', NOW).done, (nightAdvance(again.talk, '嗯', NOW) as any).score], [true, 0]);
  assert.deepEqual([nightAdvance(s.talk, '跳過', NOW).done, (nightAdvance(s.talk, '跳過', NOW) as any).score], [true, 0]);
  // 「先這樣」 ends the talk at any step, keeping what was already said.
  const stop = nightAdvance({ ...newNight(NOW), step: 2, plans: '買花' }, '先這樣', NOW);
  assert.deepEqual([stop.done, stop.talk.plans], [true, '買花']);
});

test('the talk closes by itself after the waiting time', () => {
  const t = newNight(NOW);
  assert.equal(currentNight(t, NOW + 59 * 60000)?.step, 1);
  assert.equal(currentNight(t, NOW + (NIGHT_WAIT_MINUTES + 1) * 60000), null);
  assert.equal(currentNight(null, NOW), null);
  assert.equal(currentNight({ at: NOW, step: 9 }, NOW), null);
});

test("last night's mood and score are found for the morning", () => {
  const rows = [
    { day: '2026-11-29', title: scoreTitle(4), amount: 4 },
    { day: '2026-11-29', title: MOOD_PREFIX + '有點累', amount: null },
    { day: '2026-11-28', title: scoreTitle(9), amount: 9 },
    { day: '2026-11-29', title: '跑步五公里', amount: null },
  ];
  assert.deepEqual(lastMood(rows, '2026-11-29'), { text: '有點累', score: 4 });
  assert.deepEqual(lastMood(rows, '2026-11-28'), { text: '', score: 9 });
  assert.equal(lastMood(rows, '2026-11-27'), null);
});

test('cards carry the secretary picture and stay within LINE limits', () => {
  assert.equal(secretaryImage('https://me.github.io/app'), 'https://me.github.io/app/assets/secretary.png');
  assert.equal(secretaryImage(''), '');
  const m = { headline: '早安，今天有兩件事', points: ['10:00 跟王先生開會', '記得買牛奶'], cheer: '慢慢來，你可以的', say: '早安' };
  const card: any = morningCard(m, 'https://me.github.io/app/assets/secretary.png', 'https://liff.line.me/1-a');
  assert.equal(card.contents.hero.url, 'https://me.github.io/app/assets/secretary.png');
  assert.match(JSON.stringify(card.contents.body), /跟王先生開會/);
  assert.equal(card.contents.footer.contents[0].action.uri, 'https://liff.line.me/1-a?view=calendar');
  assert.equal('hero' in (morningCard(m) as any).contents, false); // no picture address: the card still works
  const night: any = nightCard('https://me.github.io/app/assets/secretary.png');
  assert.match(JSON.stringify(night.contents.body), new RegExp(NIGHT_Q1));
  assert.deepEqual(night.quickReply.items.map((i: any) => i.action.text), ['沒有', '先這樣']);
});
