import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { inputs, normalizeBindCode, render, seedSql } from '../scripts/oaw-setup.mjs';

test('inputs validate the prefix and derive the Pages URL', () => {
  const env = { OAW_PX: 'cafe', GITHUB_REPOSITORY: 'Someone/cafe-oa' };
  assert.deepEqual(inputs(env), {
    px: 'cafe',
    UP: 'CAFE',
    pagesOrigin: 'https://someone.github.io',
    pagesUrl: 'https://someone.github.io/cafe-oa/',
  });
  assert.equal(inputs({ ...env, OAW_PX: ' Cafe ' }).px, 'cafe');
  for (const px of ['', 'a', '1abc', 'toolongname', 'ca-fe'])
    assert.throws(() => inputs({ ...env, OAW_PX: px }));
});

test('render applies the prefix to SQL, function folders and px.ts', () => {
  const out = 'build-test';
  const sql = render('cafe', out);
  try {
    assert.ok(!sql.includes('__px__'));
    assert.match(sql, /create table if not exists public\.cafe_config/);
    assert.match(sql, /enable row level security/);
    assert.ok(existsSync(`${out}/supabase/functions/cafe-webhook/index.ts`));
    assert.ok(existsSync(`${out}/supabase/functions/cafe-api/index.ts`));
    assert.equal(
      readFileSync(`${out}/supabase/functions/_shared/px.ts`, 'utf8'),
      "export const PX = 'cafe';\n",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('seed SQL stores only a hash of the bind code and never overwrites a bound owner', () => {
  const sql = seedSql('cafe', { oaName: 'x' }, '123456');
  assert.ok(!sql.includes('123456'));
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /where public\.cafe_owner\.line_user_id is null/);
  assert.throws(() => seedSql('cafe', { oaName: 'x' }, '12345'));
  assert.throws(() => seedSql('cafe', { oaName: '$oaw$' }, ''));
});

test('bind code accepts full-width digits, spaces and dashes', () => {
  assert.equal(normalizeBindCode('１２３ ４５６'), '123456');
  assert.equal(normalizeBindCode('123-456'), '123456');
  assert.match(seedSql('cafe', { oaName: 'x' }, '１２３４５６'), /cafe_owner/);
});

test('owner menu splits 2500x843 into two settings links', async () => {
  const { ownerMenu } = await import('../scripts/oaw-setup.mjs');
  const m = ownerMenu('cafe', 'https://liff.line.me/1-a');
  assert.equal(m.name, 'cafe-owner');
  assert.deepEqual(
    m.areas.map((a) => a.action.uri),
    ['https://liff.line.me/1-a?view=secretary', 'https://liff.line.me/1-a?view=interface'],
  );
  assert.equal(m.areas[0].bounds.width + m.areas[1].bounds.width, 2500);
});
