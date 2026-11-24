import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthCells, shiftMonth } from '../liff/calendar.js';

test('month grid: leading blanks for the first weekday, then every date', () => {
  const nov = monthCells('2026-11'); // 1 Nov 2026 is a Sunday
  assert.equal(nov[0], '2026-11-01');
  assert.equal(nov.length, 30);
  const dec = monthCells('2026-12'); // 1 Dec 2026 is a Tuesday
  assert.deepEqual(dec.slice(0, 3), ['', '', '2026-12-01']);
  assert.equal(dec.at(-1), '2026-12-31');
  assert.equal(monthCells('2028-02').filter(Boolean).length, 29);
});

test('month navigation crosses the year', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-11', 0), '2026-11');
});
