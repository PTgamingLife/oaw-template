import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  announcementCard,
  cleanWake,
  groupCommand,
  groupConfirmCard,
  groupSendIntent,
  pickGroupMessage,
} from '../template/supabase/functions/_shared/group-intent.ts';
import { digestRows, mergeDigests } from '../template/supabase/functions/_shared/digest.ts';

test('the call word starts a group command; other lines are left alone', () => {
  assert.equal(groupCommand('明天見', '小秘'), null);
  assert.deepEqual(groupCommand('小秘', '小秘'), { kind: 'help' });
  assert.deepEqual(groupCommand('@小秘 整理', '小秘'), { kind: 'digest' });
  assert.deepEqual(groupCommand('小秘，行程', '小秘'), { kind: 'events' });
  assert.deepEqual(groupCommand('小秘 記下：週六 10 點聚餐', '小秘'), {
    kind: 'note',
    text: '週六 10 點聚餐',
  });
  assert.deepEqual(groupCommand('小秘 週六幾點集合？', '小秘'), { kind: 'ask', text: '週六幾點集合？' });
  assert.equal(cleanWake('阿秘'), '阿秘');
  assert.equal(cleanWake('有 空白'), '小秘');
  assert.equal(cleanWake('<script>'), '小秘');
  assert.equal(cleanWake(''), '小秘');
});

test('「發到群組：…」 picks the group, asks when there are several, flags AI requests', () => {
  const one = [{ group_id: 'C1', name: '家人群' }];
  const two = [...one, { group_id: 'C2', name: '球隊' }];
  assert.equal(groupSendIntent('明天開會', one), null);
  assert.deepEqual(groupSendIntent('發到群組：週六 10 點集合', []), { none: true });
  assert.deepEqual(groupSendIntent('發到群組：週六 10 點集合', one), {
    text: '週六 10 點集合',
    ai: false,
    group: one[0],
  });
  assert.deepEqual(groupSendIntent('發到群組：幫我整理明天的行程', two), {
    text: '幫我整理明天的行程',
    ai: true,
    choose: two,
  });
  assert.deepEqual(groupSendIntent('發到球隊: 練球取消', two), {
    text: '練球取消',
    ai: false,
    group: two[1],
  });
  assert.deepEqual(groupSendIntent('發到公司群：x', two), {
    missing: '公司群',
    names: ['家人群', '球隊'],
  });
});

test('cards: confirm shows the push cost and three choices; the group sees 〇〇公告', () => {
  const c = groupConfirmCard('家人群', '週六集合', 8);
  const json = JSON.stringify(c);
  assert.match(json, /約 8 人/);
  assert.deepEqual(
    c.contents.footer.contents.map((b: any) => b.action.data),
    ['grp-send', 'grp-polish', 'grp-cancel'],
  );
  assert.match(JSON.stringify(announcementCard('陳家', '週六集合')), /📢 陳家公告/);
  assert.equal(pickGroupMessage([{ group_id: 'C1', name: '' }]).quickReply.items[0].action.label, '群組 1');
});

test('digest rows keep the chat they came from; several chats merge into one card', () => {
  const rows = digestRows({ todos: [{ text: '買蛋糕' }] }, 'C1');
  assert.equal(rows[0].source_id, 'C1');
  const m = mergeDigests([
    { events: [{ date: '2026-11-24', time: '', title: 'A' }], summary: '' },
    { todos: [{ text: 'B' }], summary: '辛苦了' },
  ]);
  assert.equal(m.events?.length, 1);
  assert.equal(m.todos?.length, 1);
  assert.equal(m.summary, '辛苦了');
});
