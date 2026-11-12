// Owner onboarding: after binding, ask what the secretary should help with and show
// the closest example. Also the template catalogue shown on the settings pages.
// Fixed copy only, so onboarding never calls the paid AI.

export const BRAND = { accent: '#E7C5A8', ink: '#4A3B32', paper: '#FAF7F2' };
export const MONTHLY_FEE = 'NT$370';

export type Example = {
  id: string;
  label: string;
  keywords: string[];
  chat: [string, string];
  benefit: string;
  fee: string;
};

export const EXAMPLES: Example[] = [
  {
    id: 'schedule',
    label: '記事與行程',
    keywords: ['記事', '行程', '提醒', '約', '開會', '日程', '行事曆', '記住'],
    chat: ['明天下午 3 點看牙醫', '📅 已記下：明天 15:00 看牙醫。要在前一小時提醒你嗎？'],
    benefit:
      'AI 記事最方便的是：你只要在官方帳號、甚至跟朋友的對話群組裡聊天，事情和帳務就會自動記下來，不用另外開 App。',
    fee: `每月 ${MONTHLY_FEE}，讓秘書幫你記住每一個約，不再漏掉重要行程。`,
  },
  {
    id: 'expense',
    label: '記帳',
    keywords: ['記帳', '帳', '花', '錢', '支出', '收入', '元', '費用'],
    chat: ['午餐 120', '💰 已記帳：餐飲 120 元。本月餐飲累計 2,340 元。'],
    benefit: '聊天就是記帳：在官方帳號或朋友群組裡隨口一句，帳務就自動整理好。',
    fee: `每月 ${MONTHLY_FEE}，一天不到 13 元，每一筆花費都幫你算清楚。`,
  },
  {
    id: 'todo',
    label: '待辦與提醒',
    keywords: ['待辦', '要做', '任務', '工作', '清單', '目標', '截止'],
    chat: ['週五前交報價單', '✅ 已加入待辦：週五前交報價單。週四晚上提醒你。'],
    benefit: '不用打開清單 App，在 LINE 說一句，待辦就排好，時間到自動提醒。',
    fee: `每月 ${MONTHLY_FEE}，把腦中的待辦交給秘書，專心做重要的事。`,
  },
  {
    id: 'health',
    label: '健康紀錄',
    keywords: ['健康', '血壓', '血糖', '吃藥', '體重', '長輩', '量', '看健'],
    chat: ['血壓 128/82', '🩺 已記錄：血壓 128/82。週日會整理成健康週報給你和家人。'],
    benefit: '量完說一句就記好，每週自動整理健康週報，家人也能一起關心。',
    fee: `每月 ${MONTHLY_FEE}，讓家人安心，健康變化一目了然。`,
  },
  {
    id: 'interface',
    label: '設計官方帳號',
    keywords: ['介面', '選單', '設計', '版面', '顏色', '卡片', '官方帳號'],
    chat: [
      '修改：選單改成 3 格，加一格預約',
      '🎨 我會把選單改成 3 格並新增「預約」，回覆「套用」就生效。',
    ],
    benefit: '不用學後台，用說的就能改官方帳號的選單、卡片和顏色。',
    fee: `每月 ${MONTHLY_FEE}，官方帳號隨時用說的就能改版。`,
  },
];

/** Pick the example closest to what the owner said; falls back to the first one. */
export function matchExample(text: string): Example {
  const t = text.trim();
  let best = EXAMPLES[0],
    score = 0;
  for (const ex of EXAMPLES) {
    // A quick-reply answer contains the exact label, which must win over shared keywords.
    const s =
      (t.includes(ex.label) ? 100 : 0) +
      ex.keywords.reduce((n, k) => n + (t.includes(k) ? k.length : 0), 0);
    if (s > score) [best, score] = [ex, s];
  }
  return best;
}

export function exampleById(id: string) {
  return EXAMPLES.find((e) => e.id === id) ?? null;
}

/** First card after binding: ask what the secretary should do, with one-tap answers. */
export function askCard() {
  return {
    type: 'flex',
    altText: '你希望我幫你做什麼事情呢？',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        contents: [{ type: 'text', text: '你的 AI 秘書已就位', weight: 'bold', color: BRAND.ink }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: '你希望我幫你做什麼事情呢？',
            weight: 'bold',
            size: 'lg',
            wrap: true,
          },
          {
            type: 'text',
            text: '點下方的選項，或直接打字告訴我。',
            size: 'sm',
            color: '#7A6A60',
            wrap: true,
          },
        ],
      },
    },
    quickReply: {
      items: EXAMPLES.map((e) => ({
        type: 'action',
        action: { type: 'message', label: e.label, text: `我希望你幫我${e.label}` },
      })),
    },
  };
}

