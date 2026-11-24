import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, icsLinks, sameToken } from '../template/supabase/functions/_shared/ics.ts';

test('timed events become one-hour UTC events; untimed ones are all-day; text is escaped', () => {
  const ics = buildIcs(
    [
      { id: 1, day: '2026-11-27', time: '15:00', title: '開會, 帶報價單;重要' },
      { id: 2, day: '2026-11-30', time: '', title: '交件' },
      { id: 3, day: 'bad', time: '', title: 'x' },
    ],
    '我的秘書',
    'cafe',
    new Date('2026-11-24T00:00:00Z'),
  );
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /UID:cafe-1@oaw\.aprico\r\nDTSTAMP:20261124T000000Z\r\nDTSTART:20261127T070000Z\r\nDTEND:20261127T080000Z\r\nSUMMARY:開會\\, 帶報價單\\;重要/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\nDTEND;VALUE=DATE:20261201/);
  assert.equal(ics.match(/BEGIN:VEVENT/g)?.length, 2);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
});

test('subscription links and token comparison', () => {
  const l = icsLinks('https://abc.supabase.co/functions/v1/cafe-api?ics=tok');
  assert.equal(l.apple, 'webcal://abc.supabase.co/functions/v1/cafe-api?ics=tok');
  assert.match(l.google, /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal%3A%2F%2Fabc/);
  assert.ok(sameToken('abc', 'abc'));
  assert.ok(!sameToken('abc', 'abd'));
  assert.ok(!sameToken('', ''));
  assert.ok(!sameToken('abc', 'abcd'));
});
