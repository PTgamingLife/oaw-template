// ?view=design — 介面設計中心 (領航者版). Top: a live LINE preview (welcome card, the reply of
// the cell you tap, the real rich menu drawing). Bottom: a conversation with the AI that
// edits a draft. Nothing goes live until 套用並發布 (PIN).
import { securityMessage } from './security.js';

const SUGGESTIONS = ['選單改成 6 格', '換一組暖色系的配色', '選單形狀改成拱門', '卡片簡潔一點', '卡片放大一點', '第 2 格改成「菜單」', '歡迎訊息寫得親切一點'];
const MAX_FILE = 5 * 1024 * 1024; // what the owner may pick
const MAX_SEND = 430 * 1024; // what is stored after shrinking
const errorText = (code) =>
  ({
    pin_cancelled: '',
    navigator_required: '介面設計中心是領航者版的功能。在這個官方帳號的聊天室輸入 Aprico 給你的解鎖碼，就能開啟。',
    points_insufficient: '本月 AI 額度已用完，暫時無法修改。',
    rate_limited: '操作太頻繁了，請一分鐘後再試。',
    design_failed: 'AI 這次沒有改成功，請換個說法再試一次。',
    aprico_not_connected: '這個帳號還沒連接 Aprico。',
    invalid_request: '請輸入想修改的內容（500 字以內）。',
    photo_invalid: '這張圖片無法使用，請換一張 JPG 或 PNG。',
    photos_full: '圖片最多放 20 張。請先把用不到的圖片從介面拿掉並發布，隔天就能再上傳。',
    photo_store_failed: '圖片沒有存成功，請再試一次。',
    too_large: '圖片太大了，請換一張小一點的。',
  })[code] ?? securityMessage(code);

