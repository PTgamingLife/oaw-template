// ?view=fit — 適合功能: the suggestions from the owner's exported chats. Each one has a text
// to copy and paste into an orb's description.
const dots = (n) => '●'.repeat(Math.max(1, Math.min(5, n))) + '○'.repeat(5 - Math.max(1, Math.min(5, n)));

export async function fitView(h, show, call) {
  document.body.classList.add('brand');
  const data = await call('fit_result');
  const back = h('a', { class: 'back', href: '?view=orbs' }, '← 回我的 AI 秘書');
  if (!data.items?.length)
    return show(
      back,
      h('h1', {}, '適合你的功能'),
      h(
        'section',
        { class: 'card' },
        h('p', {}, '還沒有分析結果。'),
        h('p', { class: 'muted' }, '回到聊天室輸入「適合功能」，照說明傳 1 到 3 份 LINE 聊天記錄，我就會幫你找出來。'),
      ),
    );
  const item = (i, n) => {
    const copy = h('button', { class: 'btn primary', type: 'button' }, '複製這段文字');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(i.text);
      } catch {
        const t = h('textarea', {}, i.text);
        document.body.append(t);
        t.select();
        document.execCommand('copy');
        t.remove();
      }
      copy.textContent = '已複製 ✓';
      setTimeout(() => (copy.textContent = '複製這段文字'), 1800);
    });
    return h(
      'section',
      { class: 'card fit-item' },
      h('h3', {}, `${n + 1}. ${i.title}`),
      i.why ? h('p', { class: 'muted' }, i.why) : null,
      h('p', { class: 'fit-score' }, h('span', {}, `常發生 ${dots(i.often)}`), h('span', {}, `做得到 ${dots(i.fit)}`)),
      h('p', { class: 'fit-text' }, i.text),
      copy,
    );
  };
  show(
    back,
    h('h1', {}, '適合你的功能'),
    data.summary ? h('p', { class: 'muted' }, data.summary) : null,
    h(
      'section',
      { class: 'card' },
      h('h3', {}, '怎麼用'),
      h('p', { class: 'muted' }, '挑一項按「複製這段文字」→ 回到我的 AI 秘書 → 點一顆光球 → 把文字貼到說明裡，秘書會幫你選好拼圖。'),
      h('a', { class: 'btn', href: '?view=orbs' }, '前往光球設定'),
    ),
    ...data.items.map(item),
  );
}
