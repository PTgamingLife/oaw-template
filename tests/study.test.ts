import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answer, cleanCourse, cleanMaterial, dayNumber, emptyLog, minDays, nextQuiz, nextReview, score, session, splitParts, unlearned, wrong,
} from '../template/supabase/functions/_shared/study-model.ts';

const q = (name: string) => ({
  q: name, options: ['甲', '乙', '丙', '丁'], answer: 0, explain: '因為甲', point: `${name}的重點`,
  again: { q: name + '（換個問法）', options: ['一', '二', '三', '四'], answer: 2, explain: '因為三' },
});
const course = { days: [{ focus: '第一部分', questions: [q('A'), q('B')] }, { focus: '第二部分', questions: [q('C')] }] };
const run = (log: any, steps: [('q' | 'r'), number, string, number][]) => {
  for (const [k, n, ref, pick] of steps) log = answer(course, log, k, n, ref, pick)!.log;
  return log;
};

test('material is tidied, limited, and split into parts that fit one day each', () => {
  const m = cleanMaterial('﻿第一段  有  空白\r\n\r\n\r\n\r\n第二段');
  assert.equal(m.text, '第一段 有 空白\n\n第二段');
  assert.equal(cleanMaterial('字'.repeat(13000)).cut, true);
  assert.deepEqual([minDays(500), minDays(6001), minDays(12000), minDays(99999)], [1, 2, 2, 5]);
  const text = Array.from({ length: 30 }, (_, i) => `第 ${i} 段。` + '內容'.repeat(60)).join('\n\n');
  const parts = splitParts(text, 3);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length > text.length / 5 && p.length <= 6000));
  assert.ok(parts.every((p) => p.startsWith('第 '))); // cut at paragraph ends
  assert.equal(parts.join('').replace(/\s/g, '').length, text.replace(/\s/g, '').length); // nothing lost
});

test('an evening asks the day\'s questions in order; only the waiting question can be answered', () => {
  let log = emptyLog();
  assert.deepEqual(session(course, log, 1), ['1.0', '1.1']);
  assert.equal(nextQuiz(course, log, 1), '1.0');
  assert.equal(answer(course, log, 'q', 1, '1.1', 0), null); // not its turn
  assert.equal(answer(course, log, 'q', 1, '1.0', 7), null); // not an option
  const a = answer(course, log, 'q', 1, '1.0', 0)!;
  assert.equal(a.right, true);
  assert.equal(answer(course, a.log, 'q', 1, '1.0', 1), null); // already answered: an old button does nothing
  log = run(a.log, [['q', 1, '1.1', 3]]);
  assert.deepEqual(score(course, log, 1), { total: 2, done: 2, right: 1 });
  assert.equal(nextQuiz(course, log, 1), null);
});

test('the morning reviews last night\'s mistakes with the second question; still wrong comes back that evening', () => {
  let log = run(emptyLog(), [['q', 1, '1.0', 0], ['q', 1, '1.1', 3]]);
  assert.deepEqual(wrong(course, log, 1), ['1.1']);
  assert.equal(nextReview(course, log, 1), '1.1');
  // Right in the review: learned, it does not come back.
  const ok = run(log, [['r', 1, '1.1', 2]]);
  assert.deepEqual(session(course, ok, 2), ['2.0']);
  // Wrong again: asked once more on the evening of day 2, after that day's own questions.
  log = run(log, [['r', 1, '1.1', 0]]);
  assert.deepEqual(session(course, log, 2), ['2.0', '1.1']);
  log = run(log, [['q', 2, '2.0', 0], ['q', 2, '1.1', 0]]);
  assert.deepEqual(unlearned(course, log), []);
});

test('unanswered questions come back; removed questions are never asked; the end lists what is not learned', () => {
  const log = run(emptyLog(), [['q', 1, '1.0', 1]]); // 1.0 wrong, 1.1 never answered, no review done
  assert.deepEqual(session(course, log, 2), ['2.0', '1.1']);
  assert.deepEqual(session(course, { ...log, flag: { '1.1': true } }, 2), ['2.0']);
  assert.deepEqual(unlearned(course, log), ['A的重點', 'B的重點', 'C的重點']);
  assert.deepEqual([dayNumber('2026-11-28', '2026-11-28'), dayNumber('2026-11-28', '2026-12-01')], [1, 4]);
  assert.deepEqual(session(course, log, 3), []);
});

test('a course from the AI service is checked again; a day without usable questions fails the whole course', () => {
  const good = cleanCourse([{ focus: 'f', questions: [q('A'), { q: '壞', options: ['一'], answer: 0 }] }])!;
  assert.equal(good.days[0].questions.length, 1);
  assert.equal(cleanCourse([{ focus: 'f', questions: [q('A')] }, { focus: 'g', questions: [] }]), null);
  assert.equal(cleanCourse([]), null);
});

test('the 學習 piece: default times, own chat only, an evening and a morning job', async () => {
  const { cleanParams, explainPiece, localIssues } = await import('../template/supabase/functions/_shared/orb-model.ts');
  const { cronJobs, parseJob } = await import('../template/supabase/functions/_shared/orb-logic.ts');
  assert.deepEqual(cleanParams('study', {}), { time: '21:00', review: '07:30' });
  assert.deepEqual(cleanParams('study', { time: '22:15', review: '06:00' }), { time: '22:15', review: '06:00' });
  assert.deepEqual(cleanParams('study', { time: '25:00', review: 'early' }), { time: '21:00', review: '07:30' });
  const piece = { id: 2, type: 'study', text: '每晚考我', x: 0.5, y: 0.5, params: { time: '21:00', review: '07:30' } } as any;
  const orb = { slot: 1, name: '學習', target: 'me', on: true, face: '', template: '', persona: '', pieces: [piece], links: [] } as any;
  assert.match(explainPiece(piece, orb), /每天 21:00 考當天的題目，隔天 07:30 複習/);
  assert.deepEqual(localIssues(orb, [orb]), []);
  assert.equal(localIssues({ ...orb, target: 'C' + 'a'.repeat(32) }, [orb])[0].code, 'me_only');
  // 21:00 and 07:30 in Taipei are 13:00 and 23:30 UTC.
  assert.deepEqual(cronJobs([orb]).slice(1), [{ name: 'studyq-1-2', cron: '0 13 * * *' }, { name: 'studyr-1-2', cron: '30 23 * * *' }]);
  assert.deepEqual(parseJob('studyr-1-2'), { kind: 'studyr', slot: 1, piece: 2 });
  assert.deepEqual(cronJobs([{ ...orb, on: false }]).length, 1); // an orb that is off schedules nothing
});
