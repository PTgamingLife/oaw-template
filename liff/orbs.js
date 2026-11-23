// ?view=orbs — 我的 AI 秘書: three orbs float above the secretary. Each orb is one
// conversation (the owner's 1:1 chat or a bound group) and holds puzzle pieces. 確認 sends the
// pieces to the AI, which asks back about anything missing; only a complete orb can be lit.
import { securityMessage } from './security.js';

const TYPES = {
  record: ['紀錄', '例如：記下跟行程有關的內容'],
  organize: ['整理', '例如：做成行事曆放在介面'],
  command: ['指令', '例如：輸入「行事曆」就跳出行事曆'],
  push: ['定時推播', '例如：每天 21:00 推播行事曆'],
  remind: ['提醒', '例如：早上 07:00 提醒當日行程'],
  stats: ['統計', '例如：統計便當，每天 11:00 截止，每人以最後一次為準'],
  announce: ['公告', '例如：我說「發到群組：…」就發到這個群組'],
  answer: ['回答', '例如：有人叫「小秘」就依最近的對話回答'],
};
const MOODS = ['m-hop', 'm-tilt', 'm-spin', 'm-pop', 'm-proud', 'm-shy', 'm-sleep', 'm-step'];
const errorText = (code) =>
  ({
    pin_cancelled: '',
    points_insufficient: '本月 AI 額度已用完，暫時無法整理。',
    rate_limited: '操作太頻繁了，請一分鐘後再試。',
    aprico_not_connected: '這個帳號還沒連接 Aprico。',
    orb_check_failed: 'AI 暫時無法整理，請稍後再試。',
    orb_not_ready: '這顆光球還沒設定完成，請先點進去按「確認」。',
    orb_one_command: '每顆光球只能有一片「指令」拼圖。',
  })[code] ?? securityMessage(code);

