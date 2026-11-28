// Parts of the orb page that are not the plane itself: the piece catalogue with its plain-word
// explanations, the tray (顯示介面 / 運行拼圖 / 秘書性格), adding a group, and 調整設定.
export const TYPES = {
  record: ['記錄', '例如：記下跟行程有關的內容', '希望 AI 秘書幫你記錄文字對話裡的什麼重點事項？'],
  organize: ['整理分類', '例如：做成行事曆，依日期分類', '整理後的內容，該如何分類？'],
  command: ['指令', '例如：說「秘書」就執行後面交辦的事', '你與秘書的暗號，說了馬上執行。例如：「秘書幫我⋯⋯」就會幫你馬上執行後面交辦的事項。只說暗號，會直接顯示這顆光球的介面。'],
  push: ['定時提醒', '例如：每天早上 07:00 提醒我今天的行程', '在什麼時間，推播什麼特定內容。可以是一句固定的話（例如：每天早上八點提醒我喝水），或是記下來的資料（例如：每天早上提醒我今天的行程、待辦事項）。'],
  stats: ['統計', '例如：統計便當，每天 11:00 截止，每人以最後一次為準', '統計對話中的事件或數量，比如今天大家訂的便當清單數量。也可以請 AI 估算數值，比如每個人飲食的熱量（估算值僅供參考）。（只能用在群組）'],
  announce: ['公告', '例如：我說「發到群組：…」就發到這個群組', '從主對話要求秘書，把訊息發送到這個群組。（只能用在群組）'],
  answer: ['回答', '例如：這個對話裡的訊息都要回覆', '任何訊息 AI 都會回覆，但很消耗用量。只是日常交辦、沒有問問題時，會用最少的字數回答；和秘書性格有衝突的地方，以秘書性格設定為主。'],
  study: ['學習', '例如：每晚九點考我上傳的資料，隔天早上七點半複習', '把教材變成每天的小考。在聊天室輸入「學習資料」再傳 .txt 或 Word 檔，秘書會一次出好 1 到 5 天的選擇題；每晚考當天的題目，隔天早上複習答錯的。只有出題那一次會用到 AI 額度。（只能用在個人對話）'],
  divine: ['卜卦', '例如：我說「卜卦」就給我今天的一卦', '每天一卦（三錢法・周易 64 卦）。在聊天室說「卜卦」，打開頁面搖 6 次龜殼成卦，顯示卦辭、變爻和白話說明。不會用到 AI 額度。（只能用在個人對話）'],
};
export const FACES = {
  calendar: ['行事曆', '月曆，點日期看當天的行程。', { month: '月曆' }],
  stats: ['統計圖表', '數量或金額的圖表。', { rank: '數量排行', detail: '每人明細', trend: '每日趨勢', total: '金額合計' }],
  notes: ['備註記事', '清單、待辦或筆記。', { list: '條列清單', todo: '待辦勾選', wall: '卡片牆', timeline: '時間軸' }],
};
export const faceLabel = (o) => (o.face ? `${FACES[o.face][0]}・${FACES[o.face][2][o.template] ?? ''}` : '未設定介面');

