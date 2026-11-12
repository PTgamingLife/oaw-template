// LIFF page for one OA app: member card, menu pages, and the owner's menu publisher.
const app = document.getElementById('app');
const cfg = window.OAW;

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};
const show = (...nodes) => app.replaceChildren(...nodes.flat().filter((n) => n != null));
const fail = (msg) => show(h('p', { class: 'error' }, msg));

async function call(action, extra = {}) {
  const res = await fetch(cfg.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, idToken: liff.getIDToken(), ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(data.error || 'failed');
  return data;
}

function memberCard(me, profile) {
  const joined = me.member?.joined_at
    ? new Date(me.member.joined_at).toLocaleDateString('zh-TW')
    : '';
  return h(
    'section',
    { class: 'card member' },
    profile?.pictureUrl ? h('img', { src: profile.pictureUrl, alt: '' }) : null,
    h(
      'div',
      {},
      h('div', { class: 'no' }, `會員編號 ${String(me.member?.member_no ?? '').padStart(5, '0')}`),
      h('div', { class: 'name' }, profile?.displayName || me.member?.display_name || '會員'),
      joined ? h('div', { class: 'no' }, `加入日期 ${joined}`) : null,
    ),
  );
}

function links(config) {
  const items = config.cells
    .map((c, i) => ({ ...c, i }))
    .filter((c) => c.label && (c.action === 'web' || (c.action === 'full' && c.content)));
  if (!items.length) return null;
  return h(
    'section',
    { class: 'links' },
    items.map((c) =>
      c.action === 'web'
        ? h('a', { class: 'btn', href: c.content, target: '_blank', rel: 'noreferrer' }, c.label)
        : h('a', { class: 'btn', href: `?cell=${c.i}` }, c.label),
    ),
  );
}

export function menuAreas(grid, width = 1200, height = 810) {
  const columns = grid === 6 ? 3 : 2,
    rows = grid / columns,
    w = width / columns;
  return Array.from({ length: grid }, (_, index) => {
    const row = Math.floor(index / columns),
      top = Math.floor((row * height) / rows),
      bottom = Math.floor(((row + 1) * height) / rows);
    return { index, x: (index % columns) * w, y: top, w, h: bottom - top };
  });
}

function drawMenu(canvas, config) {
  canvas.width = 1200;
  canvas.height = 810;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffef9';
  ctx.fillRect(0, 0, 1200, 810);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const a of menuAreas(config.grid)) {
    ctx.fillStyle = config.colors[a.index % 4];
    ctx.fillRect(a.x + 4, a.y + 4, a.w - 8, a.h - 8);
    ctx.fillStyle = '#2b2b2b';
    ctx.font = 'bold 44px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.fillText(
      (config.cells[a.index].label || `功能 ${a.index + 1}`).slice(0, 8),
      a.x + a.w / 2,
      a.y + a.h / 2,
    );
  }
}

async function adminView(me) {
  if (!me.isOwner) return fail('只有這個帳號的管理者可以發布選單。');
  const canvas = h('canvas');
  drawMenu(canvas, me.config);
  const status = h(
    'p',
    { class: 'muted' },
    '確認下方預覽，按「發布選單」後，所有好友會看到新的圖文選單。',
  );
  const button = h('button', { class: 'btn primary', type: 'button' }, '發布選單');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '發布中…';
    try {
      const image = canvas.toDataURL('image/png').split(',')[1];
      await call('publish_menu', { image });
      status.textContent = '已發布。回到聊天室就能看到新的選單。';
    } catch (e) {
      status.textContent = `發布失敗（${e.message}），請稍後再試。`;
      button.disabled = false;
    }
  });
  show(h('h1', {}, '圖文選單'), canvas, status, button);
}

const exampleFor = (data, tpl) =>
  data.examples.find((e) => e.id === (data.view === 'interface' ? 'interface' : tpl.id)) ??
  data.examples[0];

function examplePanel(data, tpl) {
  const ex = exampleFor(data, tpl);
  return h(
    'div',
    { class: 'panel' },
    h('img', { class: 'shot', src: `assets/examples/${ex.id}.jpg`, alt: `${ex.label}範例畫面` }),
    h(
      'div',
      { class: 'chat' },
      h('div', { class: 'me' }, ex.chat[0]),
      h('div', { class: 'bot' }, ex.chat[1]),
    ),
    h('p', {}, ex.benefit),
    h('p', { class: 'fee' }, ex.fee),
    h(
      'a',
      { class: 'btn brand', href: data.subscribeUrl, target: '_blank', rel: 'noreferrer' },
      `訂閱月費 ${data.fee}`,
    ),
  );
}

