// ?view=links — 跨帳號連結: pair with another OA (one-time code, both owners agree), set
// what this account sends and accepts, the daily limit, and unlink. Changes need the PIN.
import { securityMessage } from './security.js';

const KINDS = [
  ['manual', '手動訊息'],
  ['events', '行程'],
  ['todos', '待辦'],
  ['expenses', '帳務'],
  ['notices', '公告'],
];
const errorText = (code) =>
  ({
    code_invalid: '連結碼不正確或已過期（10 分鐘內有效）。',
    same_account: '不能連結自己。',
    already_linked: '你們已經連結過了。',
    aprico_not_connected: '這個帳號還沒連接 Aprico。',
    pin_cancelled: '',
  })[code] ?? securityMessage(code);

export async function linksView(h, show, call) {
  const status = h('p', { class: 'muted' });
  const say = (code) => (status.textContent = errorText(code));
  let data;
  try {
    data = await call('link_list');
  } catch (e) {
    return show(h('h1', {}, '跨帳號連結'), h('p', { class: 'error' }, errorText(e.message)));
  }

  const checkbox = (obj, key) => {
    const input = h('input', { type: 'checkbox', ...(obj[key] ? { checked: '' } : {}) });
    input.addEventListener('change', () => (obj[key] = input.checked));
    return input;
  };
  const linkCard = (l) => {
    if (l.status === 'pending')
      return h(
        'section',
        { class: 'card' },
        h('h3', {}, `我是「${l.myLabel}」・等待對方輸入連結碼`),
        h('p', { class: 'muted' }, '連結碼 10 分鐘內有效，過期請重新產生。'),
      );
    const s = structuredClone(l.scope);
    const row = (title, part) =>
      h(
        'div',
        { class: 'link-row' },
        h('strong', {}, title),
        h(
          'div',
          { class: 'chips' },
          KINDS.map(([k, label]) =>
            h('label', { class: 'chip-check' }, checkbox(s[part], k), label),
          ),
        ),
      );
    const daily = h('input', { type: 'number', min: '1', max: '100', value: String(s.daily) });
    const save = h('button', { class: 'btn primary', type: 'button' }, '儲存範圍');
    save.addEventListener('click', async () => {
      try {
        s.daily = Number(daily.value);
        await call('link_scope', { linkId: l.id, scope: s });
        status.textContent = '✅ 已儲存。';
      } catch (e) {
        say(e.message);
      }
    });
    const revoke = h('button', { class: 'btn', type: 'button' }, '解除連結');
    revoke.addEventListener('click', async () => {
      if (!confirm(`確定解除和「${l.peerLabel}」的連結？`)) return;
      try {
        await call('link_revoke', { linkId: l.id });
        linksView(h, show, call);
      } catch (e) {
        say(e.message);
      }
    });
    const peerAccepts = KINDS.filter(([k]) => l.peerScope?.accept?.[k]).map(([, n]) => n);
    return h(
      'section',
      { class: 'card' },
      h('h3', {}, `🔗 ${l.peerLabel}`),
      h(
        'p',
        { class: 'muted' },
        `我在對方那邊顯示為「${l.myLabel}」。對方接收：${peerAccepts.join('、') || '無'}`,
      ),
      row('我要傳出', 'send'),
      row('我要接收', 'accept'),
      h(
        'label',
        { class: 'chip-check' },
        checkbox(s, 'autoDigest'),
        '收到的訊息自動加入今晚整理（用我的額度）',
      ),
      h('label', {}, '每天最多傳出 ', daily, ' 則'),
      save,
      revoke,
    );
  };

  // New link: make a code and share it.
  const myLabel = h('input', { placeholder: '我的名稱，例如：行政部', maxlength: '20' });
  const codeBox = h('div', {});
  const create = h('button', { class: 'btn primary', type: 'button' }, '產生連結碼');
  create.addEventListener('click', async () => {
    try {
      const r = await call('link_create', { label: myLabel.value });
      const text = `請在你的官方帳號打開秘書 →「更多設定」→「跨帳號連結」，輸入連結碼：${r.code}（10 分鐘內有效）`;
      const share = h('button', { class: 'btn brand', type: 'button' }, '分享給對方');
      share.addEventListener('click', async () => {
        try {
          if (liff.isApiAvailable?.('shareTargetPicker'))
            await liff.shareTargetPicker([{ type: 'text', text }]);
          else await navigator.clipboard.writeText(text);
        } catch {}
      });
      codeBox.replaceChildren(h('p', { class: 'pin-code' }, r.code), share);
    } catch (e) {
      say(e.message);
    }
  });

  // Accept a code from the other account.
  const code = h('input', { placeholder: '對方給你的 10 碼連結碼', maxlength: '12' });
  const acceptLabel = h('input', { placeholder: '我的名稱，例如：設計部', maxlength: '20' });
  const accept = h('button', { class: 'btn primary', type: 'button' }, '同意連結');
  accept.addEventListener('click', async () => {
    try {
      await call('link_accept', { code: code.value, label: acceptLabel.value });
      linksView(h, show, call);
    } catch (e) {
      say(e.message);
    }
  });

  show(
    h('h1', {}, '跨帳號連結'),
    h(
      'p',
      { class: 'muted' },
      '和其他官方帳號互傳指定資訊。訊息全程加密，Aprico 看不到內容；收到的訊息只會顯示給你，不會被當成指令執行。',
    ),
    ...data.links.map(linkCard),
    h('section', { class: 'card' }, h('h3', {}, '新增連結'), myLabel, create, codeBox),
    h('section', { class: 'card' }, h('h3', {}, '輸入對方的連結碼'), code, acceptLabel, accept),
    status,
  );
}