/** Fire `onHold` after a long press; a quick tap still reaches the click handler. */
export function hold(el, onHold) {
  let timer = 0,
    held = false;
  el.addEventListener('pointerdown', () => {
    held = false;
    timer = setTimeout(() => ((held = true), onHold()), 550);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(ev, () => clearTimeout(timer));
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return () => held;
}

/**
 * The tray under the plane. `ui` = { h, sheet, notice, server }, `cur` = the orb being edited,
 * `state` = the page state, `on` = { add(type), change() }.
 */
export function tray(ui, cur, state, on) {
  const { h, sheet, notice } = ui;
  const box = h('div', { class: 'tray' });
  const pick = h(
    'select',
    { id: 'tray-kind', 'aria-label': '拼圖分類' },
    h('option', { value: 'run' }, '運行拼圖'),
    h('option', { value: 'face' }, '顯示介面'),
    h('option', { value: 'persona' }, '秘書性格'),
  );
  pick.value = tray.kind ?? 'run';
  const body = h('div', {});
  const draw = () => {
    tray.kind = pick.value;
    if (pick.value === 'run') {
      const row = h('div', { class: 'row' });
      for (const [type, [name, , help]] of Object.entries(TYPES)) {
        const b = h('button', { class: `piece s-${type}`, type: 'button' }, name);
        const held = hold(b, () => notice(`「${name}」是什麼`, help));
        b.addEventListener('click', () => !held() && on.add(type));
        row.append(b);
      }
      return body.replaceChildren(h('p', {}, '點拼圖放到上面的平面；長按拼圖看說明。'), row);
    }
    if (pick.value === 'face') {
      const row = h('div', { class: 'faces' });
      for (const [face, [name, about]] of Object.entries(FACES)) {
        const b = h('button', { class: 'face' + (cur.face === face ? ' on' : ''), type: 'button', 'aria-pressed': String(cur.face === face) }, h('b', {}, name), h('small', {}, about));
        b.addEventListener('click', () => {
          cur.face = cur.face === face ? '' : face;
          cur.template = cur.face ? Object.keys(FACES[face][2])[0] : '';
          on.change();
          draw();
        });
        row.append(b);
      }
      return body.replaceChildren(
        h('p', {}, '每顆光球選一個。它決定在 LINE 選單按下這顆光球後，會打開什麼頁面；版型由 AI 依拼圖內容挑選。'),
        row,
        h('a', { class: 'btn3d ghost small', href: 'templates.html' }, '範例'),
      );
    }
    const own = Boolean(cur.persona);
    const text = cur.persona || state.persona.shared || state.persona.default;
    const edit = h('button', { class: 'btn3d small', type: 'button' }, '編輯');
    edit.addEventListener('click', () => {
      const ta = h('textarea', { id: 'persona-text', rows: '9', maxlength: '800' });
      ta.value = text;
      const save = async (onlyHere) => {
        const v = ta.value.trim();
        if (!v) return;
        if (onlyHere) (cur.persona = v), on.change();
        else {
          if (!(await ui.server('orb_persona', { text: v }, '儲存中…'))) return;
          if (cur.persona) (cur.persona = ''), on.change();
        }
        draw();
      };
      sheet('秘書性格', '調整講話的方式、習慣和限制。最多 800 字。', [
        ['全部光球都用', () => save(false)],
        ['只用在這顆光球', () => save(true), 'ghost'],
        ['取消', null, 'ghost'],
      ], [ta]);
    });
    const reset = h('button', { class: 'btn3d ghost small', type: 'button' }, '回到預設');
    reset.addEventListener('click', async () => {
      if (own) (cur.persona = ''), on.change();
      else if (!(await ui.server('orb_persona', { text: null }, '還原中…'))) return;
      draw();
    });
    const source = own ? '這顆光球自己的設定' : state.persona.shared ? '你修改過的共用設定' : '預設（版本更新時會跟著更新）';
    body.replaceChildren(
      h('p', {}, `目前使用：${source}`),
      h('div', { class: 'persona' }, text),
      h('div', { class: 'tools' }, edit, own || state.persona.shared ? reset : null),
    );
  };
  pick.addEventListener('change', draw);
  box.append(h('label', { class: 'target' }, '分類', pick), body);
  draw();
  return box;
}

/** LINE has no join-by-link for official accounts: a member has to invite it into the group. */
export function addGroupHelp(ui, basicId, refresh) {
  const { h, sheet } = ui;
  const pic = (name, alt) => h('img', { src: `assets/help/${name}.jpg`, alt, loading: 'lazy' });
  const steps = [
    ['到 LINE 官方帳號管理後台的「設定 → 帳號」，把「加入群組或多人聊天室」設成「允許」。', pic('group-allow', '功能切換裡的「加入群組或多人聊天室」設為允許')],
    [`在要加入的群組裡按「邀請」，選這個官方帳號${basicId ? `（${basicId}）` : ''}。`],
    ['官方帳號進群後，由你本人在群組裡說一句「綁定」，秘書會回覆「已綁定這個群組」。', pic('group-bind', '在群組裡傳「綁定」')],
    ['按下面的「我綁定好了」，對話對象就會出現那個群組。'],
  ];
  sheet('新增群組', '官方帳號沒有辦法用連結自己加入群組，要由群組成員邀請它。', [['我綁定好了', refresh], ['先不用', null, 'ghost']], [h('ol', { class: 'steps' }, steps.map((t) => h('li', {}, t)))], true);
}

/** Long-press on an orb: say in plain words what it should do, or switch it on and off. */
export function adjustSheet(ui, o, act) {
  const { h, sheet } = ui;
  const ready = o.pieces.length && o.target && o.pieces.every((p) => p.params);
  const ta = h('textarea', {
    id: 'adjust-text',
    rows: '3',
    maxlength: '300',
    placeholder: ready ? '例如：改成每天晚上八點提醒／統計改成看每個人點了什麼' : '例如：幫我統計午餐群每天的便當，十一點截止',
  });
  sheet(
    `${ready ? '調整' : '設定'}「${o.name}」`,
    ready
      ? `顯示介面：${faceLabel(o)}。直接用說的告訴秘書想怎麼調整；版型只能在範例裡的幾種之間換，想要其他形式請聯絡服務人員。`
      : '直接用說的告訴秘書，這顆光球要幫你做什麼。秘書會建議需要的拼圖，你同意後才會放上去。也可以自己點進去放拼圖。',
    [
      [ready ? '送出調整' : '請秘書建議', () => ta.value.trim() && (ready ? act.tune : act.plan)(ta.value.trim())],
      o.on ? ['關閉光球', () => act.toggle(false), 'ghost'] : ready ? ['開啟光球', () => act.toggle(true), 'ghost'] : ['自己設定', act.open, 'ghost'],
      ['取消', null, 'ghost'],
    ],
    [ta],
  );
}

/** Show what the AI proposes to add or remove. Nothing changes until the owner agrees. */
export function planSheet(ui, o, plan, note, act) {
  const { h, sheet } = ui;
  const rows = [
    plan.face ? h('li', {}, h('b', {}, '顯示介面'), `：${FACES[plan.face][0]}`) : null,
    ...plan.suggest.map((s) => h('li', {}, h('b', {}, `新增「${TYPES[s.type][0]}」`), `：${s.text}`)),
    ...plan.drop.map((id) => {
      const p = o.pieces.find((x) => x.id === id);
      return p ? h('li', {}, h('b', {}, `拿掉「${TYPES[p.type][0]}」`), p.text ? `：${p.text}` : '') : null;
    }),
  ].filter(Boolean);
  sheet(
    '秘書的建議',
    note || null,
    [
      ['同意，幫我設定', act.agree],
      ['再改一下', act.again, 'ghost'],
      ['取消', null, 'ghost'],
    ],
    [h('ul', { class: 'plan' }, rows), h('p', {}, '同意後會把拼圖放好，但光球先不會開啟，你看過再開。')],
    true,
  );
}
