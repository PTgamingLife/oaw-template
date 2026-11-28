// ?view=study — 學習紀錄: the course in progress (each day's score, questions that can be
// taken out), courses waiting, and finished ones with the points still to learn.
import { securityMessage } from './security.js';

const STATUS = { active: '進行中', queued: '排隊中', done: '已完成' };

export async function studyView(h, show, call) {
  document.body.classList.add('brand');
  const back = h('a', { class: 'back', href: '?view=orbs' }, '← 回我的 AI 秘書');
  const note = h('p', { class: 'error' });
  const draw = (data) => {
    if (!data.courses.length)
      return show(
        back,
        h('h1', {}, '學習紀錄'),
        h(
          'section',
          { class: 'card' },
          h('p', {}, '還沒有學習資料。'),
          h('p', { class: 'muted' }, '先在個人對話的光球放上「學習」拼圖，再到聊天室輸入「學習資料」，把 .txt 或 Word 檔傳給秘書。'),
        ),
      );
    const act = async (action, extra, sure) => {
      if (sure && !confirm(sure)) return;
      note.textContent = '';
      try {
        draw(await call(action, extra));
      } catch (e) {
        if (e.message !== 'pin_cancelled') note.textContent = securityMessage(e.message);
      }
    };
    const course = (c) => {
      const del = h('button', { class: 'btn study-del', type: 'button' }, '刪除這份資料');
      del.addEventListener('click', () => act('study_delete', { id: c.id }, `確定刪除「${c.title}」？題目和作答紀錄都會刪除。`));
      return h(
        'section',
        { class: 'card' },
        h('h3', {}, `${c.title}`),
        h('p', { class: 'muted' }, `${STATUS[c.status]}・${c.status === 'queued' ? '前一份學完後開始' : `${c.start.slice(5).replace('-', '/')} 開始`}・共 ${c.days.length} 天`),
        h(
          'ul',
          { class: 'study-days' },
          c.days.map((d, i) =>
            h(
              'li',
              { class: c.status === 'active' && c.day === i + 1 ? 'now' : '' },
              h('b', {}, `第 ${i + 1} 天`),
              h('small', {}, d.focus),
              h('span', {}, d.done ? `${d.right}／${d.total}` : c.status === 'active' && c.day > i + 1 ? '未作答' : '—'),
            ),
          ),
        ),
        c.status !== 'queued' && c.unlearned.length
          ? h('div', {}, h('p', { class: 'muted' }, c.status === 'done' ? '還要再看一下的重點' : '還沒答對的重點'), h('ul', {}, c.unlearned.map((p) => h('li', {}, p))))
          : null,
        c.questions.length
          ? h(
              'details',
              {},
              h('summary', {}, `題目清單（${c.questions.length} 題）`),
              h('p', { class: 'muted' }, '覺得哪一題出得不好，可以拿掉，之後不會再考。'),
              h(
                'ul',
                { class: 'study-list' },
                c.questions.map((q) => {
                  const off = h('button', { type: 'button' }, '拿掉');
                  off.addEventListener('click', () => act('study_flag', { id: c.id, ref: q.ref }));
                  return h('li', { class: q.off ? 'off' : '' }, h('span', {}, q.q), q.off ? h('small', {}, '已拿掉') : off);
                }),
              ),
            )
          : null,
        del,
      );
    };
    show(
      back,
      h('h1', {}, '學習紀錄'),
      h('p', { class: 'muted' }, '每晚考當天的題目，隔天早上複習答錯的；還是答錯的，當晚會再出現。要加新的資料，到聊天室輸入「學習資料」。'),
      note,
      ...data.courses.map(course),
    );
  };
  draw(await call('study_view'));
}
