import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFit, excerpt, fitFileOk } from '../template/supabase/functions/_shared/fit-model.ts';

test('an exported chat is cut to its recent part; numbers and links are masked before it leaves', () => {
  const raw =
    '﻿[LINE] 與社團的聊天記錄\r\n儲存日期：2026/11/28\r\n\r\n' +
    '10:30\t小明\t我的電話 0912-345-678，帳號 123456789012\r\n' +
    '10:31\t小華\t看這個 https://example.com/a?b=1 好嗎\r\n' +
    '10:32\t小明\t明天 8 點、3 個人、預算 1200 元\r\n';
  const out = excerpt(raw);
  assert.ok(!/0912|123456789012|example\.com/.test(out));
  assert.match(out, /我的電話 〔號碼〕，帳號 〔號碼〕/);
  assert.match(out, /看這個 〔連結〕 好嗎/);
  assert.match(out, /明天 8 點、3 個人、預算 1200 元/); // ordinary numbers stay
  assert.ok(!out.includes('\n\n'));
  // Only the newest lines are kept, whole lines only.
  const long = Array.from({ length: 500 }, (_, i) => `09:00\t我\t第 ${i} 行的內容`).join('\n');
  const cut = excerpt(long, 600);
  assert.ok(cut.length <= 600);
  assert.ok(cut.endsWith('第 499 行的內容'));
  assert.ok(cut.startsWith('09:00'));
});

test('only .txt files of a sane size are accepted', () => {
  assert.equal(fitFileOk({ type: 'file', fileName: '[LINE] 聊天.TXT', fileSize: 20000 }), true);
  assert.equal(fitFileOk({ type: 'file', fileName: 'photo.jpg', fileSize: 20000 }), false);
  assert.equal(fitFileOk({ type: 'file', fileName: 'big.txt', fileSize: 6_000_000 }), false);
  assert.equal(fitFileOk({ type: 'image' }), false);
});

test('the saved result is checked again before the page shows it', () => {
  const out = cleanFit({ summary: '你最常被問集合時間。', items: [{ title: '集合提醒', why: '常被問', often: 5, fit: 5, text: '這個群組是社團，幫我記下集合時間。' }, { title: '壞的', text: '' }, null] })!;
  assert.equal(out.items.length, 1);
  assert.equal(cleanFit({ items: [] }), null);
  assert.equal(cleanFit(null), null);
});
