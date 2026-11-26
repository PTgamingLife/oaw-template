// LIFF page for one OA app: member card, menu pages, and the owner's menu publisher.
import { SHAPES, paintCells } from './menu-shapes.js';
import { confirmView, securityMessage, securitySection, withPin } from './security.js';

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

async function rawCall(action, extra = {}) {
  const res = await fetch(cfg.api, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, idToken: liff.getIDToken(), ...extra }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Error(data.error || 'failed');
  return data;
}
// Owner calls that need a recent PIN ask for it once and retry.
const call = withPin(h, rawCall);

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

export function drawMenu(canvas, config, shape = config.shape ?? 0) {
  canvas.width = 1200;
  canvas.height = 810;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fffef9';
  ctx.fillRect(0, 0, 1200, 810);
  const areas = menuAreas(config.grid);
  // config.fills (介面設計中心): a picture pattern per cell, used instead of the theme colour.
  const fill = (a) => config.fills?.[a.index] ?? config.colors[a.index % 4];
  paintCells(ctx, areas, config.grid, shape, fill, 1200, 810);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px "PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif';
  for (const a of areas) {
    const label = (config.cells[a.index].label || `功能 ${a.index + 1}`).slice(0, 8);
    if (config.fills?.[a.index]) {
      // On a picture the label sits on a light plate so it stays readable.
      const w = Math.min(a.w - 40, ctx.measureText(label).width + 56);
      ctx.fillStyle = 'rgba(255,255,255,.86)';
      ctx.beginPath();
      ctx.roundRect(a.x + (a.w - w) / 2, a.y + a.h / 2 - 40, w, 80, 40);
      ctx.fill();
    }
    ctx.fillStyle = '#2b2b2b';
    ctx.fillText(label, a.x + a.w / 2, a.y + a.h / 2);
  }
}

async function adminView(me) {
  if (!me.isOwner) return fail('只有這個帳號的管理者可以發布選單。');
  const canvas = h('canvas');
  let shape = me.config.shape ?? 0;
  drawMenu(canvas, me.config, shape);
  const picks = SHAPES.map((label, i) => {
    const thumb = h('canvas');
    drawMenu(thumb, me.config, i);
    const pick = h(
      'button',
      { class: i === shape ? 'shape on' : 'shape', type: 'button' },
      thumb,
      h('span', {}, label),
    );
    pick.addEventListener('click', () => {
      shape = i;
      drawMenu(canvas, me.config, shape);
      picks.forEach((p, j) => p.classList.toggle('on', j === i));
    });
    return pick;
  });
  const status = h(
    'p',
    { class: 'muted' },
    '確認上方預覽，按「發布選單」後，所有好友會看到新的圖文選單。',
  );
  const button = h('button', { class: 'btn primary', type: 'button' }, '發布選單');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = '發布中…';
    try {
      const image = canvas.toDataURL('image/png').split(',')[1];
      await call('publish_menu', { image, shape });
      status.textContent = '已發布。回到聊天室就能看到新的選單。';
    } catch (e) {
      status.textContent = `發布失敗（${e.message}），請稍後再試。`;
      button.disabled = false;
    }
  });
  show(
    h('h1', {}, '圖文選單'),
    h('p', { class: 'muted' }, '選一種格子形狀：'),
    h('div', { class: 'shapes' }, picks),
    canvas,
    status,
    button,
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
    data.topupUrl ? h('a', { class: 'btn', href: data.topupUrl }, '前往加值') : null,
  );
}

/** 版本: what this app runs (liff/version.json ships with the template) and the newest release. */
async function versionCard(data) {
  const mine = await fetch('version.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((v) => (typeof v?.version === 'string' ? v.version : ''))
    .catch(() => '');
  const latest = data.latest || '';
  const behind = Boolean(mine && latest && mine !== latest);
  const state = !latest ? '暫時讀不到最新版本。' : !mine ? '這個帳號是較早的版本，建議更新。' : behind ? '有新版本可以更新。' : '已經是最新版本。';
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, '⬆️ 版本'),
    h('div', { class: 'quota-row' }, h('span', {}, '目前版本'), h('strong', {}, mine || '較早的版本')),
    h('div', { class: 'quota-row' }, h('span', {}, '最新版本'), h('strong', {}, latest || '—')),
    h('p', { class: 'muted' }, state),
    data.updateUrl ? h('a', { class: 'btn' + (behind || !mine ? ' primary' : ''), href: data.updateUrl }, behind || !mine ? '前往更新' : '檢查更新') : null,
  );
}