function tutorialPanel(data, tpl) {
  const send = h('button', { class: 'btn brand', type: 'button' }, '送出設定句子');
  send.addEventListener('click', async () => {
    try {
      await liff.sendMessages([{ type: 'text', text: tpl.command }]);
      liff.closeWindow();
    } catch {
      await navigator.clipboard?.writeText(tpl.command).catch(() => {});
      send.textContent = '已複製，請回到聊天室貼上送出';
    }
  });
  return h(
    'div',
    { class: 'panel' },
    h(
      'ol',
      {},
      data.tutorial.map((t) => h('li', {}, t)),
    ),
    h('div', { class: 'cmd' }, tpl.command),
    send,
  );
}

/** Users see percentages only; the extra bar (grace + top-up) shows sale-price NT$. */
function quotaBars(data) {
  const bar = (label, value, pct) =>
    h(
      'div',
      { class: 'quota' },
      h('div', { class: 'quota-row' }, h('span', {}, label), h('strong', {}, value)),
      h('div', { class: 'quota-track' }, h('div', { class: 'quota-fill', style: `width:${pct}%` })),
    );
  return h(
    'section',
    { class: 'card' },
    bar('本月額度', `剩 ${data.percentLeft}%`, data.percentLeft),
    data.extraTwdLeft
      ? bar('加值額度', `剩 NT$${data.extraTwdLeft}`, Math.min(100, (data.extraTwdLeft / 50) * 100))
      : null,
    data.paidUntil ? h('p', { class: 'muted' }, `訂閱到 ${data.paidUntil}`) : null,
  );
}

async function settingsView(view) {
  document.body.classList.add('brand');
  const data = await call('settings', { view });
  const tab = (v, label) =>
    h('a', { href: `?view=${v}`, class: v === data.view ? 'on' : '' }, label);
  const cards = data.templates.map((tpl) => {
    const card = h(
      'section',
      { class: 'card tpl' },
      h('h3', {}, tpl.label),
      tpl.detail ? h('p', {}, tpl.detail) : null,
    );
    const start = h(
      'button',
      { class: 'btn', type: 'button' },
      data.paid ? '開始設定' : '看使用範例',
    );
    start.addEventListener('click', () => {
      card.querySelector('.panel')?.remove();
      card.append(data.paid ? tutorialPanel(data, tpl) : examplePanel(data, tpl));
    });
    card.append(start);
    return card;
  });
  show(
    h(
      'div',
      { class: 'brand-head' },
      h('img', { src: 'assets/aprico-mark.png', alt: '' }),
      h('strong', {}, 'Aprico AI 秘書'),
    ),
    h(
      'nav',
      { class: 'tabs' },
      tab('secretary', '設定我的 AI 秘書'),
      tab('interface', '設定我的介面'),
    ),
    data.paid
      ? quotaBars(data)
      : h('span', { class: 'chip' }, `尚未訂閱・月費 ${data.fee}，訂閱後才能開始設定`),
    ...cards,
  );
}

async function main() {
  if (!cfg?.liffId) return fail('這個頁面還沒完成設定。');
  await liff.init({ liffId: cfg.liffId });
  if (!liff.isLoggedIn()) return liff.login({ redirectUri: location.href });
  const params = new URLSearchParams(location.search);
  const [me, profile] = await Promise.all([call('me'), liff.getProfile().catch(() => null)]);
  document.documentElement.style.setProperty('--accent', me.config.colors[0]);
  document.title = me.config.oaName || '會員中心';
  if (params.get('view') === 'admin') return adminView(me);
  if (params.get('view') === 'health')
    return (await import('./health.js')).healthView({ h, show, call }, params);
  if (['secretary', 'interface'].includes(params.get('view'))) {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以進入設定。');
    return settingsView(params.get('view'));
  }
  const index = Number(params.get('cell'));
  const cell = params.has('cell') ? me.config.cells[index] : null;
  if (cell?.content && cell.action === 'full')
    return show(h('h1', {}, cell.label), h('section', { class: 'card content' }, cell.content));
  show(h('h1', {}, me.config.oaName || '會員中心'), memberCard(me, profile), links(me.config));
}

const mock =
  ['localhost', '127.0.0.1'].includes(location.hostname) && location.search.includes('mock=1');
if (mock)
  // Local preview with sample data; never active on the published site.
  Promise.all([import('./health.js'), import('./health-mock.js')]).then(([m, d]) =>
    m.healthView({ h, show, call: d.mockCall }, new URLSearchParams(location.search)),
  );
else if (window.liff) main().catch((e) => fail(`載入失敗（${e.message}），請關閉後重新開啟。`));
