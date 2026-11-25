// ?view=show&slot=N — the page a lit orb opens from the LINE menu (its 顯示介面). It can only
// draw the layouts below; the server sends this orb's own data and nothing else.
import { securityMessage } from './security.js';

const twd = (n) => 'NT$' + Number(n || 0).toLocaleString('en-US');
const KIND = { event: '行程', todo: '待辦', expense: '記帳', life: '生活' };
const hm = (iso) => new Date(iso).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' });
const md = (iso) => new Date(iso).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Taipei' });

export async function showView(h, show, call, slot) {
  if (!document.getElementById('show-css')) {
    const link = h('link', { id: 'show-css', rel: 'stylesheet', href: 'show.css' });
    document.head.append(link);
    await new Promise((done) => ((link.onload = done), (link.onerror = done)));
  }
  document.body.classList.add('show-mode');
  const stage = h('div', { id: 'show-stage' });
  show(stage);
  const fail = (code) =>
    stage.replaceChildren(
      h('p', { class: 's-note' }, code === 'orb_off' ? '這顆光球目前是關閉的，或還沒有設定顯示介面。' : securityMessage(code)),
      h('a', { class: 's-btn', href: '?view=orbs' }, '打開秘書'),
    );
  let d;
  const load = async (extra = {}) => {
    try {
      d = await call('orb_show', { slot, ...extra });
      return true;
    } catch (e) {
      fail(e.message);
      return false;
    }
  };
  if (!(await load())) return;
  if (d.face === 'calendar') return (await import('./calendar.js')).calendarView(h, show, call);

  const card = (title, side, ...kids) => h('section', { class: 's-card' }, h('h2', {}, title, side ? h('small', {}, side) : null), ...kids.flat(Infinity));
  const empty = (text) => h('p', { class: 's-empty' }, text);

  /* ---------- 統計圖表 ---------- */
  function stats() {
    const out = [];
    const t = d.tally;
    // A long description makes a poor title: keep the first few characters.
    const subject = d.subject.length > 10 ? `${d.subject.slice(0, 10)}…` : d.subject;
    // Counting belongs to the two layouts that show it; the money layouts read saved records.
    if (d.canCount && (d.template === 'rank' || d.template === 'detail')) {
      const btn = h('button', { class: 's-btn', type: 'button' }, t ? '重新統計' : '開始統計');
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '統計中…';
        if (await load({ count: true })) draw();
      });
      out.push(h('p', { class: 's-note' }, d.tallyNote || '按下按鈕才會統計（每次會用到一點 AI 額度）。'), btn);
    }
    if (d.template === 'rank' || d.template === 'detail') {
      if (!t) return out.push(card(d.template === 'rank' ? '數量排行' : '每人明細', '', empty(d.canCount ? '還沒有統計結果。' : '這顆光球沒有「統計」拼圖，請到光球裡放一片。'))), out;
      if (d.template === 'rank') {
        const max = Math.max(1, ...t.items.map((i) => i.qty));
        const rows = [...t.items].sort((a, b) => b.qty - a.qty);
        out.push(card(`${subject}・數量排行`, `共 ${t.count} 人`, h('div', { class: 's-rank' }, rows.map((i) => h('div', {}, h('span', {}, i.name), h('i', { style: `width:${Math.max(6, (i.qty / max) * 100)}%` }), h('b', {}, String(i.qty)))))));
      } else {
        // Columns follow what this orb counts: estimated measures, and money only when priced.
        const ms = d.measures ?? [];
        const money = t.total > 0;
        const cell = (v, unit) => h('td', {}, v ? `${Number(v).toLocaleString('en-US')}${unit || ''}` : '—');
        out.push(
          card(
            `${subject}・每人明細`,
            `共 ${t.count} 人`,
            h(
              'div',
              { class: 's-scroll' },
              h(
                'table',
                { class: 's-table' },
                h('tr', {}, h('th', {}, '誰'), h('th', {}, '內容'), ms.map((m) => h('th', {}, m.name)), money ? h('th', {}, '金額') : null),
                t.people.map((p) => h('tr', {}, h('td', {}, p.who), h('td', {}, p.lines.join('、')), ms.map((m, i) => cell(p.values?.[i], m.unit)), money ? cell(p.amount) : null)),
                ms.length || money ? h('tr', { class: 'sum' }, h('td', {}, '合計'), h('td', {}), ms.map((m, i) => cell(t.sums?.[i], m.unit)), money ? h('td', {}, twd(t.total)) : null) : null,
              ),
            ),
            ms.length ? h('p', { class: 's-note' }, '※ 估算值只憑文字推估，僅供參考。') : null,
          ),
        );
      }
      return out;
    }
    const m = d.money;
    if (d.template === 'total') {
      const colours = ['#5866D6', '#6FC3AD', '#FFC53D', '#F09AB4', '#B8BCD8'];
      out.push(
        card(
          `${Number(m.month.slice(5))} 月支出`,
          `共 ${m.count} 筆`,
          m.count
            ? [
                h('div', { class: 's-total' }, twd(m.total)),
                h('div', { class: 's-split' }, m.parts.map((p, i) => h('i', { style: `width:${(p.amount / Math.max(1, m.total)) * 100}%;background:${colours[i % 5]}` }))),
                h('div', { class: 's-legend' }, m.parts.map((p, i) => h('div', {}, h('span', {}, h('i', { style: `background:${colours[i % 5]}` }), p.name), h('b', {}, p.amount.toLocaleString('en-US'))))),
              ]
            : empty('這個月還沒有記帳。在這個對話裡說「午餐 120」，秘書每晚整理後就會出現。'),
        ),
      );
      return out;
    }
    // trend: the last 7 days as bars (drawn to one scale, the largest day = full height)
    const max = Math.max(1, ...m.days.map((x) => x.amount));
    const sum = m.days.reduce((n, x) => n + x.amount, 0);
    out.push(
      card(
        '最近 7 天',
        sum ? `合計 ${twd(sum)}` : '',
        sum
          ? h('div', { class: 's-trend', role: 'img', 'aria-label': m.days.map((x) => `${x.day.slice(5)} ${x.amount} 元`).join('、') }, m.days.map((x) => h('div', {}, h('b', {}, x.amount ? String(x.amount) : ''), h('i', { style: `height:${(x.amount / max) * 100}%` }), h('span', {}, x.day.slice(8)))))
          : empty('最近 7 天沒有金額紀錄。'),
      ),
    );
    return out;
  }

  /* ---------- 備註記事 ---------- */
  function notes() {
    const all = d.notes;
    if (d.template === 'todo') {
      const todos = all.filter((n) => n.kind === 'todo');
      const done = todos.filter((n) => n.done).length;
      return [
        card(
          '待辦',
          todos.length ? `完成 ${done}／${todos.length}` : '',
          todos.length
            ? h('ul', { class: 's-list todo' }, todos.map((n) => {
                const b = h('button', { class: n.done ? 'done' : '', type: 'button', 'aria-pressed': String(n.done) }, h('i', {}), h('span', {}, n.title));
                b.addEventListener('click', async () => (await load({ id: n.id, done: !n.done })) && draw());
                return h('li', {}, b);
              }))
            : empty('目前沒有待辦。在這個對話裡說「記得繳停車費」，秘書每晚整理後就會出現。'),
        ),
      ];
    }
    if (!all.length) return [card(d.faceName, '', empty('還沒有紀錄。這個對話裡提到的事，秘書每晚整理後會出現在這裡。'))];
    const line = (n) => (n.kind === 'expense' && n.amount != null ? `${n.title} ${twd(n.amount)}` : n.kind === 'event' && n.day ? `${n.day.slice(5)} ${n.time} ${n.title}`.replace(/\s+/g, ' ') : n.title);
    if (d.template === 'wall') {
      const tint = { event: '#EEF0FF', todo: '#E6F6F1', expense: '#FFF3D6', life: '#FDE8EE' };
      return [card('筆記牆', `${all.length} 則`, h('div', { class: 's-wall' }, all.slice(0, 40).map((n) => h('div', { style: `background:${tint[n.kind]}` }, h('b', {}, KIND[n.kind]), line(n)))))];
    }
    if (d.template === 'timeline') {
      const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const rows = all.filter((n) => new Date(new Date(n.at).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10) === today).reverse();
      return [card('今天的紀錄', md(new Date().toISOString()), rows.length ? h('div', { class: 's-line' }, rows.map((n) => h('div', {}, h('time', {}, hm(n.at)), h('i', {}), h('span', {}, line(n))))) : empty('今天還沒有紀錄。'))];
    }
    return [card('最近的紀錄', `${all.length} 則`, h('ul', { class: 's-list' }, all.slice(0, 40).map((n) => h('li', {}, line(n), h('small', {}, `${md(n.at)} ${hm(n.at)}・${KIND[n.kind]}`)))))];
  }

  function draw() {
    stage.replaceChildren(
      h('div', { class: 's-top' }, h('a', { class: 's-back', href: '?view=orbs', 'aria-label': '打開秘書' }, '←'), h('h1', {}, d.name), h('span', {}, d.faceName)),
      ...(d.face === 'stats' ? stats() : notes()),
    );
  }
  draw();
}
