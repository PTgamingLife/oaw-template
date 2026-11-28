import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { changedBits, linesToBits, reading, yaoLabel } from '../liff/divine-model.js';

const book = JSON.parse(readFileSync(new URL('../liff/iching.json', import.meta.url), 'utf8'));

test('the book holds all 64 hexagrams, each with six line texts', () => {
  assert.equal(book.length, 64);
  assert.equal(new Set(book.map((h: any) => h.bits)).size, 64);
  assert.deepEqual(book.map((h: any) => h.no), Array.from({ length: 64 }, (_, i) => i + 1));
  assert.ok(book.every((h: any) => /^[01]{6}$/.test(h.bits) && h.lines.length === 6 && h.name && h.full && h.judgment && h.plain));
});

test('lines become a hexagram; 6 and 9 change into their opposite', () => {
  assert.equal(linesToBits([7, 8, 9, 7, 6, 8]), '101100');
  assert.equal(changedBits([7, 8, 9, 7, 6, 8]), '100110');
  assert.equal(changedBits([7, 8, 7, 8, 7, 8]), '');
  assert.deepEqual([yaoLabel(0, 9), yaoLabel(1, 8), yaoLabel(5, 6)], ['初九', '六二', '上六']);
});

test('a reading gives the main hexagram, the changing lines and the hexagram it turns into', () => {
  // 乾 with only the first line changing → 姤; the text is 乾's first line.
  const r = reading([9, 7, 7, 7, 7, 7], book)!;
  assert.equal(r.main.name, '乾');
  assert.deepEqual(r.moving, ['初九：潛龍勿用。']);
  assert.equal(r.changed.name, '姤');
  // No changing line: the main hexagram alone.
  const still = reading([8, 8, 8, 8, 8, 8], book)!;
  assert.deepEqual([still.main.name, still.moving, still.changed], ['坤', [], null]);
  // All six change: 乾 uses 用九 and turns into 坤.
  const all = reading([9, 9, 9, 9, 9, 9], book)!;
  assert.deepEqual([all.moving, all.changed.name], [['用九：見羣龍无首，吉。'], '坤']);
  // All six change in a hexagram without 用九／用六: its six line texts.
  assert.equal(reading([9, 6, 9, 6, 9, 6], book)!.moving.length, 6);
  assert.equal(reading([7, 7, 7], book), null);
});

test('the server throws three coins per line, keeps at most six lines a day and thirty days', async () => {
  const { addYao, castYao, cleanDivine } = await import('../template/supabase/functions/_shared/divine-model.ts');
  for (let i = 0; i < 50; i++) {
    const y = castYao();
    assert.ok([6, 7, 8, 9].includes(y.value) && y.coins.every((c: number) => c === 2 || c === 3));
  }
  let all: any = {};
  for (let i = 0; i < 8; i++) all = addYao(all, '2026-12-01', { value: 7, coins: [2, 2, 3] }, 'T');
  assert.equal(all['2026-12-01'].lines.length, 6);
  assert.equal(all['2026-12-01'].at, 'T');
  // A new day starts empty; days beyond thirty are dropped, oldest first.
  for (let d = 1; d <= 31; d++) all = addYao(all, `2026-11-${String(d).padStart(2, '0')}`.replace('2026-11-31', '2026-12-02'), { value: 8, coins: [2, 3, 3] });
  assert.equal(Object.keys(all).length, 30);
  assert.ok(!('2026-11-01' in all) && !('2026-11-02' in all));
  assert.deepEqual(Object.keys(cleanDivine({ '2026-12-01': { lines: [7, 5] }, bad: { lines: [7] }, '2026-12-02': { lines: [6, 9], coins: [] } })), ['2026-12-02']);
});
