import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES,
  askCard,
  exampleCard,
  matchExample,
  SECRETARY_TEMPLATES,
  quotaCard,
} from '../template/supabase/functions/_shared/onboarding.ts';

test('free text maps to the closest example', () => {
  assert.equal(matchExample('我希望你幫我記事').id, 'schedule');
  assert.equal(matchExample('幫我記帳，午餐花了多少錢').id, 'expense');
  assert.equal(matchExample('提醒長輩量血壓').id, 'health');
  assert.equal(matchExample('我想改選單顏色').id, 'interface');
  assert.equal(matchExample('隨便').id, 'schedule'); // fallback
});

test('every quick-reply answer maps back to its own example', () => {
  for (const item of (askCard() as any).quickReply.items) {
    assert.ok(item.action.label.length <= 20, 'LINE label limit');
    const ex = EXAMPLES.find((e) => item.action.label === e.label)!;
    assert.equal(matchExample(item.action.text).id, ex.id);
  }
});

test('example card shows the chat, benefit and settings button', () => {
  const card = exampleCard(EXAMPLES[0], 'https://liff.line.me/x?view=secretary') as any;
  const json = JSON.stringify(card);
  assert.ok(json.includes(EXAMPLES[0].chat[0]) && json.includes(EXAMPLES[0].benefit));
  assert.equal(
    card.contents.footer.contents[0].action.uri,
    'https://liff.line.me/x?view=secretary',
  );
});

test('secretary templates exclude interface design', () => {
  assert.ok(!SECRETARY_TEMPLATES.some((t) => t.id === 'interface'));
});

test('example card carries the ready-made app screenshot when Pages is known', async () => {
  const { exampleCard, exampleImage, noticeCard } = await import(
    '../template/supabase/functions/_shared/onboarding.ts'
  );
  assert.equal(
    exampleImage('https://me.github.io/oa', 'health'),
    'https://me.github.io/oa/assets/examples/health.jpg',
  );
  const card = exampleCard(EXAMPLES[1], '', 'https://me.github.io/oa/') as any;
  assert.equal(card.contents.hero.url, 'https://me.github.io/oa/assets/examples/expense.jpg');
  assert.equal((exampleCard(EXAMPLES[1], '') as any).contents.hero, undefined);
  const n = noticeCard('已記下', '內容', { label: '開啟', uri: 'https://x' }) as any;
  assert.equal(n.type, 'flex');
  assert.equal(n.contents.footer.contents[0].action.uri, 'https://x');
});

test('every example has a screenshot file', async () => {
  const { existsSync } = await import('node:fs');
  for (const e of EXAMPLES) assert.ok(existsSync(`liff/assets/examples/${e.id}.jpg`), e.id);
});

test('quota card offers a top-up and falls back to the default subscribe page', () => {
  const card: any = quotaCard('');
  assert.match(card.altText, /NT\$30–50/);
  assert.equal(
    card.contents.footer.contents[0].action.uri,
    'https://liff.line.me/2012197506-Vmb4O5iT/build.html',
  );
  assert.equal(
    quotaCard('https://x.example/topup').contents.footer.contents[0].action.uri,
    'https://x.example/topup',
  );
});
