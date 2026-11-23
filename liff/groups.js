// ?view=groups — 我的群組: the call word for group AI, daily limits, group names, unbind.
// Saving and unbinding need the PIN (handled by `call`).
import { securityMessage } from './security.js';

const errorText = (code) =>
  ({
    wake_invalid: '呼叫詞只能用 1–8 個中文、英文或數字，不能有空白或符號。',
    pin_cancelled: '',
  })[code] ?? securityMessage(code);

export async function groupsView(h, show, call) {
  const status = h('p', { class: 'muted' });
  let data;
  try {
    data = await call('group_list');
  } catch (e) {
    return show(h('h1', {}, '我的群組'), h('p', { class: 'error' }, errorText(e.message)));
  }
  const wake = h('input', { value: data.wake, maxlength: '8' });
  const daily = h('input', { type: 'number', min: '1', max: '200', value: String(data.daily) });
  const sendDaily = h('input', { type: 'number', min: '1', max: '200', value: String(data.sendDaily) });
  const names = {};
  const groupCard = (g) => {
    const name = h('input', { value: g.name, maxlength: '40', placeholder: `群組 ${g.index}` });
    name.addEventListener('input', () => (names[g.id] = name.value));
    const unbind = h('button', { class: 'btn', type: 'button' }, '解除綁定');
    unbind.addEventListener('click', async () => {
      if (!confirm(`確定解除〈${g.name || `群組 ${g.index}`}〉？之後不會再記錄這個群組。`)) return;
      try {
        await call('group_unbind', { groupId: g.id });
        groupsView(h, show, call);
      } catch (e) {
        status.textContent = errorText(e.message);
      }
    });
    return h('div', { class: 'group-row' }, h('label', {}, '群組名稱'), name, unbind);
  };
  const save = h('button', { class: 'btn primary', type: 'button' }, '儲存');
  save.addEventListener('click', async () => {
    try {
      await call('group_save', {
        wake: wake.value,
        daily: Number(daily.value),
        sendDaily: Number(sendDaily.value),
        names,
      });
      status.textContent = '✅ 已儲存。';
    } catch (e) {
      status.textContent = errorText(e.message);
    }
  });
  show(
    h('h1', {}, '我的群組'),
    h(
      'p',
      { class: 'muted' },
      '把官方帳號邀進群組，在群組輸入「綁定群組」就會開始記錄。在一對一聊天輸入「發到群組：內容」可以發公告。',
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, '🤖 群組裡的 AI'),
      h('label', {}, '呼叫詞'),
      wake,
      h('p', { class: 'muted' }, `例如「${data.wake} 整理」「${data.wake} 行程」「${data.wake} 記下：週六聚餐」`),
      h('label', {}, '每個群組每天最多呼叫 ', daily, ' 次（用你的 AI 額度）'),
      h('label', {}, '每天最多發 ', sendDaily, ' 則公告（用 LINE 推播則數）'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h3', {}, `👥 已綁定的群組（${data.groups.length}）`),
      ...(data.groups.length
        ? data.groups.map(groupCard)
        : [h('p', { class: 'muted' }, '還沒有綁定任何群組。')]),
    ),
    save,
    status,
  );
}
