// 早晨語音播報: the owner gets a private address for an iPhone shortcut. When the alarm
// stops, the shortcut asks the secretary for the day's briefing, speaks it and listens.
export function voiceCard(h, call, securityMessage) {
  const out = h('div', { class: 'voice-out' });
  const open = async (action) => {
    out.replaceChildren(h('p', { class: 'muted' }, '準備連結…'));
    try {
      const r = await call(action);
      const box = h('input', { type: 'text', readonly: '', value: r.url, 'aria-label': '語音連結' });
      const copy = h('button', { class: 'btn primary', type: 'button' }, '複製語音連結');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(r.url);
        } catch {
          box.select();
          document.execCommand('copy');
        }
        copy.textContent = '已複製 ✓';
      });
      const again = h('button', { class: 'btn', type: 'button' }, '重新產生連結（舊連結失效）');
      again.addEventListener('click', () => open('voice_reset'));
      out.replaceChildren(
        box,
        copy,
        h('a', { class: 'btn', href: 'voice.html', target: '_blank', rel: 'noopener' }, '看 iPhone 捷徑設定教學'),
        again,
      );
    } catch (e) {
      const msg = e.message === 'pin_cancelled' ? '' : securityMessage(e.message);
      out.replaceChildren(msg ? h('p', { class: 'error' }, msg) : start);
    }
  };
  const start = h('button', { class: 'btn', type: 'button' }, '取得語音連結');
  start.addEventListener('click', () => open('voice_link'));
  out.append(start);
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, '🎙️ 早晨語音播報（iPhone・測試中）'),
    h(
      'p',
      { class: 'muted' },
      '鬧鐘按掉後，秘書用語音告訴你今天的行程；你可以直接用說的新增或更改，秘書會先複述，你說「對」才會改。每一句都會用到 AI 額度。這個連結等於鑰匙，請不要分享給別人。',
    ),
    out,
  );
}
