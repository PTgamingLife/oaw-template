// 每日關心: the morning briefing (card + voice message) and the evening questions. Both are
// on for a new secretary; the owner can turn each off or move its time here.
const HOURS = { morning: [5, 11], night: [18, 22] };

export function dailyCard(h, call, securityMessage) {
  const out = h('div', { class: 'daily-out' }, h('p', { class: 'muted' }, '讀取中…'));
  const section = h(
    'section',
    { class: 'card' },
    h('h3', {}, '💛 每日關心'),
    h(
      'p',
      { class: 'muted' },
      '早上：秘書依今天的行程、待辦和你的紀錄，傳一張卡片和一段語音鼓勵（事情多約一分鐘，不多約十秒）。晚上：問你今天還有什麼要記的、有沒有好事或擔心的事，請你給今天打個分數，最後送上今天的整理。每天會用到一些 AI 額度。',
    ),
    out,
  );
  const show = (daily, note = '') => {
    const row = (key, label) => {
      const on = h('input', { type: 'checkbox', ...(daily[key].on ? { checked: '' } : {}) });
      const time = h('input', {
        type: 'time',
        value: daily[key].time,
        min: `${String(HOURS[key][0]).padStart(2, '0')}:00`,
        max: `${HOURS[key][1]}:59`,
        'aria-label': `${label}時間`,
      });
      return { on, time, el: h('div', { class: 'daily-row' }, h('label', {}, on, ` ${label}`), time) };
    };
    const morning = row('morning', '早晨鼓勵'),
      night = row('night', '晚間關心');
    const save = h('button', { class: 'btn primary', type: 'button' }, '儲存');
    const msg = h('p', { class: note.startsWith('✓') ? 'muted' : 'error' }, note);
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const r = await call('daily_save', {
          daily: {
            morning: { on: morning.on.checked, time: morning.time.value },
            night: { on: night.on.checked, time: night.time.value },
          },
        });
        // A time outside the allowed hours comes back as the default, so show what was saved.
        show(r.daily, '✓ 已儲存');
      } catch (e) {
        save.disabled = false;
        msg.className = 'error';
        msg.textContent = e.message === 'pin_cancelled' ? '' : securityMessage(e.message);
      }
    });
    out.replaceChildren(
      morning.el,
      night.el,
      h('p', { class: 'muted' }, '早晨可設 05:00–11:59，晚間可設 18:00–22:59。'),
      save,
      msg,
    );
  };
  call('daily_get')
    .then((r) => (r.available ? show(r.daily) : section.remove()))
    .catch((e) => out.replaceChildren(h('p', { class: 'error' }, securityMessage(e.message))));
  return section;
}
