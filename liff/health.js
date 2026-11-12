// 個人健康 AI 秘書: four tabs (今天 / 看健 / 行事曆 / 家人與設定) plus a one-time consent card.
// Opened as ?view=health[&tab=scan|calendar|family]. ?mock=1 on localhost uses sample data.
const DISCLAIMER = '僅供紀錄參考，請諮詢醫師；緊急狀況請撥 119。';
const TABS = [
  ['today', '今天'],
  ['scan', '看健'],
  ['calendar', '行事曆'],
  ['family', '家人與設定'],
];

let h, show, call, S, tab;

const fmt = (iso) =>
  iso
    ? new Date(iso).toLocaleString('zh-TW', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
const button = (label, onclick, cls = 'btn brand') =>
  h('button', { class: cls, type: 'button', onclick }, label);
const input = (attrs) => h('input', { class: 'field', ...attrs });
const toast = (msg) => {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
};
async function run(action, extra) {
  try {
    const next = await call(action, extra);
    if (next?.role) S = next;
    return next;
  } catch (e) {
    toast(
      {
        points_insufficient: '本月額度已用完',
        rate_limited: '太頻繁了，請一分鐘後再試',
        measure_invalid: '數值看起來不太對，請再確認',
        aprico_not_connected: 'AI 秘書尚未連接',
      }[e.message] || '暫時無法完成，請稍後再試',
    );
    return null;
  }
}

function consentCard() {
  const share = input({ type: 'checkbox', id: 'share', checked: '' });
  return h(
    'section',
    { class: 'card consent' },
    h('h2', {}, '開始之前'),
    h('p', {}, '這裡會記錄你的血壓、血糖、體重、吃藥與看健結果，資料只存在你自己的資料庫。'),
    h('p', { class: 'muted' }, DISCLAIMER),
    h('label', { class: 'check' }, share, h('span', {}, '同意把紀錄與提醒分享給我同意的家人')),
    button('我同意，開始使用', () =>
      run('h_consent', { agree: true, share: share.checked }).then(render),
    ),
  );
}

// ---- 今天 ----
const MEASURES = {
  bp: {
    label: '血壓',
    fields: [
      ['v1', '收縮壓'],
      ['v2', '舒張壓'],
      ['v3', '心跳（可不填）'],
    ],
  },
  glucose: { label: '血糖', fields: [['v1', '血糖值']] },
  weight: { label: '體重', fields: [['v1', '公斤']] },
};
function measureForm() {
  let kind = 'bp',
    tag = 'fasting';
  const box = h('div', { class: 'measure-fields' });
  const draw = () => {
    box.replaceChildren(
      ...[
        ...MEASURES[kind].fields.map(([k, ph]) =>
          input({ name: k, placeholder: ph, inputmode: 'decimal' }),
        ),
        kind === 'glucose'
          ? h(
              'div',
              { class: 'seg' },
              ...[
                ['fasting', '飯前'],
                ['after', '飯後'],
              ].map(([v, l]) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: v === tag ? 'on' : '',
                    onclick: () => ((tag = v), draw()),
                  },
                  l,
                ),
              ),
            )
          : null,
      ].filter(Boolean),
    );
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
  };
  const seg = h(
    'div',
    { class: 'seg' },
    ...Object.entries(MEASURES).map(([k, m]) =>
      h('button', { type: 'button', 'data-k': k, onclick: () => ((kind = k), draw()) }, m.label),
    ),
  );
  draw();
  const save = button('記錄', async () => {
    const v = Object.fromEntries([...box.querySelectorAll('input')].map((i) => [i.name, i.value]));
    const r = await run('h_measure', { measure: { kind, tag, ...v } });
    if (!r) return;
    toast(r.flagged ? `已記錄・${r.flagged}` : `已記錄：${r.saved}`);
    await run('h_state');
    render();
  });
  return h('details', { class: 'card' }, h('summary', {}, '＋ 記錄量測'), seg, box, save);
}
const latestLine = (label, d, text) =>
  h(
    'div',
    { class: 'stat' + (d?.flagged ? ' warn' : '') },
    h('span', {}, label),
    h('strong', {}, d ? text(d) : '—'),
    h('small', {}, d ? fmt(d.measured_at) : ''),
  );
function today() {
  if (!S.today) return [h('p', { class: 'muted' }, '長輩尚未開啟分享。')];
  const owner = S.role === 'owner';
  return [
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '今日提醒'),
      ...(S.today.length
        ? S.today.map((r) =>
            h(
              'label',
              { class: 'check' + (r.done ? ' done' : '') },
              h('input', {
                type: 'checkbox',
                ...(r.done ? { checked: '', disabled: '' } : {}),
                ...(owner ? {} : { disabled: '' }),
                onchange: () => run('h_done', { slot: r.slot }).then(render),
              }),
              h('span', {}, `${r.time}　${r.label}`),
            ),
          )
        : [h('p', { class: 'muted' }, '還沒有設定提醒。')]),
    ),
    owner ? measureForm() : null,
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '最近一次'),
      latestLine('血壓', S.latest.bp, (d) => `${d.v1}/${d.v2}${d.v3 ? `・${d.v3}` : ''}`),
      latestLine('血糖', S.latest.glucose, (d) => `${d.v1}${d.tag === 'after' ? '（飯後）' : ''}`),
      latestLine('體重', S.latest.weight, (d) => `${d.v1} kg`),
      latestLine(
        '看健',
        S.scan && { measured_at: S.scan.at },
        () => `${S.scan.total} 分・${S.scan.constitution}`,
      ),
    ),
    h('p', { class: 'muted small' }, DISCLAIMER),
  ];
}

