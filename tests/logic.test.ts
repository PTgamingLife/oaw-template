import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  validateConfig,
  verifySignature,
  textIntent,
  postbackCell,
  cellMessage,
  menuAreas,
  richMenu,
  publicConfig,
} from '../template/supabase/functions/_shared/logic.ts';

const config = validateConfig(JSON.parse(readFileSync('oaw/config.json', 'utf8')));

test('default config is valid', () => {
  assert.equal(config.grid, 4);
  assert.equal(config.cells.length, 8);
});

test('config validation rejects bad input', () => {
  const bad = (patch: object) => assert.throws(() => validateConfig({ ...config, ...patch }));
  bad({ grid: 5 });
  bad({ theme: 99 });
  bad({ cells: config.cells.slice(0, 4) });
  bad({ welcome: 'x'.repeat(501) });
  const cells = structuredClone(config.cells);
  cells[1] = { label: '網站', action: 'web', content: 'javascript:alert(1)' };
  bad({ cells });
  cells[1] = { label: '網站', action: 'web', content: 'http://example.com' };
  bad({ cells });
  cells[1] = { label: '網站', action: 'web', content: 'https://example.com' };
  assert.equal(validateConfig({ ...config, cells }).cells[1].content, 'https://example.com');
});

test('signature matches LINE HMAC-SHA256 base64 and rejects tampering', async () => {
  const body = '{"events":[]}',
    secret = 'a'.repeat(32);
  const sig = createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(await verifySignature(secret, body, sig), true);
  assert.equal(await verifySignature(secret, body + ' ', sig), false);
  assert.equal(await verifySignature('b'.repeat(32), body, sig), false);
  assert.equal(await verifySignature(secret, body, null), false);
  assert.equal(await verifySignature('', body, sig), false);
});

test('text intents: owner-only commands are ignored for other users', () => {
  assert.deepEqual(textIntent('123456', config, false), { kind: 'bind', code: '123456' });
  assert.deepEqual(textIntent('營業時間', config, false), { kind: 'cell', index: 2 });
  assert.deepEqual(textIntent('修改：第 3 格改成預約', config, true), {
    kind: 'design',
    request: '第 3 格改成預約',
  });
  assert.equal(textIntent('修改：第 3 格改成預約', config, false).kind, 'fallback');
  assert.equal(textIntent('套用', config, true).kind, 'apply');
  assert.equal(textIntent('套用', config, false).kind, 'fallback');
  assert.equal(textIntent('你好', { ...config, secretary: true }, false).kind, 'secretary');
  // Empty labels beyond the grid never match.
  assert.equal(textIntent('', config, false).kind, 'fallback');
});

test('postback only accepts cells inside the grid', () => {
  assert.equal(postbackCell('cell=1', config), 1);
  assert.equal(postbackCell('cell=5', config), -1);
  assert.equal(postbackCell('cell=1&x', config), -1);
});

test('cell replies: text or themed card, failure text when empty', () => {
  assert.deepEqual(cellMessage(config, 2), { type: 'text', text: '週一至週五 10:00–18:00' });
  const card = cellMessage(config, 1) as any;
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.header.backgroundColor, '#DDD5BC');
  assert.equal((cellMessage(config, 0) as any).text, config.failure);
});

test('menu areas tile the 1200x810 image for every grid size', () => {
  for (const grid of [4, 6, 8]) {
    const areas = menuAreas(grid);
    assert.equal(areas.length, grid);
    const total = areas.reduce((s, a) => s + a.bounds.width * a.bounds.height, 0);
    assert.equal(total, 1200 * 810);
  }
});

test('rich menu maps actions; LIFF url only for full cells', () => {
  const menu = richMenu(config, 'cafe', 'https://liff.line.me/123-abc');
  assert.equal(menu.name, 'cafe-main');
  assert.deepEqual(menu.areas[0].action, {
    type: 'uri',
    label: '會員卡',
    uri: 'https://liff.line.me/123-abc?cell=0',
  });
  assert.equal(menu.areas[1].action.type, 'postback');
  assert.equal((menu.areas[1].action as any).data, 'cell=1');
});

test('public config exposes only menu data', () => {
  const pub = publicConfig(config);
  assert.deepEqual(Object.keys(pub).sort(), ['cells', 'colors', 'grid', 'oaName', 'theme']);
  assert.equal(pub.cells.length, 4);
});

test('connect codes from the Aprico OA are recognised for anyone', () => {
  const cfg = JSON.parse(readFileSync(new URL('../oaw/config.json', import.meta.url), 'utf8'));
  assert.deepEqual(textIntent('連接 abcdefghjk', cfg, false), {
    kind: 'connect',
    code: 'ABCDEFGHJK',
  });
  assert.deepEqual(textIntent('連接ABCDEFGHJK', cfg, false), {
    kind: 'connect',
    code: 'ABCDEFGHJK',
  });
  assert.notEqual(textIntent('連接 ABCDEFGHJ0', cfg, false).kind, 'connect');
});