const blobOf = (canvas, q) => new Promise((done) => canvas.toBlob(done, 'image/jpeg', q));
const base64 = async (blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** Shrink a picked photo to a JPEG the server accepts (long side ≤ 1600, then smaller). */
async function shrink(file) {
  const img = await createImageBitmap(file);
  for (let side = 1600; side >= 500; side -= 300) {
    const k = Math.min(1, side / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.7, 0.55]) {
      const blob = await blobOf(c, q);
      if (blob && blob.size <= MAX_SEND) return blob;
    }
  }
  throw Error('too_large');
}

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
  // Pictures by file name. A just-uploaded one is shown from memory, the others from storage.
  const pictures = new Map();
  const picture = (name) => {
    if (!name) return null;
    if (!pictures.has(name)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => render();
      img.src = opened.imageBase + name;
      pictures.set(name, img);
    }
    const img = pictures.get(name);
    return img.complete && img.naturalWidth ? img : null;
  };
  const change = (edit, text) => {
    history.push(JSON.stringify(draft));
    if (history.length > 30) history.shift();
    edit();
    say(text);
    render();
  };

  const canvas = h('canvas', { class: 'd-menu', role: 'img', 'aria-label': '圖文選單預覽，點格子可以看那一格的回覆' });
  const chat = h('div', { class: 'd-chat', 'aria-live': 'polite' });
  const title = h('b', {});
  const log = h('div', { class: 'd-log', 'aria-live': 'polite' });
  const file = h('input', { type: 'file', accept: 'image/*', hidden: '' });
  const pick = h('button', { class: 'd-pic', type: 'button', 'aria-label': '上傳圖片' }, '🖼');
  const input = h('input', { type: 'text', id: 'design-text', placeholder: '說說想改什麼…', maxlength: '500', autocomplete: 'off' });
  const sendBtn = h('button', { class: 'btn3d', type: 'submit' }, '送出');
  const undo = h('button', { class: 'btn3d ghost', type: 'button' }, '復原上一步');
  const reset = h('button', { class: 'btn3d ghost', type: 'button' }, '全部還原');
  const apply = h('button', { class: 'btn3d sun', type: 'button' }, '套用並發布');
  const say = (text, who = 'ai') => {
    log.append(h('div', { class: `m ${who}` }, text));
    log.scrollTop = log.scrollHeight;
  };

  // `styled` cards follow the card look (cell replies); the welcome card keeps the band.
  function card(heading, body, colour, styled) {
    const { head, size, hero } = styled ? draft.card : { head: 'band', size: 'mega', hero: '' };
    const img = head === 'image' ? picture(hero) : null;
    const box = h('div', { class: `fcard s-${size}` });
    if (img) box.append(h('div', { class: 'hero', style: `background-image:url(${img.src})` }));
    if (head === 'band' || (head === 'image' && !img)) box.append(h('div', { class: 'band', style: `background:${colour}` }, heading));
    else box.append(h('div', { class: 'plain' }, heading));
    box.append(h('div', { class: 'txt' }, body));
    return box;
  }
  function fills(ctx) {
    return menuAreas(draft.grid).map((a) => {
      const img = picture(draft.cells[a.index].img);
      if (!img) return null;
      const k = Math.max(a.w / img.naturalWidth, a.h / img.naturalHeight);
      const p = ctx.createPattern(img, 'no-repeat');
      p.setTransform(new DOMMatrix().translate(a.x + (a.w - img.naturalWidth * k) / 2, a.y + (a.h - img.naturalHeight * k) / 2).scale(k));
      return p;
    });
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
      chat.append(c.format === 'card' || c.action !== 'message' ? card(label, body, colours[shown % 4], true) : h('div', { class: 'bubble' }, body));
    }
    chat.scrollTop = chat.scrollHeight;
    drawMenu(canvas, { ...draft, colors: colours, fills: fills(canvas.getContext('2d')) }, draft.shape ?? 0);
    undo.disabled = busy || !history.length;
    reset.disabled = apply.disabled = busy || !dirty();
    sendBtn.disabled = input.disabled = pick.disabled = busy;
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
      if (draft.card.head === 'image' && !draft.card.hero) say('卡片上方還沒有圖片，按左邊的 🖼 選一張照片就會放上去。');
    } catch (e) {
      wait.remove();
      const msg = errorText(e.message);
      if (msg) say(msg, 'ai warn');
    }
    busy = false;
    render();
  }
  // Pictures are placed by the owner, not by the AI: pick → shrink → store → choose where.
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0];
    file.value = '';
    if (!f || busy) return;
    if (!f.type.startsWith('image/')) return say('請選一張圖片。', 'ai warn');
    if (f.size > MAX_FILE) return say('圖片請在 5MB 以內。', 'ai warn');
    busy = true;
    render();
    const wait = h('div', { class: 'm ai wait' }, '圖片壓縮上傳中…');
    log.append(wait);
    log.scrollTop = log.scrollHeight;
    try {
      const blob = await shrink(f).catch((e) => Promise.reject(Error(e.message === 'too_large' ? 'too_large' : 'photo_invalid')));
      const { name } = await call('design_upload', { image: await base64(blob) });
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await img.decode();
      pictures.set(name, img);
      wait.remove();
      const where = h('div', { class: 'm ai' }, '圖片收到了，要放在哪裡？');
      const row = h('div', { class: 'd-where' });
      const place = (text, edit, done) => {
        const b = h('button', { class: 'chip', type: 'button' }, text);
        b.addEventListener('click', () => (row.remove(), change(edit, done)));
        row.append(b);
      };
      place('卡片上方', () => Object.assign(draft.card, { head: 'image', hero: name }), '已經放在卡片上方，點選單格子就能看到卡片。');
      for (let i = 0; i < draft.grid; i++)
        place(`第 ${i + 1} 格`, () => ((draft.cells[i].img = name), (shown = null)), `第 ${i + 1} 格換上你的圖片了。`);
      where.append(row);
      log.append(where);
      log.scrollTop = log.scrollHeight;
    } catch (e) {
      wait.remove();
      const msg = errorText(e.message);
      if (msg) say(msg, 'ai warn');
    }
    busy = false;
    render();
  });
  const clear = h('button', { class: 'chip', type: 'button' }, '拿掉所有圖片');
  clear.addEventListener('click', () => {
    if (busy || (!draft.card.hero && !draft.cells.some((c) => c.img))) return say('目前介面上沒有圖片。');
    change(() => {
      draft.cells.forEach((c) => (c.img = ''));
      Object.assign(draft.card, { hero: '', head: draft.card.head === 'image' ? 'band' : draft.card.head });
    }, '圖片都拿掉了。');
  });
  const form = h('form', { class: 'd-row' }, pick, file, input, sendBtn);
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
      // With photos the menu goes out as JPEG, stepped down until it fits LINE's 1 MB limit.
      let image = canvas.toDataURL('image/png').split(',')[1],
        type = 'png';
      if (draft.cells.slice(0, draft.grid).some((c) => c.img))
        for (const q of [0.9, 0.8, 0.7, 0.55, 0.4]) {
          image = canvas.toDataURL('image/jpeg', q).split(',')[1];
          type = 'jpeg';
          if (image.length * 0.75 <= 950000) break;
        }
      await call('design_apply', { config: draft, image, type });
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
        clear,
      ),
      form,
      h('div', { class: 'd-bar' }, h('span', { class: 'd-row' }, undo, reset), apply),
    ),
  );
  say('嗨，我來幫你改介面。直接說想改什麼，上面的預覽會跟著變；滿意了再按「套用並發布」。');
  render();
}
