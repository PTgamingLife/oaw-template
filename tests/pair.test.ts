import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appRef, pairAsked, pairNotice, statusBody } from '../template/supabase/functions/_shared/pair-model.ts';

test('the app tells Aprico which Supabase project it runs in, and nothing else', () => {
  assert.equal(appRef('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
  assert.equal(statusBody('https://abcdefghijklmnopqrst.supabase.co/'), '{"ref":"abcdefghijklmnopqrst"}');
  // Anything that is not a plain project address sends an empty body, as before.
  for (const url of ['', 'http://abcdefghijklmnopqrst.supabase.co', 'https://example.com', 'https://short.supabase.co'])
    assert.equal(statusBody(url), '{}');
});

test('pairing happens only when Aprico asks for it', () => {
  assert.equal(pairAsked({ paid: true, pair: true }), true);
  for (const s of [null, undefined, {}, { pair: 'true' }, { pair: false }]) assert.equal(pairAsked(s), false);
});

test('the notice names the other account and says no code was needed', () => {
  const n = pairNotice('對外官方帳號');
  assert.match(n.title, /已連結/);
  assert.match(n.body, /「對外官方帳號」/);
  assert.match(n.body, /不用輸入配對碼/);
  assert.match(pairNotice(undefined).body, /「另一個帳號」/);
});
