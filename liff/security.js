// Owner PIN on the LIFF pages: a PIN prompt used by every owner call that answers
// pin_required, the 安全 section of the settings page, and the ?view=confirm page that
// applies a pending settings proposal after the PIN.
const MESSAGES = {
  pin_wrong: 'PIN 不正確，請再試一次。',
  pin_wait: '錯誤次數太多，請 15 分鐘後再試。',
  pin_invalid: 'PIN 需要 6 位數字，且不能是 123456、111111 這類太簡單的組合。',
  owner_locked: '此帳號已鎖定。請到 Aprico 會員中心的「帳號安全」用 GitHub 驗證後解鎖。',
  lock_unknown: '目前無法確認帳號狀態，請稍後再試。',
};
export const securityMessage = (code) => MESSAGES[code] ?? `操作失敗（${code}）`;

/** Overlay asking for the 6-digit PIN. Resolves with the PIN, or null when cancelled. */
export function askPin(h, title = '請輸入 PIN', note = '') {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'pin-input',
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      maxlength: '6',
      placeholder: '••••••',
    });
    const box = h(
      'div',
      { class: 'pin-overlay' },
      h(
        'div',
        { class: 'card pin-card' },
        h('h2', {}, title),
        note ? h('p', { class: 'muted' }, note) : null,
        input,
        h(
          'div',
          { class: 'pin-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, '取消'),
          h(
            'button',
            { class: 'btn primary', type: 'button', onclick: () => done(input.value.trim()) },
            '確認',
          ),
        ),
      ),
    );
    const done = (v) => (box.remove(), resolve(v));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && done(input.value.trim()));
    document.body.append(box);
    input.focus();
  });
}

/** Wrap call(): on pin_required ask for the PIN, verify it and retry once. */
export function withPin(h, call) {
  return async function guarded(action, extra = {}) {
    try {
      return await call(action, extra);
    } catch (e) {
      if (e.message !== 'pin_required') throw e;
      for (;;) {
        const pin = await askPin(h, '請輸入 PIN', '為了保護你的帳號，這個動作需要 PIN。');
        if (pin === null) throw Error('pin_cancelled');
        try {
          await call('pin_verify', { pin });
          return await call(action, extra);
        } catch (err) {
          if (err.message !== 'pin_wrong') throw err;
          alert(securityMessage('pin_wrong'));
        }
      }
    }
  };
}

/** 安全 section on the settings page: set or change the PIN. */
export async function securitySection(h, call) {
  const status = await call('pin_status').catch(() => null);
  const note = h('p', { class: 'muted' });
  const render = (s) =>
    (note.textContent = s?.set
      ? '已設定 PIN。套用設定、發布選單、健康頁與家人設定都會先確認 PIN（30 分鐘內不重問）。'
      : '建議設定 6 位數 PIN：就算 LINE 帳號被盜，對方也無法更改你的設定。');
  render(status);
  const button = h(
    'button',
    { class: 'btn', type: 'button' },
    status?.set ? '變更 PIN' : '設定 PIN',
  );
  button.addEventListener('click', async () => {
    try {
      let oldPin;
      if (status?.set && !status.fresh) {
        oldPin = await askPin(h, '輸入目前的 PIN');
        if (oldPin === null) return;
      }
      const pin = await askPin(h, '設定新的 PIN', '6 位數字，請記住它。忘記時可用 GitHub 找回。');
      if (pin === null) return;
      const again = await askPin(h, '再輸入一次新的 PIN');
      if (again === null) return;
      if (again !== pin) return alert('兩次輸入不一樣，請重新設定。');
      const s = await call('pin_set', { pin, oldPin });
      Object.assign(status ?? {}, s, { set: true });
      button.textContent = '變更 PIN';
      render({ set: true });
      alert('PIN 已設定。');
    } catch (e) {
      alert(securityMessage(e.message));
    }
  });
  return h('section', { class: 'card' }, h('h3', {}, '🔐 安全'), note, button);
}

/** ?view=confirm: show the pending proposal, then PIN and apply. */
export async function confirmView(h, show, call) {
  const p = await call('pending_peek');
  if (!p.pending)
    return show(h('h1', {}, '沒有待套用的修改'), h('p', { class: 'muted' }, '可以關閉這頁。'));
  const status = h('p', { class: 'muted' });
  const button = h('button', { class: 'btn primary', type: 'button' }, '輸入 PIN 並套用');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await withPin(h, call)('pending_apply');
      status.textContent = '✅ 已套用。選單有變更的話，請到「發布選單」重新發布。';
      button.remove();
    } catch (e) {
      status.textContent = e.message === 'pin_cancelled' ? '' : securityMessage(e.message);
      button.disabled = false;
    }
  });
  show(
    h('h1', {}, '確認套用設定'),
    h('section', { class: 'card' }, h('p', {}, p.summary || '套用 AI 秘書提出的設定修改。')),
    button,
    status,
  );
}
