// ?view=divine — 今日一卦: tap the turtle shell to get one line; six lines make the hexagram.
// The coins are thrown on the server, once per line.
import { YAO_NAMES, isMoving, reading, yaoBit, yaoLabel } from './divine-model.js';

const SHAKE_MS = 700; // the shell rattles this long before the line shows

export async function divineView(h, show, call) {
  document.body.classList.add('brand');
  const [first, book] = await Promise.all([call('divine_get'), fetch('iching.json').then((r) => r.json())]);
  let state = first,
    busy = false;
  const note = h('p', { class: 'divine-note' });
  const back = h('a', { class: 'back', href: '?view=orbs' }, '← 回我的 AI 秘書');

  // Lines are drawn top (上) to bottom (初): yang is one bar, yin is broken, changing lines are marked.
  const stack = (lines) =>
    h(
      'div',
      { class: 'divine-yaos' },
      lines
        .map((v, i) =>
          h(
            'div',
            { class: `divine-yao ${yaoBit(v) === '1' ? 'yang' : 'yin'} ${isMoving(v) ? 'moving' : ''}` },
            h('small', {}, yaoLabel(i, v)),
            h('i', {}),
            h('i', {}),
            h('em', {}, `${YAO_NAMES[v]}${isMoving(v) ? '・變' : ''}`),
          ),
        )
        .reverse(),
    );
  const hex = (x, tag) =>
    h('div', { class: 'divine-hex' }, h('span', { class: 'chip' }, tag), h('h3', {}, `第 ${x.no} 卦・${x.full}`), h('p', { class: 'divine-judg' }, `${x.name}：${x.judgment}`), h('p', {}, x.plain));
  const result = (lines) => {
    const r = reading(lines, book);
    if (!r) return [h('p', { class: 'error' }, '這一卦讀不出來，請重新整理頁面。')];
    return [
      hex(r.main, '本卦'),
      r.moving.length
        ? h('div', { class: 'divine-hex' }, h('span', { class: 'chip' }, '變爻'), r.moving.map((t) => h('p', {}, t)))
        : h('p', { class: 'muted' }, '六爻皆不變，以本卦卦辭為主。'),
      r.changed ? hex(r.changed, '變卦・事情的走向') : null,
      h('p', { class: 'muted' }, '卦象只是提醒，怎麼走仍由你決定。'),
    ];
  };

  async function cast() {
    if (busy || state.lines.length >= 6) return;
    busy = true;
    document.getElementById('divine-turtle')?.classList.add('shaking');
    try {
      const [next] = await Promise.all([call('divine_cast'), new Promise((r) => setTimeout(r, SHAKE_MS))]);
      state = next;
      const y = state.yao;
      draw(y ? `得一爻：${y.coins.map((c) => (c === 3 ? '正' : '反')).join('、')} → ${YAO_NAMES[y.value]}` : '');
    } catch {
      draw('暫時連不上，請再點一次。');
    }
    busy = false;
  }

  function draw(message = '') {
    note.textContent = message;
    const lines = state.lines;
    const past = state.history.length
      ? h(
          'details',
          { class: 'card' },
          h('summary', {}, `之前的卦（${state.history.length}）`),
          state.history.map((d) => {
            const r = reading(d.lines, book);
            return h('p', {}, h('b', {}, d.day.slice(5).replace('-', '/')), `　${r ? `${r.main.full}${r.changed ? ` → ${r.changed.full}` : ''}` : ''}`);
          }),
        )
      : null;
    if (lines.length >= 6)
      return show(back, h('h1', {}, '今日一卦'), h('section', { class: 'card divine' }, stack(lines), result(lines)), past);
    const turtle = h('button', { type: 'button', id: 'divine-turtle', class: 'divine-turtle', 'aria-label': '點龜殼擲錢' }, h('img', { src: 'assets/divine-turtle.webp', alt: '龜殼與三枚古錢', draggable: 'false' }));
    turtle.addEventListener('click', cast);
    show(
      back,
      h('h1', {}, '今日一卦'),
      h(
        'section',
        { class: 'card divine' },
        h('p', { class: 'muted' }, '心裡默想今天最在意的一件事，點一下龜殼得一爻，點滿 6 次成卦。一天只占一卦。'),
        turtle,
        h('p', { class: 'divine-step' }, lines.length ? `已得 ${lines.length} 爻，再點 ${6 - lines.length} 次` : '點一下龜殼，開始第一爻'),
        note,
        lines.length ? stack(lines) : null,
      ),
      past,
    );
  }

  draw();
}
