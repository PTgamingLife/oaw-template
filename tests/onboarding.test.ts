import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXAMPLES,
  askCard,
  exampleCard,
  matchExample,
  SECRETARY_TEMPLATES,
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
