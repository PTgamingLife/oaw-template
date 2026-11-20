import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPin, hashPin, validPin } from '../template/supabase/functions/_shared/pin.ts';

test('PIN: only 6 digits that are not trivial', () => {
  assert.ok(validPin('482913'));
  for (const bad of ['12345', '1234567', 'abcdef', '111111', '123456', '654321', 482913])
    assert.ok(!validPin(bad), String(bad));
});

test('PIN: stored as a salted hash and checked exactly', async () => {
  const a = await hashPin('482913'),
    b = await hashPin('482913');
  assert.match(a, /^pbkdf2\$\d+\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b); // a new salt every time
  assert.doesNotMatch(a, /482913/);
  assert.equal(await checkPin('482913', a), true);
  assert.equal(await checkPin('482914', a), false);
  assert.equal(await checkPin('482913', 'garbage'), false);
});

test('owner reset: clears owner and PIN once per request, then binds the new code', async () => {
  const { seedSql } = await import('../scripts/oaw-setup.mjs');
  const nonce = 'a'.repeat(32);
  const sql = seedSql('cafe', { oaName: 'x' }, '135790', nonce);
  const reset = sql.indexOf('update public.cafe_owner set line_user_id = null');
  const bind = sql.indexOf('insert into public.cafe_owner');
  assert.ok(reset > 0 && bind > reset, 'reset runs before the new bind code');
  assert.match(sql, /pin_hash = null/);
  assert.match(sql, new RegExp(`reset_nonce is distinct from '${nonce}'`));
  assert.throws(() => seedSql('cafe', { oaName: 'x' }, '', nonce));
  assert.throws(() => seedSql('cafe', { oaName: 'x' }, '135790', "x'; drop table y;--"));
  assert.doesNotMatch(seedSql('cafe', { oaName: 'x' }, '135790'), /line_user_id = null/);
});
