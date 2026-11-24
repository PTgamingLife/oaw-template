// ?view=calendar — 行事曆: a month grid of the events the secretary recorded. Tap a day to
// see its events and which chat each came from; a wrong entry can be removed (PIN).
import { securityMessage } from './security.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const pad = (n) => String(n).padStart(2, '0');
const todayTaipei = () => new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/** Day cells for one month: leading blanks, then each date as YYYY-MM-DD. */
export function monthCells(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [...Array(first).fill(''), ...Array.from({ length: days }, (_, i) => `${month}-${pad(i + 1)}`)];
}
export const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

export async function calendarView(h, show, call) {
  if (!document.getElementById('cal-css')) {
    const link = h('link', { id: 'cal-css', rel: 'stylesheet', href: 'calendar.css' });
    document.head.append(link);
    await new Promise((done) => ((link.onload = done), (link.onerror = done)));
  }
  document.body.classList.add('cal-mode');
  const stage = h('div', { id: 'cal-stage' });
  show(stage);
  const today = todayTaipei();
  let month = today.slice(0, 7),
    picked = today,
    events = [];
  const status = h('p', { class: 'cal-note' });

  async function load(action = 'cal_month', extra = {}) {
    try {
      const r = await call(action, { month, ...extra });
      events = r.events;
      status.textContent = '';
    } catch (e) {
      if (e.message !== 'pin_cancelled') status.textContent = securityMessage(e.message);
    }
    render();
  }
  function render() {
    const byDay = new Map();
    for (const e of events) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
    const [y, m] = month.split('-').map(Number);
    const nav = (label, by, name) => {
      const b = h('button', { class: 'cal-nav', type: 'button', 'aria-label': name }, label);
      b.addEventListener('click', () => {
        month = shiftMonth(month, by);
        picked = month === today.slice(0, 7) ? today : `${month}-01`;
        load();
      });
      return b;
    };
    const grid = h('div', { class: 'cal-grid' }, WEEK.map((w) => h('span', { class: 'wd' }, w)));
    for (const day of monthCells(month)) {
      if (!day) {
        grid.append(h('span', {}));
        continue;
      }
      const n = byDay.get(day)?.length ?? 0;
      const b = h(
        'button',
        {
          class: 'day' + (day === picked ? ' on' : '') + (day === today ? ' today' : ''),
          type: 'button',
          'aria-label': `${Number(day.slice(8))} 日${n ? `，${n} 個行程` : ''}`,
          'aria-pressed': String(day === picked),
        },
        String(Number(day.slice(8))),
        h('i', { class: n ? 'dot' : '' }),
      );
      b.addEventListener('click', () => ((picked = day), render()));
      grid.append(b);
    }
    const list = byDay.get(picked) ?? [];
    const dayTitle = `${Number(picked.slice(5, 7))} 月 ${Number(picked.slice(8))} 日（${WEEK[new Date(picked + 'T00:00:00Z').getUTCDay()]}）`;
    stage.replaceChildren(
      h(
        'div',
        { class: 'cal-bar' },
        h('a', { class: 'cal-back', href: '?view=orbs', 'aria-label': '回我的 AI 秘書' }, '←'),
        h('h1', {}, '行事曆'),
      ),
      h(
        'section',
        { class: 'cal-card' },
        h('div', { class: 'cal-head' }, nav('‹', -1, '上個月'), h('b', {}, `${y} 年 ${m} 月`), nav('›', 1, '下個月')),
        grid,
      ),
      h(
        'section',
        { class: 'cal-card' },
        h('h2', {}, dayTitle),
        list.length
          ? list.map((e) => {
              const del = h('button', { class: 'cal-del', type: 'button', 'aria-label': `刪除 ${e.title}` }, '刪除');
              del.addEventListener('click', () => load('cal_delete', { id: e.id }));
              return h(
                'div',
                { class: 'cal-event' },
                h('time', {}, e.time || '整天'),
                h('div', {}, h('b', {}, e.title), h('small', {}, e.from)),
                del,
              );
            })
          : h('p', { class: 'cal-note' }, '這天沒有行程。把行程傳給秘書，晚上整理後就會出現在這裡。'),
      ),
      status,
    );
  }
  await load();
}
