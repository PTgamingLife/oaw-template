import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOrb,
  cleanParams,
  defaultOrbs,
  linkedGroups,
  localIssues,
  menuButtons,
  orbReady,
} from '../template/supabase/functions/_shared/orb-model.ts';

test('a new account has orb 1 lit, ready, and one menu button from its 指令 piece', () => {
  const orbs = defaultOrbs();
  assert.deepEqual(orbs.map((o) => o.on), [true, false, false]);
  assert.ok(orbReady(orbs[0], orbs));
  assert.deepEqual(menuButtons(orbs), ['行事曆', '', '']);
  assert.equal(linkedGroups(orbs[0]).length, 1);
});

test('piece params are cleaned and required values are enforced', () => {
  assert.equal(cleanParams('push', { time: '9點', show: 'calendar' }), null);
  assert.deepEqual(cleanParams('push', { time: '21:00', show: 'hack' }), { time: '21:00', show: 'calendar' });
  assert.equal(cleanParams('command', { word: ' ' }), null);
  assert.deepEqual(cleanParams('command', { word: '行 事 曆', show: 'list' }), { word: '行事曆', show: 'list' });
  assert.equal(cleanParams('answer', {}), null);
  const s = cleanParams('stats', {
    subject: '便當',
    items: [{ name: '雞腿', price: 100 }, { name: '', price: 5 }, { name: '排骨', price: -1 }],
    close: '11:00',
    open: 'x',
  });
  assert.deepEqual(s?.items, [{ name: '雞腿', price: 100 }, { name: '排骨', price: 0 }]);
  assert.equal(s?.open, '');
  assert.equal(s?.dedupe, 'last');
});

test('orbs from the page are validated: unknown groups, bad pieces and links are dropped', () => {
  const orb = cleanOrb(
    {
      on: true,
      target: 'Cunknown',
      pieces: [
        { id: 1, type: 'record', text: ' 記下 ', x: 2, y: 0.3 },
        { id: 1, type: 'push', text: 'dup id' },
        { id: 2, type: 'evil', text: 'x' },
        { id: 3, type: 'remind', text: '提醒', params: { time: '07:00' } },
      ],
      links: [[1, 3], [3, 1], [1, 1], [1, 9]],
    },
    2,
    ['Cabc'],
  );
  assert.equal(orb.target, '');
  assert.deepEqual(orb.pieces.map((p) => p.id), [1, 3]);
  assert.equal(orb.pieces[0].x, 0.5);
  assert.deepEqual(orb.links, [[1, 3]]);
  assert.throws(
    () => cleanOrb({ pieces: [{ id: 1, type: 'command', text: 'a' }, { id: 2, type: 'command', text: 'b' }] }, 1, []),
    /orb_one_command/,
  );
});

test('local checks: target, one conversation per orb, data source, group-only pieces', () => {
  const orbs = defaultOrbs();
  const two = cleanOrb({ target: 'me', pieces: [{ id: 1, type: 'push', text: '' }] }, 2, []);
  const codes = localIssues(two, orbs).map((i) => i.code);
  assert.deepEqual(codes, ['target_used', 'no_text', 'no_source']);
  const stats = cleanOrb({ target: 'me', pieces: [{ id: 1, type: 'stats', text: '統計便當' }] }, 3, []);
  assert.ok(localIssues(stats, [stats]).some((i) => i.code === 'group_only'));
  assert.deepEqual(localIssues(cleanOrb({}, 2, []), orbs).map((i) => i.code), ['target', 'empty']);
  // A dark orb contributes no menu button.
  assert.deepEqual(menuButtons([{ ...orbs[0], on: false }]), ['', '', '']);
});
