import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newKeyPair,
  open,
  seal,
  validPublicKey,
} from '../template/supabase/functions/_shared/link-crypto.ts';
import { sendIntent } from '../template/supabase/functions/_shared/link-intent.ts';

test('messages are sealed for the receiving app only', async () => {
  const mine = await newKeyPair(),
    theirs = await newKeyPair();
  assert.ok(validPublicKey(theirs.publicKey));
  const sealed = await seal(theirs.publicKey, '週五前交海報初稿');
  assert.doesNotMatch(atob(sealed), /海報/); // the relay sees no text
  assert.equal(await open(theirs.privateJwk, sealed), '週五前交海報初稿');
  await assert.rejects(open(mine.privateJwk, sealed));
  // Tampering is detected.
  const m = JSON.parse(atob(sealed));
  m.c = btoa('x' + atob(m.c).slice(1));
  await assert.rejects(open(theirs.privateJwk, btoa(JSON.stringify(m))));
  await assert.rejects(seal('not-a-key', 'x'));
});

test('「傳給…：…」 finds the active link by name', () => {
  const links = [
    { id: '1', status: 'active', peerLabel: '設計部' },
    { id: '2', status: 'pending', peerLabel: null },
  ];
  assert.deepEqual(sendIntent('傳給設計部：週五前交初稿', links), {
    link: links[0],
    text: '週五前交初稿',
  });
  assert.deepEqual(sendIntent('傳給 業務部: 明天開會', links), {
    link: null,
    names: ['設計部'],
    asked: '業務部',
  });
  assert.equal(sendIntent('明天開會', links), null);
});