// ---- 看健 ----
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1024 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), {
    width: img.width * scale,
    height: img.height * scale,
  });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return { type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] };
}
function picker(label, hint, slot) {
  const preview = h('div', { class: 'shot-slot' }, h('span', {}, label), h('small', {}, hint));
  const file = input({ type: 'file', accept: 'image/*', capture: 'user', hidden: '' });
  file.addEventListener('change', async () => {
    if (!file.files[0]) return;
    slot.photo = await shrink(file.files[0]);
    preview.replaceChildren(
      h('img', { src: `data:image/jpeg;base64,${slot.photo.data}`, alt: label }),
    );
  });
  preview.addEventListener('click', () => file.click());
  return h('div', {}, preview, file);
}
function reportView(r) {
  const list = (title, items, line) =>
    h('section', { class: 'card' }, h('h3', {}, title), ...items.map((x) => h('p', {}, line(x))));
  return [
    h(
      'section',
      { class: 'card score' },
      h('div', { class: 'big' }, String(r.score.total)),
      h('div', {}, h('strong', {}, r.constitution.type), h('p', {}, r.constitution.description)),
      h(
        'div',
        { class: 'bars' },
        ...[
          ['面', 'face'],
          ['舌', 'tongue'],
          ['眼', 'eye'],
        ].map(([l, k]) => h('span', {}, `${l} ${r.score.breakdown[k]}`)),
      ),
    ),
    list('調養重點', r.focus, (f) => `${f.issue}：${f.advice}`),
    list('建議多吃', r.dietAdvice.eat, (f) => `${f.food}：${f.reason}`),
    list('穴位保健', r.acupoints, (a) => `${a.name}（${a.location}）${a.effect}`),
    list('作息', r.lifestyle, (t) => t),
    h('p', { class: 'muted small' }, '本分析為中醫養生參考，不構成醫療診斷。' + DISCLAIMER),
  ];
}
function scanTab() {
  if (S.role !== 'owner') return [h('p', { class: 'muted' }, '看健只有長輩本人可以使用。')];
  const face = {},
    tongue = {};
  const status = h(
    'p',
    { class: 'muted' },
    '一次分析約 30 秒，會扣本月額度。照片只用來分析，不會保存。',
  );
  const go = button('開始分析', async () => {
    if (!face.photo || !tongue.photo) return toast('請先拍兩張照片');
    go.disabled = true;
    status.textContent = '分析中，請稍候…';
    const r = await run('h_scan', { face: face.photo, tongue: tongue.photo });
    go.disabled = false;
    if (r?.report) show(header(), ...reportView(r.report), button('再拍一次', render, 'btn'));
    else status.textContent = '這次沒有完成，額度不會被扣。';
  });
  return [
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '拍兩張照片'),
      h(
        'div',
        { class: 'shots' },
        picker('① 臉部', '正面、自然光、不化妝', face),
        picker('② 舌頭', '伸出舌頭、光線充足', tongue),
      ),
      status,
      go,
    ),
  ];
}

