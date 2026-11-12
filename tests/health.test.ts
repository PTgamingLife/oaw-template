import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_THRESHOLDS,
  dueSlots,
  flagReason,
  measure,
  missedSlots,
  parseMeasureText,
  reminders,
  thresholds,
} from '../template/supabase/functions/_shared/health.ts';

test('measurements are validated before anything is saved', () => {
  assert.deepEqual(measure({ kind: 'bp', v1: '135', v2: '85', v3: '' }), {
    kind: 'bp',
    v1: 135,
    v2: 85,
    v3: null,
    tag: '',
  });
  assert.equal(measure({ kind: 'bp', v1: 80, v2: 120 }), null); // diastolic above systolic
  assert.equal(measure({ kind: 'glucose', v1: 900 }), null);
  assert.equal(measure({ kind: 'weight', v1: 62.46 })?.v1, 62.5);
  assert.equal(measure({ kind: 'x', v1: 1 }), null);
});

test('flags follow the elder range, with a higher ceiling after meals', () => {
  const t = DEFAULT_THRESHOLDS;
  assert.match(flagReason(measure({ kind: 'bp', v1: 150, v2: 85 })!, t), /偏高/);
  assert.match(flagReason(measure({ kind: 'bp', v1: 88, v2: 58 })!, t), /偏低/);
  assert.equal(flagReason(measure({ kind: 'bp', v1: 120, v2: 80 })!, t), '');
  assert.match(flagReason(measure({ kind: 'glucose', v1: 140 })!, t), /偏高/);
  assert.equal(flagReason(measure({ kind: 'glucose', v1: 140, tag: 'after' })!, t), '');
  assert.equal(thresholds({ sysHigh: 9999, gluHigh: 120 }).sysHigh, 140);
  assert.equal(thresholds({ gluHigh: 120 }).gluHigh, 120);
});

test('chat shortcuts become measurements', () => {
  assert.deepEqual(parseMeasureText('血壓 135／85 72'), {
    kind: 'bp',
    v1: 135,
    v2: 85,
    v3: 72,
    tag: '',
  });
  assert.equal(parseMeasureText('飯後血糖 160')?.tag, 'after');
  assert.equal(parseMeasureText('體重 62.5')?.v1, 62.5);
  assert.equal(parseMeasureText('吃藥了')?.kind, 'med');
  assert.equal(parseMeasureText('今天天氣好'), null);
});

test('reminders fire once in their window and missed ones after two hours', () => {
  const list = reminders([
    { time: '20:00', kind: 'med', label: '晚上吃藥' },
    { time: '08:00', kind: 'measure', label: '量血壓' },
    { time: '25:00', kind: 'med', label: 'bad' },
  ]);
  assert.deepEqual(
    list.map((r) => r.time),
    ['08:00', '20:00'],
  );
  assert.deepEqual(
    dueSlots(list, '08:10').map((r) => r.slot),
    [0],
  );
  assert.deepEqual(dueSlots(list, '08:15'), []);
  assert.deepEqual(
    missedSlots(list, '10:05', []).map((r) => r.slot),
    [0],
  );
  assert.deepEqual(missedSlots(list, '10:05', [0]), []);
});