export async function orbsView(h, show, call) {
  if (!document.getElementById('orbs-css')) {
    const link = h('link', { id: 'orbs-css', rel: 'stylesheet', href: 'orbs.css' });
    document.head.append(link);
    await new Promise((done) => ((link.onload = done), (link.onerror = done)));
  }
  document.body.classList.add('orbs-mode');
  const stage = h('div', { id: 'orbs-stage' });
  show(stage);
  let state;
  try {
    state = await call('orb_list');
  } catch (e) {
    return stage.append(h('p', { class: 'sub' }, errorText(e.message)));
  }
  let cur = null,
    linkFrom = null,
    pop = null,
    dirty = false,
    moodTimer = 0;
  const targets = () => [{ id: 'me', name: '個人對話（我和秘書）' }, ...state.groups.map((g) => ({ id: g.id, name: `群組：${g.name}` }))];

  /* ---------- shared: sheet, busy, server calls ---------- */
  function sheet(title, text, actions, extra = [], center = false) {
    const scrim = h('div', { class: 'scrim' + (center ? ' center' : '') });
    const acts = h('div', { class: 'acts' });
    for (const [label, fn, style] of actions) {
      const b = h('button', { class: 'btn3d ' + (style || ''), type: 'button' }, label);
      b.addEventListener('click', () => (scrim.remove(), fn && fn()));
      acts.prepend(b);
    }
    scrim.append(
      h('div', { class: 'sheet', role: 'dialog', 'aria-label': title }, h('h2', {}, title), text ? h('p', {}, text) : null, ...extra, acts),
    );
    scrim.addEventListener('click', (e) => e.target === scrim && scrim.remove());
    stage.append(scrim);
    const field = scrim.querySelector('textarea,input');
    if (field) setTimeout(() => field.focus(), 50);
  }
  const notice = (title, text) => sheet(title, text, [['知道了', null]], [], true);
  async function server(action, extra, label = '處理中…') {
    const busy = h('div', { class: 'busy' }, label);
    stage.append(busy);
    try {
      const r = await call(action, extra);
      state = { ...state, ...r };
      return r;
    } catch (e) {
      const msg = errorText(e.message);
      if (msg) notice('沒有完成', msg);
      return null;
    } finally {
      busy.remove();
    }
  }

  /* ---------- home ---------- */
  function home() {
    clearInterval(moodTimer);
    cur = null;
    const orbBox = h('div', { class: 'orbs' });
    state.orbs
      .filter((o) => o.slot <= 3)
      .forEach((o) => {
        const t = targets().find((t) => t.id === o.target);
        const b = h(
          'button',
          { class: 'orb' + (o.on ? '' : ' off'), type: 'button', 'aria-label': `${o.name}，${o.on ? '已開啟' : '未開啟'}` },
          h('span', { class: 'ball' }),
          h('span', { class: 'tag' }, o.name + ' ', h('small', {}, o.on ? (t ? t.name.replace(/^群組：|（.*$/g, '') : '') : '未開啟')),
        );
        let timer = 0,
          held = false;
        b.addEventListener('pointerdown', () => {
          held = false;
          timer = setTimeout(() => ((held = true), orbSheet(o)), 550);
        });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => clearTimeout(timer));
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        b.addEventListener('click', () => !held && board(o));
        orbBox.append(b);
      });
    const img = h('img', { alt: 'AI 秘書', src: 'assets/secretary.png' });
    const mood = () => {
      img.className = '';
      void img.offsetWidth;
      img.className = MOODS[Math.floor(Math.random() * MOODS.length)];
    };
    moodTimer = setInterval(mood, 4200);
    img.addEventListener('click', mood);
    stage.replaceChildren(
      h(
        'section',
        { class: 'view' },
        h('h1', {}, '我的 AI 秘書'),
        h('p', { class: 'sub' }, '點光球設定功能，長按可以開啟或關閉。'),
        h('div', { class: 'sky' }, orbBox, h('div', { class: 'mascot' }, img)),
        h(
          'div',
          { class: 'menu' },
          h('p', {}, 'LINE 選單（每顆光球的「指令」拼圖變成一顆按鈕）'),
          h(
            'div',
            { class: 'cells' },
            h('div', { class: 'cell' }, '打開秘書'),
            state.buttons.map((w) => h('div', { class: 'cell' + (w ? '' : ' empty') }, w || '未設定')),
          ),
        ),
      ),
    );
  }
  function orbSheet(o) {
    const ready = o.pieces.length && o.target && o.pieces.every((p) => p.params);
    const toggle = async (on) => (await server('orb_toggle', { slot: o.slot, on })) && home();
    sheet(
      o.name,
      o.on ? '關閉後，這顆光球的功能會暫停，設定會保留。' : ready ? '這顆光球已經設定好，可以直接開啟。' : '這顆光球還沒設定完成，請先點進去放拼圖並按「確認」。',
      [o.on ? ['關閉光球', () => toggle(false), 'ghost'] : ready ? ['開啟光球', () => toggle(true)] : ['去設定', () => board(o)], ['取消', null, 'ghost']],
    );
  }

  /* ---------- board ---------- */
  function board(o) {
    clearInterval(moodTimer);
    cur = structuredClone(o);
    linkFrom = null;
    dirty = false;
    const sel = h('select', { id: 'orb-target' }, h('option', { value: '' }, '請選擇…'));
    for (const t of targets()) {
      const used = state.orbs.some((x) => x.slot !== cur.slot && x.target === t.id);
      sel.append(h('option', { value: t.id, ...(used ? { disabled: '' } : {}) }, t.name + (used ? '（其他光球使用中）' : '')));
    }
    sel.value = cur.target;
    sel.addEventListener('change', () => ((cur.target = sel.value), (dirty = true)));
    const back = h('button', { class: 'back', type: 'button', 'aria-label': '返回' }, '←');
    back.addEventListener('click', async () => {
      if (dirty) await server('orb_save', { slot: cur.slot, orb: cur }, '儲存中…');
      home();
    });
    const confirm = h('button', { class: 'btn3d small', type: 'button' }, '確認');
    confirm.addEventListener('click', () => check({}));
    const tray = h('div', { class: 'row' });
    for (const [type, [name]] of Object.entries(TYPES)) {
      const b = h('button', { class: `piece s-${type}`, type: 'button' }, name);
      b.addEventListener('click', () => {
        if (type === 'command' && cur.pieces.some((p) => p.type === 'command'))
          return notice('每顆光球只能有一個「指令」', '一顆光球只會變成 LINE 選單上的一顆按鈕，所以只能放一片「指令」拼圖。');
        if (cur.pieces.length >= 12) return notice('拼圖太多了', '一顆光球最多放 12 片拼圖。');
        const n = cur.pieces.length;
        addPiece(type, '', 0.22 + (n % 3) * 0.28, 0.2 + (Math.floor(n / 3) % 3) * 0.3);
      });
      tray.append(b);
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    stage.replaceChildren(
      h(
        'section',
        { class: 'view' },
        h('div', { class: 'bar' }, back, h('h1', {}, cur.name), confirm),
        h('label', { class: 'target' }, '對話對象', sel),
        h('div', { id: 'plane' }, svg),
        h('div', { class: 'tray' }, h('p', {}, '點拼圖放到上面的平面；點平面上的拼圖可以設定、連結或刪除。'), tray),
      ),
    );
    stage.querySelector('#plane').addEventListener('pointerdown', (e) => e.target.id === 'plane' && closePop());
    plane();
  }
  function addPiece(type, text, x, y) {
    const id = Math.max(0, ...cur.pieces.map((p) => p.id)) + 1;
    cur.pieces.push({ id, type, text, x, y, params: null });
    dirty = true;
    plane();
    return id;
  }
  const closePop = () => (pop?.remove(), (pop = null));
  function plane() {
    closePop();
    const box = stage.querySelector('#plane');
    box.querySelectorAll('.piece,.empty,.banner').forEach((n) => n.remove());
    if (!cur.pieces.length) box.append(h('div', { class: 'empty' }, '還沒有拼圖。從下面點一片放上來。'));
    for (const p of cur.pieces) {
      const b = h(
        'button',
        { class: `piece s-${p.type}` + (p.params ? '' : ' todo') + (linkFrom ? ' linking' : '') + (linkFrom === p ? ' sel' : ''), type: 'button' },
        TYPES[p.type][0],
      );
      b.style.left = p.x * 100 + '%';
      b.style.top = p.y * 100 + '%';
      drag(b, p);
      box.append(b);
    }
    if (linkFrom) {
      const done = h('button', { class: 'btn3d ghost small', type: 'button' }, '完成');
      done.addEventListener('click', () => ((linkFrom = null), plane()));
      box.append(h('div', { class: 'banner' }, h('span', {}, `點另一片拼圖，和「${TYPES[linkFrom.type][0]}」連結；再點一次取消連結。`), done));
    }
    lines();
  }
  function lines() {
    const box = stage.querySelector('#plane'),
      r = box.getBoundingClientRect(),
      svg = box.querySelector('svg');
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    svg.replaceChildren();
    for (const [a, b] of cur.links) {
      const p = cur.pieces.find((x) => x.id === a),
        q = cur.pieces.find((x) => x.id === b);
      if (!p || !q) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const set = { x1: p.x * r.width, y1: p.y * r.height, x2: q.x * r.width, y2: q.y * r.height, stroke: '#7C8CF0', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-dasharray': '1 11' };
      for (const [k, v] of Object.entries(set)) line.setAttribute(k, v);
      svg.append(line);
    }
  }
  function drag(b, p) {
    let sx = null,
      sy,
      moved;
    b.addEventListener('pointerdown', (e) => ((sx = e.clientX), (sy = e.clientY), (moved = false), b.setPointerCapture(e.pointerId)));
    b.addEventListener('pointermove', (e) => {
      if (sx == null || (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 8)) return;
      moved = dirty = true;
      closePop();
      const r = stage.querySelector('#plane').getBoundingClientRect();
      p.x = Math.min(0.9, Math.max(0.1, (e.clientX - r.left) / r.width));
      p.y = Math.min(0.9, Math.max(0.1, (e.clientY - r.top) / r.height));
      b.style.left = p.x * 100 + '%';
      b.style.top = p.y * 100 + '%';
      lines();
    });
    b.addEventListener('pointerup', () => {
      const tap = sx != null && !moved;
      sx = null;
      if (tap) tapPiece(p);
    });
    b.addEventListener('pointercancel', () => (sx = null));
  }
  function tapPiece(p) {
    if (linkFrom) {
      if (linkFrom === p) return;
      const i = cur.links.findIndex(([a, c]) => (a === p.id && c === linkFrom.id) || (c === p.id && a === linkFrom.id));
      i >= 0 ? cur.links.splice(i, 1) : cur.links.push([linkFrom.id, p.id]);
      dirty = true;
      return plane();
    }
    closePop();
    pop = h('div', { class: 'pop' });
    pop.style.left = Math.min(78, Math.max(22, p.x * 100)) + '%';
    pop.style.top = `calc(${p.y * 100}% - 44px)`;
    if (p.y < 0.28) {
      pop.style.top = `calc(${p.y * 100}% + 44px)`;
      pop.style.transform = 'translate(-50%,0)';
    }
    const item = (label, fn, cls) => {
      const x = h('button', { class: cls || '', type: 'button' }, label);
      x.addEventListener('click', () => (closePop(), fn()));
      pop.append(x);
    };
    item('設定', () => settings(p));
    item('連結', () => ((linkFrom = p), plane()));
    item('刪除', () => {
      cur.pieces = cur.pieces.filter((x) => x !== p);
      cur.links = cur.links.filter((l) => !l.includes(p.id));
      dirty = true;
      plane();
    }, 'danger');
    stage.querySelector('#plane').append(pop);
  }
  function settings(p) {
    const ta = h('textarea', { id: 'piece-text', rows: '3', maxlength: '200', placeholder: TYPES[p.type][1] });
    ta.value = p.text;
    sheet(`設定「${TYPES[p.type][0]}」`, '用一句話說這片拼圖要做什麼，AI 會幫你轉成設定。', [
      ['儲存', () => {
        const v = ta.value.trim();
        if (v !== p.text) (p.text = v), (p.params = null), (dirty = true);
        plane();
      }],
      ['取消', null, 'ghost'],
    ], [ta]);
  }

  /* ---------- 確認: local checks and the AI, then 啟動 ---------- */
  async function check(answers) {
    closePop();
    linkFrom = null;
    const r = await server('orb_check', { slot: cur.slot, orb: cur, answers }, 'AI 整理中…');
    if (!r) return plane();
    cur = structuredClone(state.orbs.find((o) => o.slot === cur.slot));
    dirty = false;
    plane();
    const first = r.issues[0];
    if (!first) return summary(r.note);
    const more = r.issues.length > 1 ? `（還有 ${r.issues.length - 1} 項）` : '';
    const box = h('div', { class: 'issue' }, first.text);
    const piece = cur.pieces.find((p) => p.id === first.piece);
    if (piece) {
      const input = h('input', { id: 'fix-text', maxlength: '120', placeholder: TYPES[piece.type][1] });
      return sheet('AI 想確認一下 ' + more, null, [
        ['幫我改好', () => {
          const v = input.value.trim();
          if (!v) return;
          if (first.code === 'no_text') (piece.text = v), check({});
          else check({ [piece.id]: v });
        }],
        ['先不改', null, 'ghost'],
      ], [box, input], true);
    }
    if (first.code === 'no_source')
      return sheet('AI 想確認一下 ' + more, null, [
        ['加一片「紀錄」', () => {
          const id = addPiece('record', '記下這個對話裡的相關內容', 0.5, 0.14);
          if (cur.pieces[0] && cur.pieces[0].id !== id) cur.links.push([id, cur.pieces[0].id]);
          check({});
        }],
        ['先不加', null, 'ghost'],
      ], [box], true);
    sheet('還差一步', null, [['知道了', null]], [box], true);
  }
  function summary(note) {
    const linked = new Set(cur.links.flat());
    const alone = cur.pieces.filter((p) => cur.pieces.length > 1 && !linked.has(p.id)).map((p) => TYPES[p.type][0]);
    const list = h('ul', {}, cur.pieces.map((p) => h('li', {}, `${TYPES[p.type][0]}：${p.text}`)));
    const slot = cur.slot;
    sheet('AI 整理好了', note || null, [
      [cur.on ? '更新光球' : '啟動光球', async () => (await server('orb_toggle', { slot, on: true })) && home()],
      ['再調整', null, 'ghost'],
    ], [h('div', { class: 'good' }, list), alone.length ? h('p', {}, `「${alone.join('、')}」沒有和其他拼圖連結，會各自獨立運作。`) : null], true);
  }

  window.addEventListener('resize', () => cur && lines());
  home();
}
