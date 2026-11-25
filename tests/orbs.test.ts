import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanOrb,
  cleanParams,
  defaultOrbs,
  linkedGroups,
  localIssues,
  menuButtons,
  orbMenu,
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
  assert.deepEqual(cleanParams('push', { time: '21:00', show: 'hack' }), { time: '21:00', show: 'calendar', day: '', say: '' });
  assert.equal(cleanParams('push', { time: '07:00', day: 'tomorrow' })?.day, 'tomorrow');
  assert.equal(cleanParams('command', { word: ' ' }), null);
  assert.deepEqual(cleanParams('command', { word: '行 事 曆', show: 'list' }), { word: '行事曆', show: 'list' });
  assert.deepEqual(cleanParams('answer', {}), {}); // 回答 needs no settings: it answers everything
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

import {
  cronAt,
  cronJobs,
  orbClaims,
  orbFor,
  parseJob,
  tallyText,
  tallyTotals,
  windowStart,
} from '../template/supabase/functions/_shared/orb-logic.ts';

test('cron jobs: Taipei times become UTC, only lit orbs with params are scheduled', () => {
  assert.equal(cronAt('21:00'), '0 13 * * *');
  assert.equal(cronAt('07:05'), '5 23 * * *');
  const orbs = defaultOrbs();
  assert.deepEqual(cronJobs(orbs), [
    { name: 'digest', cron: '55 12 * * *' },
    { name: 'push-1-4', cron: '0 13 * * *' },
    { name: 'push-1-5', cron: '0 23 * * *' },
  ]);
  assert.equal(cronJobs([{ ...orbs[0], on: false }]).length, 1);
  // A job registered by an older version still finds its (upgraded) piece.
  assert.deepEqual(parseJob('remind-1-5'), { kind: 'push', slot: 1, piece: 5 });
  assert.equal(parseJob('drop-1-5'), null);
  assert.equal(orbFor(orbs, 'me')?.slot, 1);
  assert.equal(orbFor([{ ...orbs[0], on: false }], 'me'), null);
  assert.ok(orbClaims([{ ...orbs[0], on: false }], 'me'));
  assert.equal(windowStart('10:00', Date.parse('2026-11-24T03:00:00Z')), '2026-11-24T02:00:00.000Z');
});

test('tally: latest line wins per member, cancel removes, totals use item prices', () => {
  const items = [{ name: '雞腿', price: 100 }, { name: '排骨', price: 90 }];
  const entries = [
    { who: 'M1', item: '雞腿', qty: 1, note: '', line: 1 },
    { who: 'M2', item: '排骨', qty: 2, note: '不要辣', line: 2 },
    { who: 'M1', item: '排骨', qty: 1, note: '', line: 3 }, // M1 changes their order
    { who: 'M3', item: '雞腿', qty: 1, note: '', line: 4 },
    { who: 'M3', item: '雞腿', qty: 0, note: '', line: 5 }, // M3 cancels
  ];
  const last = tallyTotals(entries, items, 'last');
  assert.deepEqual(last.perItem, [['排骨', 3]]);
  assert.equal(last.total, 270);
  assert.equal(last.count, 2);
  const sum = tallyTotals(entries, items, 'sum');
  assert.deepEqual(new Map(sum.perItem), new Map([['雞腿', 1], ['排骨', 3]]));
  assert.equal(sum.total, 370);
  const text = tallyText(last, '便當', true, (l) => ({ M1: '小明', M2: '小華' })[l] ?? l);
  assert.match(text, /共 2 人/);
  assert.match(text, /合計 270 元/);
  assert.match(text, /小華：排骨×2（不要辣） 180 元/);
  assert.equal(tallyText(tallyTotals([], items, 'last'), '便當', true, (l) => l), '目前還沒有人登記便當。');
});

test('the secretary menu has four cells: 打開秘書, then each orb\'s word or a way into the orb page', () => {
  const m = orbMenu(defaultOrbs(), 'cafe', 'https://liff.line.me/1-a');
  assert.deepEqual(m.size, { width: 1200, height: 405 });
  assert.equal(m.name, 'cafe-main');
  assert.deepEqual(m.areas.map((a) => a.bounds.x), [0, 300, 600, 900]);
  assert.deepEqual(m.areas.map((a: any) => a.action.label), ['打開秘書', '行事曆', '未設定介面', '未設定介面']);
  assert.deepEqual(m.areas[1].action, { type: 'uri', label: '行事曆', uri: 'https://liff.line.me/1-a?view=show&slot=1' });
  assert.equal((m.areas[2].action as any).uri, 'https://liff.line.me/1-a?view=orbs');
});

test('顯示介面: one face per orb, layouts limited to the list, old orbs upgraded', () => {
  const groups: string[] = [];
  const base = { on: false, target: 'me', pieces: [], links: [] };
  assert.equal(cleanOrb({ ...base, face: 'stats', template: 'trend' }, 2, groups).template, 'trend');
  // A layout from another face, or an unknown one, falls back to the face's first layout.
  assert.equal(cleanOrb({ ...base, face: 'notes', template: 'trend' }, 2, groups).template, 'list');
  assert.equal(cleanOrb({ ...base, face: 'hologram', template: 'x' }, 2, groups).face, '');
  assert.equal(cleanOrb({ ...base, persona: 'x'.repeat(2000) }, 2, groups).persona.length, 800);
  // Saved before faces existed: a calendar orb keeps opening the calendar.
  const old = cleanOrb(
    {
      ...base,
      pieces: [
        { id: 1, type: 'organize', text: '做成行事曆', params: { as: 'calendar' } },
        { id: 2, type: 'remind', text: '早上提醒', params: { time: '07:00', day: 'today' } },
        { id: 3, type: 'answer', text: '叫小秘就回答', params: { wake: '小秘' } },
      ],
    },
    1,
    groups,
  );
  assert.equal(old.face, 'calendar');
  assert.deepEqual(old.pieces.map((p) => p.type), ['organize', 'push', 'command']);
  assert.deepEqual(old.pieces[1].params, { time: '07:00', show: 'calendar', day: 'today', say: '' });
  assert.equal(old.pieces[2].params?.word, '小秘');
});

