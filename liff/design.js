// ?view=design — 介面設計中心 (領航者版). Top: a live LINE preview (welcome card, the reply of
// the cell you tap, the real rich menu drawing). Bottom: a conversation with the AI that
// edits a draft. Nothing goes live until 套用並發布 (PIN).
import { securityMessage } from './security.js';

const SUGGESTIONS = ['選單改成 6 格', '換一組暖色系的配色', '選單形狀改成拱門', '第 2 格改成「菜單」', '歡迎訊息寫得親切一點'];
const errorText = (code) =>
  ({
    pin_cancelled: '',
    navigator_required: '介面設計中心是領航者版的功能。在這個官方帳號的聊天室輸入 Aprico 給你的解鎖碼，就能開啟。',
    points_insufficient: '本月 AI 額度已用完，暫時無法修改。',
    rate_limited: '操作太頻繁了，請一分鐘後再試。',
    design_failed: 'AI 這次沒有改成功，請換個說法再試一次。',
    aprico_not_connected: '這個帳號還沒連接 Aprico。',
    invalid_request: '請輸入想修改的內容（500 字以內）。',
  })[code] ?? securityMessage(code);

export async function designView(h, show, call, drawMenu, menuAreas) {
  if (!document.getElementById('design-css')) {
    const link = h('link', { id: 'design-css', rel: 'stylesheet', href: 'design.css' });
    document.head.append(link);
    await new Promise((done) => ((link.onload = done), (link.onerror = done)));
  }
  document.body.classList.add('design-mode');
  const stage = h('div', { id: 'design-stage' });
  show(stage);
  let opened;
  try {
    opened = await call('design_open');
  } catch (e) {
    return stage.append(
      h('h1', {}, '介面設計中心'),
      h('p', { class: 'd-note' }, errorText(e.message)),
      h('a', { class: 'btn3d ghost', href: '?view=orbs' }, '回我的 AI 秘書'),
    );
  }
  const themes = opened.themes;
  let saved = JSON.stringify(opened.config),
    draft = structuredClone(opened.config),
    history = [],
    shown = null,
    busy = false;
  const dirty = () => JSON.stringify(draft) !== saved;

  const canvas = h('canvas', { class: 'd-menu', role: 'img', 'aria-label': '圖文選單預覽，點格子可以看那一格的回覆' });
  const chat = h('div', { class: 'd-chat', 'aria-live': 'polite' });
  const title = h('b', {});
  const log = h('div', { class: 'd-log', 'aria-live': 'polite' });
  const input = h('input', { type: 'text', id: 'design-text', placeholder: '說說想改什麼…', maxlength: '500', autocomplete: 'off' });
  const sendBtn = h('button', { class: 'btn3d', type: 'submit' }, '送出');
  const undo = h('button', { class: 'btn3d ghost', type: 'button' }, '復原上一步');
  const reset = h('button', { class: 'btn3d ghost', type: 'button' }, '全部還原');
  const apply = h('button', { class: 'btn3d sun', type: 'button' }, '套用並發布');
  const say = (text, who = 'ai') => {
    log.append(h('div', { class: `m ${who}` }, text));
    log.scrollTop = log.scrollHeight;
  };

  function card(heading, body, colour) {
    return h('div', { class: 'fcard' }, h('div', { class: 'band', style: `background:${colour}` }, heading), h('div', { class: 'txt' }, body));
  }
  function render() {
    const colours = themes[draft.theme];
    title.textContent = draft.oaName || '官方帳號';
    chat.replaceChildren(card(draft.oaName || '歡迎', draft.welcome || '（還沒有歡迎訊息）', colours[0]));
    if (shown != null && shown < draft.grid) {
      const c = draft.cells[shown];
      const label = c.label || `功能 ${shown + 1}`;
      chat.append(h('div', { class: 'tap' }, label));
      const body = c.action === 'full' ? '（打開會員頁面）' : c.action === 'web' ? `（打開網頁）${c.content}` : c.content || draft.failure;
      chat.append(c.format === 'card' || c.action !== 'message' ? card(label, body, colours[shown % 4]) : h('div', { class: 'bubble' }, body));
    }
    chat.scrollTop = chat.scrollHeight;
    drawMenu(canvas, { ...draft, colors: colours }, draft.shape ?? 0);
    undo.disabled = busy || !history.length;
    reset.disabled = apply.disabled = busy || !dirty();
    sendBtn.disabled = input.disabled = busy;
  }
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 1200,
      y = ((e.clientY - r.top) / r.height) * 810;
    const hit = menuAreas(draft.grid).find((a) => x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h);
    if (hit) (shown = hit.index), render();
  });

  async function send(text) {
    text = text.trim();
    if (!text || busy) return;
    say(text, 'me');
    input.value = '';
    busy = true;
    render();
    const wait = h('div', { class: 'm ai wait' }, 'AI 修改中…');
    log.append(wait);
    log.scrollTop = log.scrollHeight;
    try {
      const r = await call('design_chat', { request: text, config: draft });
      wait.remove();
      if (JSON.stringify(r.config) !== JSON.stringify(draft)) {
        history.push(JSON.stringify(draft));
        if (history.length > 30) history.shift();
        draft = r.config;
        if (shown != null && shown >= draft.grid) shown = null;
      }
      say(r.summary || '已經改好了。');
    } catch (e) {
      wait.remove();
      const msg = errorText(e.message);
      if (msg) say(msg, 'ai warn');
    }
    busy = false;
    render();
  }
  const form = h('form', { class: 'd-row' }, input, sendBtn);
  form.addEventListener('submit', (e) => (e.preventDefault(), send(input.value)));
  undo.addEventListener('click', () => {
    if (!history.length) return;
    draft = JSON.parse(history.pop());
    shown = null;
    say('已復原上一步。');
    render();
  });
  reset.addEventListener('click', () => {
    draft = JSON.parse(saved);
    history = [];
    shown = null;
    say('已經還原成目前線上的樣子。');
    render();
  });
  apply.addEventListener('click', async () => {
    busy = true;
    render();
    try {
      await call('design_apply', { config: draft, image: canvas.toDataURL('image/png').split(',')[1] });
      saved = JSON.stringify(draft);
      history = [];
      say('✅ 已經發布，好友現在看到的就是這個版本。');
    } catch (e) {
      const msg = errorText(e.message);
      if (msg) say(`沒有發布：${msg}`, 'ai warn');
    }
    busy = false;
    render();
  });

  stage.append(
    h('div', { class: 'd-top' }, h('a', { class: 'd-back', href: '?view=orbs', 'aria-label': '回我的 AI 秘書' }, '←'), h('h1', {}, '介面設計中心'), h('span', {}, '領航者版')),
    h('section', { class: 'd-phone', 'aria-label': 'LINE 預覽' }, h('header', {}, h('i', {}), title), chat, canvas),
    h(
      'section',
      { class: 'd-talk', 'aria-label': '和 AI 對話' },
      log,
      h(
        'div',
        { class: 'd-chips' },
        SUGGESTIONS.map((t) => {
          const b = h('button', { class: 'chip', type: 'button' }, t);
          b.addEventListener('click', () => send(t));
          return b;
        }),
      ),
      form,
      h('div', { class: 'd-bar' }, h('span', { class: 'd-row' }, undo, reset), apply),
    ),
  );
  say('嗨，我來幫你改介面。直接說想改什麼，上面的預覽會跟著變；滿意了再按「套用並發布」。');
  render();
}