// ---- 行事曆 ----
function calendar() {
  const [y, m] = S.day.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = {};
  for (const e of S.events) byDay[e.day] = true;
  const cells = [
    ...['日', '一', '二', '三', '四', '五', '六'].map((d) => h('b', {}, d)),
    ...Array.from({ length: first }, () => h('span', {})),
    ...Array.from({ length: days }, (_, i) => {
      const d = `${S.day.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
      return h(
        'span',
        { class: (d === S.day ? 'today ' : '') + (byDay[d] ? 'has' : '') },
        String(i + 1),
      );
    }),
  ];
  const day = input({ type: 'date', value: S.day }),
    time = input({ type: 'time' }),
    title = input({ placeholder: '例如：回診、量血壓' });
  return [
    h(
      'section',
      { class: 'card' },
      h('h2', {}, `${y} 年 ${m} 月`),
      h('div', { class: 'month' }, ...cells),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '行程'),
      ...(S.events.length
        ? S.events.map((e) =>
            h(
              'div',
              { class: 'event' },
              h('span', {}, `${e.day.slice(5)} ${e.time}`),
              h('strong', {}, e.title),
              button('刪除', () => run('h_event_del', { id: e.id }).then(render), 'link'),
            ),
          )
        : [h('p', { class: 'muted' }, '這個月還沒有行程。')]),
    ),
    h(
      'details',
      { class: 'card' },
      h('summary', {}, '＋ 新增行程'),
      day,
      time,
      title,
      button('新增', () =>
        run('h_event_add', { day: day.value, time: time.value, title: title.value }).then(render),
      ),
    ),
    h('p', { class: 'muted small' }, '前一天晚上會提醒長輩與家人。'),
  ];
}

// ---- 家人與設定 ----
function family() {
  if (S.role !== 'owner') return [h('p', { class: 'muted' }, '只有長輩本人可以調整設定。')];
  const code = h('div', { class: 'cmd' }, '按下方按鈕產生邀請碼');
  const T = S.thresholds;
  const num = (k, label) =>
    h(
      'label',
      { class: 'row' },
      h('span', {}, label),
      input({ name: k, value: T[k], inputmode: 'numeric' }),
    );
  const ranges = h(
    'div',
    {},
    num('sysHigh', '收縮壓 ≥'),
    num('sysLow', '收縮壓 ≤'),
    num('diaHigh', '舒張壓 ≥'),
    num('diaLow', '舒張壓 ≤'),
    num('gluHigh', '飯前血糖 ≥'),
    num('gluLow', '血糖 ≤'),
  );
  const rem = h(
    'div',
    {},
    ...S.reminders.map((r) =>
      h(
        'div',
        { class: 'row rem' },
        input({ type: 'time', value: r.time, name: 'time' }),
        input({ value: r.label, name: 'label', 'data-kind': r.kind }),
      ),
    ),
  );
  const doSave = () => {
    const thresholds = Object.fromEntries(
      [...ranges.querySelectorAll('input')].map((i) => [i.name, Number(i.value)]),
    );
    const reminders = [...rem.querySelectorAll('.rem')].map((row) => {
      const [t, l] = row.querySelectorAll('input');
      return { time: t.value, label: l.value, kind: l.dataset.kind };
    });
    run('h_settings', { thresholds, reminders }).then(() => (toast('已儲存'), render()));
  };
  const save = () => button('儲存設定', doSave);
  const toggle = (c, k, label) =>
    h(
      'label',
      { class: 'chip-check' },
      h('input', {
        type: 'checkbox',
        ...(c.notify[k] ? { checked: '' } : {}),
        onchange: (e) =>
          run('h_caregiver', { id: c.id, notify: { ...c.notify, [k]: e.target.checked } }),
      }),
      label,
    );
  return [
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '家人'),
      S.share ? null : h('p', { class: 'warn-text' }, '目前沒有開啟分享，家人不會收到通知。'),
      ...(S.caregivers.length
        ? S.caregivers.map((c) =>
            h(
              'div',
              { class: 'family' },
              h('strong', {}, c.name),
              c.status === 'pending'
                ? button('同意加入', () =>
                    run('h_caregiver', { id: c.id, approve: true }).then(render),
                  )
                : h(
                    'div',
                    { class: 'chips' },
                    toggle(c, 'alert', '異常'),
                    toggle(c, 'missed', '沒回應'),
                    toggle(c, 'weekly', '週報'),
                  ),
              button(
                '解除',
                () => run('h_caregiver', { id: c.id, remove: true }).then(render),
                'link',
              ),
            ),
          )
        : [h('p', { class: 'muted' }, '還沒有家人加入。')]),
      code,
      button(
        '產生邀請碼（24 小時內有效）',
        async () => {
          const r = await run('h_invite');
          if (r) code.textContent = `請家人加這個官方帳號好友，傳「${r.text}」`;
        },
        'btn',
      ),
    ),
    h('details', { class: 'card' }, h('summary', {}, '提醒時間'), rem, save()),
    h('details', { class: 'card' }, h('summary', {}, '異常範圍'), ranges, save()),
  ];
}

const header = () =>
  h(
    'nav',
    { class: 'tabs' },
    ...TABS.map(([k, l]) =>
      h(
        'a',
        {
          href: `?view=health&tab=${k}${location.search.includes('mock=1') ? '&mock=1' : ''}`,
          class: k === tab ? 'on' : '',
        },
        l,
      ),
    ),
  );

function render() {
  if (S.role === 'owner' && !S.consent) return show(consentCard());
  const body = { today, scan: scanTab, calendar, family }[tab] ?? today;
  show(header(), ...body());
}

export async function healthView(deps, params) {
  ({ h, show, call } = deps);
  document.body.classList.add('brand', 'health');
  tab = params.get('tab') || 'today';
  try {
    S = await call('h_state');
  } catch (e) {
    if (e.message !== 'health_forbidden') throw e;
    return show(
      h(
        'section',
        { class: 'card consent' },
        h('h2', {}, '這是長輩的健康秘書'),
        h('p', {}, '想成為家人，請長輩在「家人與設定」產生邀請碼，再到聊天室傳「家人 邀請碼」。'),
      ),
    );
  }
  render();
}