test('a recorded line is acknowledged with 「收到」 in one of ten languages plus Chinese', async () => {
  const { GOT_IT, gotIt } = await import('../template/supabase/functions/_shared/persona.ts');
  assert.equal(new Set(GOT_IT).size, 10);
  assert.equal(gotIt(0), 'Got it!（收到）');
  assert.equal(gotIt(0.999), 'Recebido!（收到）');
  assert.equal(gotIt(1), 'Recebido!（收到）'); // never out of range
});

test('AI proposals are limited to what the orb may hold, and applying one never lights the orb', async () => {
  const { cleanPlan, applyPlan } = await import('../template/supabase/functions/_shared/orb-model.ts');
  const mine = defaultOrbs()[0]; // 1:1 chat, calendar, has a 指令
  const plan = cleanPlan(
    {
      face: 'stats',
      drop: [5, 99],
      suggest: [
        { type: 'stats', text: '統計便當' }, // groups only
        { type: 'command', text: '第二個暗號' }, // already has one
        { type: 'push', text: '每天 08:00 提醒我待辦' },
        { type: 'shell', text: 'x' },
      ],
    },
    mine,
  );
  assert.deepEqual(plan, { face: '', drop: [5], suggest: [{ type: 'push', text: '每天 08:00 提醒我待辦' }] });
  const next = applyPlan(mine, plan);
  assert.equal(next.on, false);
  assert.deepEqual(next.pieces.map((p) => p.id), [1, 2, 3, 4, 6]);
  assert.equal(next.pieces.at(-1)?.params, null); // still has to pass 確認
  assert.ok(next.links.every(([a, b]) => a !== 5 && b !== 5));
  assert.deepEqual(next.links.at(-1), [4, 6]);
  // An empty group orb takes the whole set and the proposed page.
  const empty = { ...defaultOrbs()[1], target: 'C1' };
  const whole = cleanPlan({ face: 'stats', suggest: [{ type: 'record', text: '記下訂餐' }, { type: 'stats', text: '統計便當' }], drop: [] }, empty);
  const built = applyPlan(empty, whole);
  assert.equal(built.face, 'stats');
  assert.equal(built.template, 'rank');
  assert.deepEqual(built.pieces.map((p) => p.type), ['record', 'stats']);
  assert.deepEqual(built.links, [[1, 2]]);
});

test('what a piece really does is written from its settings, and measures are added up', async () => {
  const { explainPiece } = await import('../template/supabase/functions/_shared/orb-model.ts');
  const piece = (type: any, params: any) => ({ id: 1, type, text: 'x', x: 0.5, y: 0.5, params: cleanParams(type, params) });
  const orb = { target: 'C1', face: 'stats' as const };
  assert.match(explainPiece(piece('push', { time: '08:00', say: '記得喝水' }), orb), /每天 08:00 傳這句話：「記得喝水」/);
  assert.match(explainPiece(piece('push', { time: '07:00', day: 'today' }), orb), /今天的行程/);
  assert.match(explainPiece(piece('organize', { how: '依客戶分類' }), orb), /四類，並參考你的分類方式「依客戶分類」/);
  const stats = piece('stats', { subject: '飲食', measures: [{ name: '熱量', unit: 'kcal' }, { name: '', unit: 'g' }, { name: '蛋白質', unit: 'g' }], dedupe: 'sum' });
  assert.deepEqual(stats.params?.measures, [{ name: '熱量', unit: 'kcal' }, { name: '蛋白質', unit: 'g' }]);
  assert.match(explainPiece(stats, orb), /由 AI 估算每一筆的熱量（kcal）、蛋白質（g）.*會加總.*僅供參考/);
  assert.equal(explainPiece({ ...stats, params: null }, orb), '還沒有設定完成。');
  // Two meals by one member add up; another member is separate.
  const t = tallyTotals(
    [
      { who: 'M1', item: '雞腿便當', qty: 1, note: '', line: 1, values: [780, 35] },
      { who: 'M1', item: '豆漿', qty: 1, note: '', line: 2, values: [120, 7] },
      { who: 'M2', item: '排骨飯', qty: 1, note: '', line: 3, values: [820, 30] },
    ],
    [],
    'sum',
    2,
  );
  assert.deepEqual(t.people.map((p) => p.values), [[900, 42], [820, 30]]);
  assert.deepEqual(t.sums, [1720, 72]);
  const text = tallyText(t, '飲食', true, (l) => l, [], [{ name: '熱量', unit: 'kcal' }, { name: '蛋白質', unit: 'g' }]);
  assert.match(text, /估算合計：熱量 1720kcal、蛋白質 72g/);
  assert.match(text, /M1：.*（熱量 900kcal、蛋白質 42g）/);
  assert.match(text, /僅供參考/);
  // Without measures nothing about estimates appears.
  assert.doesNotMatch(tallyText(tallyTotals([{ who: 'M1', item: '雞腿', qty: 1, note: '', line: 1 }], [], 'last'), '便當', true, (l) => l), /估算/);
});