const bubble = (text: string, mine: boolean) => ({
  type: 'box',
  layout: 'vertical',
  backgroundColor: mine ? '#EFE6DC' : '#FFFFFF',
  cornerRadius: '12px',
  paddingAll: '10px',
  contents: [{ type: 'text', text, wrap: true, size: 'sm', align: mine ? 'end' : 'start' }],
});

/** Screenshot of the matching ready-made LIFF app, served from the app's GitHub Pages. */
export const exampleImage = (pagesUrl: string, id: string) =>
  pagesUrl ? `${pagesUrl.replace(/\/?$/, '/')}assets/examples/${id}.jpg` : '';

/** Example card for one use case, ending with a button to the settings page. */
export function exampleCard(ex: Example, settingsUrl: string, pagesUrl = '') {
  const image = exampleImage(pagesUrl, ex.id);
  return {
    type: 'flex',
    altText: `${ex.label}的使用範例`,
    contents: {
      type: 'bubble',
      ...(image
        ? {
            hero: {
              type: 'image',
              url: image,
              size: 'full',
              aspectRatio: '3:4',
              aspectMode: 'cover',
            },
          }
        : {}),
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        contents: [{ type: 'text', text: `範例：${ex.label}`, weight: 'bold', color: BRAND.ink }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        backgroundColor: BRAND.paper,
        contents: [
          bubble(ex.chat[0], true),
          bubble(ex.chat[1], false),
          { type: 'separator' },
          { type: 'text', text: ex.benefit, wrap: true, size: 'sm', color: BRAND.ink },
        ],
      },
      footer: settingsUrl
        ? {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: BRAND.ink,
                action: { type: 'uri', label: '設定我的 AI 秘書', uri: settingsUrl },
              },
            ],
          }
        : undefined,
    },
  };
}

export const SECRETARY_TEMPLATES = EXAMPLES.filter((e) => e.id !== 'interface').map((e) => ({
  id: e.id,
  label: e.label,
  command: `修改：開啟${e.label}秘書`,
}));

export const INTERFACE_TEMPLATES = [
  {
    id: 'shop',
    label: '店家',
    detail: '關於我們、營業時間、預約、聯絡我們',
    command: '修改：選單改成店家版',
  },
  {
    id: 'brand',
    label: '個人品牌',
    detail: '作品、服務項目、預約、聯絡我們',
    command: '修改：選單改成個人品牌版',
  },
  {
    id: 'course',
    label: '課程',
    detail: '課程介紹、報名、常見問題、聯絡我們',
    command: '修改：選單改成課程版',
  },
];

export const TUTORIAL = [
  '回到聊天室，傳出下方的設定句子（可以直接按「送出」）。',
  '秘書會回覆修改內容與這次使用的額度。',
  '確認沒問題，回覆「套用」就完成。',
];

/** Every secretary reply is a small branded card instead of plain text. */
export const DEFAULT_SUBSCRIBE_URL = 'https://liff.line.me/2012197506-Vmb4O5iT/build.html';

/** Shown when the month's quota, the free NT$20 extra and any top-up are all used. */
export function quotaCard(subscribeUrl: string) {
  return noticeCard(
    '本月額度已用完',
    '本月額度和每月贈送的 NT$20 加值都用完了。加值 NT$30–50 就能馬上繼續使用；不加值的話，下個月額度會自動恢復。',
    { label: '加值額度', uri: subscribeUrl || DEFAULT_SUBSCRIBE_URL },
  );
}

export function noticeCard(title: string, body: string, button?: { label: string; uri: string }) {
  return {
    type: 'flex',
    altText: `${title}：${body}`.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'kilo',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.accent,
        paddingAll: '12px',
        contents: [{ type: 'text', text: title, weight: 'bold', color: BRAND.ink }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: BRAND.paper,
        contents: [
          { type: 'text', text: body.slice(0, 2000), wrap: true, size: 'sm', color: BRAND.ink },
        ],
      },
      ...(button
        ? {
            footer: {
              type: 'box',
              layout: 'vertical',
              contents: [
                {
                  type: 'button',
                  style: 'primary',
                  color: BRAND.ink,
                  height: 'sm',
                  action: { type: 'uri', label: button.label.slice(0, 20), uri: button.uri },
                },
              ],
            },
          }
        : {}),
    },
  };
}
