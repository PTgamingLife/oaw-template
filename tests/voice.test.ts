import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, cleanOps, currentTalk, newTalk, opLine, transcript } from '../template/supabase/functions/_shared/voice-model.ts';

const NOW = Date.parse('2026-11-29T23:00:00Z');
const move = { op: 'move', id: 7, day: '2026-11-30', time: '11:00', title: '跟王先生開會' };

test('a change is only proposed first; the owner\'s yes applies exactly what was repeated back', () => {
  let t = newTalk(NOW);
  let s = advance(t, '', { say: '早安，今天十點開會。有要調整的嗎？', ops: [], answer: 'none', done: false }, NOW);
  assert.deepEqual(s.apply, []);
  assert.equal(s.more, true);
  s = advance(s.talk, '把十點的會改到十一點', { say: '改到十一點，這樣對嗎？', ops: [move], answer: 'none', done: true }, NOW);
  assert.deepEqual(s.apply, []); // nothing changes yet
  assert.deepEqual(s.talk.pending, [move]);
  assert.equal(s.more, true); // keeps listening for the answer even if the AI said done
  // The AI cannot swap in different changes together with the yes.
  s = advance(s.talk, '對', { say: '好，改好了。', ops: [{ ...move, time: '23:00' }], answer: 'yes', done: false }, NOW);
  assert.deepEqual(s.apply, [move]);
  assert.deepEqual(s.talk.pending, []);
  assert.deepEqual(s.talk.changed, ['改到 11/30 11:00：跟王先生開會']);
});

test('a no drops the proposal; a correction replaces it', () => {
  const t = { ...newTalk(NOW), pending: [move] } as any;
  assert.deepEqual(advance(t, '不對', { say: '那要改成什麼？', ops: [], answer: 'no', done: false }, NOW).talk.pending, []);
  const fixed = { ...move, time: '14:00' };
  const s = advance(t, '不是，改下午兩點', { say: '改到下午兩點，對嗎？', ops: [fixed], answer: 'no', done: false }, NOW);
  assert.deepEqual(s.apply, []);
  assert.deepEqual(s.talk.pending, [fixed]);
});

test('changes are validated again on this side', () => {
  assert.deepEqual(
    cleanOps([
      { op: 'add', id: 0, day: '2026-11-30', time: '15:00', title: ' 取蛋糕 ' },
      { op: 'add', id: 5, day: '2026-11-30', time: '', title: 'x' }, // add never targets an id
      { op: 'remove', id: 0, day: '2026-11-30', time: '', title: 'x' }, // remove needs one
      { op: 'move', id: 3, day: 'tomorrow', time: '', title: 'x' },
      { op: 'move', id: 3, day: '2026-12-01', time: '25:00', title: '看牙醫' },
    ]),
    [
      { op: 'add', id: 0, day: '2026-11-30', time: '15:00', title: '取蛋糕' },
      { op: 'move', id: 3, day: '2026-12-01', time: '', title: '看牙醫' },
    ],
  );
  assert.equal(opLine({ op: 'remove', id: 3, day: '2026-12-01', time: '', title: '看牙醫' }), '取消：看牙醫');
});

test('a talk restarts on an opening call or after a pause; the record lists what changed', () => {
  const old = { at: NOW - 21 * 60000, turns: [{ who: 'owner', text: 'x' }], pending: [move], changed: [] };
  assert.deepEqual(currentTalk(old, NOW, false), newTalk(NOW));
  const live = { ...old, at: NOW - 60000 };
  assert.equal(currentTalk(live, NOW, false).pending.length, 1);
  assert.deepEqual(currentTalk(live, NOW, true), newTalk(NOW));
  assert.equal(transcript(newTalk(NOW)), '');
  const text = transcript({ at: NOW, turns: [{ who: 'secretary', text: '早安' }, { who: 'owner', text: '沒事了' }], pending: [], changed: ['取消：看牙醫'] });
  assert.match(text, /秘書：早安\n你：沒事了/);
  assert.match(text, /已更改\n・取消：看牙醫/);
});