// Calendar subscription: one-way (秘書 → 行事曆); Google refreshes it a few times a day.
function calendarCard() {
  const out = h('div', {});
  const open = async (action) => {
    out.replaceChildren(h('p', { class: 'muted' }, '準備連結…'));
    try {
      const r = await call(action);
      const link = (label, href) => h('a', { class: 'btn', href, target: '_blank', rel: 'noopener' }, label);
      const again = h('button', { class: 'btn', type: 'button' }, '重新產生連結（舊連結失效）');
      again.addEventListener('click', () => open('ics_reset'));
      out.replaceChildren(link('加入 Google 行事曆', r.google), link('加入 iPhone／Mac 行事曆', r.apple), again);
    } catch (e) {
      const msg = e.message === 'pin_cancelled' ? '' : securityMessage(e.message);
      out.replaceChildren(msg ? h('p', { class: 'error' }, msg) : start);
    }
  };
  const start = h('button', { class: 'btn', type: 'button' }, '取得訂閱連結');
  start.addEventListener('click', () => open('ics_link'));
  out.append(start);
  return h(
    'section',
    { class: 'card' },
    h('h3', {}, '📅 加入 Google／iPhone 行事曆'),
    h(
      'p',
      { class: 'muted' },
      '訂閱後，秘書記下的行程會出現在你的行事曆（單向同步）。Google 行事曆大約半天到一天更新一次。這個連結等於鑰匙，請不要分享給別人。',
    ),
    out,
  );
}

// 更多設定. 秘書設定: only what the orb page does not cover — quota, cross-account links,
// the PIN. 介面設定: changing the look belongs to the 領航者版 and is not open yet.
async function settingsView(view) {
  document.body.classList.add('brand');
  const face = view === 'interface';
  const data = face ? null : await call('settings', { view: 'secretary' });
  const tab = (v, label) => h('a', { href: `?view=${v}`, class: (v === 'interface') === face ? 'on' : '' }, label);
  show(
    h('a', { class: 'back', href: '?view=orbs' }, '← 回我的 AI 秘書'),
    h('h1', {}, '更多設定'),
    h('nav', { class: 'tabs' }, tab('secretary', '秘書設定'), tab('interface', '介面設定')),
    ...(face
      ? [
          h(
            'section',
            { class: 'card' },
            h('h3', {}, '🎨 介面設計'),
            h('p', { class: 'muted' }, '自訂選單、配色與卡片樣式。'),
            h('button', { class: 'btn', type: 'button', disabled: '' }, '高階領航者版 開通就可以使用'),
          ),
        ]
      : [
          data.paid ? quotaBars(data) : h('span', { class: 'chip' }, `尚未訂閱・月費 ${data.fee}`),
          h(
            'section',
            { class: 'card' },
            h('h3', {}, '🔗 跨帳號連結'),
            h('p', { class: 'muted' }, '和其他官方帳號互傳指定資訊，雙方都同意才會連結。'),
            h('button', { class: 'btn', type: 'button', disabled: '' }, '開通中'),
          ),
          calendarCard(),
          await versionCard(data),
          await securitySection(h, call),
        ]),
  );
}

async function main() {
  if (!cfg?.liffId) return fail('這個頁面還沒完成設定。');
  await liff.init({ liffId: cfg.liffId });
  if (!liff.isLoggedIn()) return liff.login({ redirectUri: location.href });
  const params = new URLSearchParams(location.search);
  const [me, profile] = await Promise.all([call('me'), liff.getProfile().catch(() => null)]);
  // 秘書版: someone who is not the owner sees only this notice.
  if (me.private && !me.isOwner) {
    document.body.classList.add('brand');
    return show(
      h('h1', {}, '這是私人的 AI 秘書'),
      h('p', { class: 'muted' }, '它目前只服務自己的主人。想要一個專屬於你的 AI 秘書嗎？'),
      h('a', { class: 'btn primary', href: 'https://line.me/R/ti/p/@228srwlt' }, '認識 Aprico AI 秘書'),
    );
  }
  document.documentElement.style.setProperty('--accent', me.config.colors[0]);
  document.title = me.config.oaName || '會員中心';
  if (params.get('view') === 'admin') return adminView(me);
  if (params.get('view') === 'links') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以設定跨帳號連結。');
    return (await import('./links.js')).linksView(h, show, call);
  }
  if (params.get('view') === 'orbs') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以設定 AI 秘書。');
    return (await import('./orbs.js')).orbsView(h, show, call);
  }
  if (params.get('view') === 'show') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以打開這個頁面。');
    return (await import('./show.js')).showView(h, show, call, Number(params.get('slot')));
  }
  if (params.get('view') === 'design') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以使用介面設計中心。');
    return (await import('./design.js')).designView(h, show, call, drawMenu, menuAreas);
  }
  if (params.get('view') === 'calendar') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以看行事曆。');
    return (await import('./calendar.js')).calendarView(h, show, call);
  }
  if (params.get('view') === 'groups') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以設定群組。');
    return (await import('./groups.js')).groupsView(h, show, call);
  }
  if (params.get('view') === 'confirm') {
    if (!me.isOwner) return fail('只有這個帳號的管理者可以套用設定。');
    return confirmView(h, show, call);
  }
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
else if (window.liff)
  main().catch((e) =>
    fail(
      ['owner_locked', 'lock_unknown'].includes(e.message)
        ? securityMessage(e.message)
        : e.message === 'pin_cancelled'
          ? '需要 PIN 才能打開這一頁，請重新開啟後輸入。'
          : `載入失敗（${e.message}），請關閉後重新開啟。`,
    ),
  );
