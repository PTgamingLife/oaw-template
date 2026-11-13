import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  digestCard,
  digestKey,
  digestRows,
} from '../template/supabase/functions/_shared/digest.ts';

const sample = {
  events: [{ date: '2026-11-13', time: '15:00', title: '看牙醫' }],
  expenses: [
    { date: '2026-11-12', amount: 120, note: '午餐' },
    { date: '2026-11-12', amount: 80, note: '' },
  ],
  todos: [{ text: '週五前交報價單' }],
  life: [],
  summary: '今天也辛苦了',
};

test('digest key is the HMAC both the workflow and the function compute', async () => {
  const expected = createHmac('sha256', 's'.repeat(32))
    .update('oaw-digest:2026-11-12')
    .digest('hex');
  assert.equal(await digestKey('s'.repeat(32), '2026-11-12'), expected);
  assert.notEqual(await digestKey('s'.repeat(32), '2026-11-13'), expected);
});

test('record rows all share the same keys for bulk insert', () => {
  const rows = digestRows(sample);
  assert.equal(rows.length, 4);
  for (const r of rows)
    assert.deepEqual(Object.keys(r).sort(), ['amount', 'day', 'kind', 'time', 'title']);
  assert.deepEqual(rows[2], {
    kind: 'expense',
    day: '2026-11-12',
    time: '',
    title: '支出',
    amount: 80,
  });
});

test('summary card lists sections with a total, and is skipped when empty', () => {
  const json = JSON.stringify(digestCard(sample, 'https://liff.line.me/1-a'));
  for (const s of ['看牙醫', '共 200 元', '週五前交報價單', '今天也辛苦了', '?view=secretary'])
    assert.ok(json.includes(s), s);
  assert.ok(!json.includes('生活紀錄'));
  assert.equal(digestCard({ summary: 'x' }), null);
});
