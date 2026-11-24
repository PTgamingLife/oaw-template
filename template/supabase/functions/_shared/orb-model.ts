// 光球 (orbs): each orb is one conversation — the owner's 1:1 chat ('me') or one bound group —
// and holds puzzle pieces (fixed building blocks). The owner describes each piece in plain
// words; Aprico's AI turns the words into `params` (never code). This file is pure: shapes,
// validation, the default orb, local checks and the menu buttons. Testable with Node.

export const PIECE_TYPES = [
  'record',
  'organize',
  'command',
  'push',
  'remind',
  'stats',
  'announce',
  'answer',
] as const;
export type PieceType = (typeof PIECE_TYPES)[number];
export const PIECE_NAME: Record<PieceType, string> = {
  record: '紀錄',
  organize: '整理',
  command: '指令',
  push: '定時推播',
  remind: '提醒',
  stats: '統計',
  announce: '公告',
  answer: '回答',
};
export const VIEWS = ['calendar', 'list', 'summary', 'stats'] as const;

export type Piece = {
  id: number;
  type: PieceType;
  text: string;
  x: number;
  y: number;
  params: Record<string, unknown> | null;
};
export type Orb = {
  slot: number; // 1–3 are the owner's; 4 is a hidden orb received from a 領航者 account
  name: string;
  on: boolean;
  target: string; // '' | 'me' | LINE group id
  pieces: Piece[];
  links: [number, number][];
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hhmm = (v: unknown) =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : '';
const pick = <T extends string>(v: unknown, list: readonly T[], d: T) =>
  list.includes(v as T) ? (v as T) : d;
const frac = (v: unknown) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : 0.5);

/** Params per piece type, cleaned. Returns null when a required value is missing. */
export function cleanParams(type: PieceType, p: any): Record<string, unknown> | null {
  if (!p || typeof p !== 'object') return null;
  switch (type) {
    case 'record':
      return { topic: str(p.topic, 60) }; // '' = keep everything
    case 'organize':
      return { as: pick(p.as, VIEWS, 'calendar') };
    case 'command': {
      const word = str(p.word, 8).replace(/\s/g, '');
      return word ? { word, show: pick(p.show, VIEWS, 'calendar') } : null;
    }
    case 'push': {
      const time = hhmm(p.time);
      return time ? { time, show: pick(p.show, VIEWS, 'calendar') } : null;
    }
    case 'remind': {
      const time = hhmm(p.time);
      return time ? { time, day: pick(p.day, ['today', 'tomorrow'] as const, 'today') } : null;
    }
    case 'stats': {
      const subject = str(p.subject, 30);
      if (!subject) return null;
      const items = (Array.isArray(p.items) ? p.items : [])
        .map((i: any) => ({
          name: str(i?.name, 20),
          price: Number.isSafeInteger(i?.price) && i.price >= 0 && i.price <= 1000000 ? i.price : 0,
        }))
        .filter((i: { name: string }) => i.name)
        .slice(0, 30);
      return {
        subject,
        items,
        open: hhmm(p.open),
        close: hhmm(p.close),
        dedupe: pick(p.dedupe, ['last', 'sum'] as const, 'last'),
        names: p.names !== false,
        word: str(p.word, 8).replace(/\s/g, '') || '統計',
      };
    }
    case 'announce':
      return {};
    case 'answer': {
      const wake = str(p.wake, 8).replace(/\s/g, '');
      return wake ? { wake } : null;
    }
  }
}

/** Validate an orb coming from the page or the database. Throws `orb_invalid`. */
export function cleanOrb(v: any, slot: number, groups: string[]): Orb {
  if (!v || typeof v !== 'object') throw Error('orb_invalid');
  const target = v.target === 'me' || groups.includes(v.target) ? v.target : '';
  const seen = new Set<number>();
  const pieces: Piece[] = (Array.isArray(v.pieces) ? v.pieces : []).slice(0, 12).flatMap((p: any) => {
    if (!PIECE_TYPES.includes(p?.type) || !Number.isInteger(p?.id) || p.id < 1 || seen.has(p.id))
      return [];
    seen.add(p.id);
    return [
      {
        id: p.id,
        type: p.type,
        text: str(p.text, 200),
        x: frac(p.x),
        y: frac(p.y),
        params: p.params ? cleanParams(p.type, p.params) : null,
      },
    ];
  });
  if (pieces.filter((p) => p.type === 'command').length > 1) throw Error('orb_one_command');
  const links: [number, number][] = [];
  for (const l of Array.isArray(v.links) ? v.links : []) {
    const [a, b] = Array.isArray(l) ? l : [];
    if (a !== b && seen.has(a) && seen.has(b) && !links.some(([c, d]) => (c === a && d === b) || (c === b && d === a)))
      links.push([a, b]);
  }
  return {
    slot,
    name: str(v.name, 12) || `光球 ${slot}`,
    on: v.on === true,
    target,
    pieces,
    links: links.slice(0, 40),
  };
}

/** A new account starts with orb 1 lit: the owner's own calendar secretary. */
export function defaultOrbs(): Orb[] {
  const P = (id: number, type: PieceType, text: string, x: number, y: number, params: object): Piece => ({
    id,
    type,
    text,
    x,
    y,
    params: params as Record<string, unknown>,
  });
  return [
    {
      slot: 1,
      name: '光球 1',
      on: true,
      target: 'me',
      pieces: [
        P(1, 'record', '記下跟行程有關的內容', 0.2, 0.2, { topic: '行程' }),
        P(2, 'organize', '做成行事曆放在介面', 0.68, 0.2, { as: 'calendar' }),
        P(3, 'command', '輸入「行事曆」就跳出行事曆', 0.44, 0.5, { word: '行事曆', show: 'calendar' }),
        P(4, 'push', '每天 21:00 推播行事曆', 0.2, 0.8, { time: '21:00', show: 'calendar' }),
        P(5, 'remind', '早上 07:00 提醒當日行程', 0.7, 0.8, { time: '07:00', day: 'today' }),
      ],
      links: [
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
      ],
    },
    { slot: 2, name: '光球 2', on: false, target: '', pieces: [], links: [] },
    { slot: 3, name: '光球 3', on: false, target: '', pieces: [], links: [] },
  ];
}

export type Issue = { piece: number | null; code: string; text: string };

/** Checks that need no AI. An orb can only be lit when this returns []. */
export function localIssues(orb: Orb, others: Orb[]): Issue[] {
  const out: Issue[] = [];
  if (!orb.target) out.push({ piece: null, code: 'target', text: '這顆光球要用在哪個對話？請先選「對話對象」。' });
  else if (others.some((o) => o.slot !== orb.slot && o.target === orb.target))
    out.push({ piece: null, code: 'target_used', text: '這個對話已經被另一顆光球使用，一個對話只能對應一顆光球。' });
  if (!orb.pieces.length) out.push({ piece: null, code: 'empty', text: '平面上還沒有拼圖，請先放一片上來。' });
  for (const p of orb.pieces)
    if (!p.text) out.push({ piece: p.id, code: 'no_text', text: `「${PIECE_NAME[p.type]}」還沒有設定內容。你想讓它做什麼？` });
  const needs = orb.pieces.some((p) => ['organize', 'command', 'push', 'remind'].includes(p.type));
  if (needs && !orb.pieces.some((p) => p.type === 'record' || p.type === 'stats'))
    out.push({ piece: null, code: 'no_source', text: '整理、指令、推播、提醒都需要資料來源，但這裡沒有「紀錄」拼圖。' });
  if (orb.target === 'me' && orb.pieces.some((p) => p.type === 'announce' || p.type === 'stats'))
    out.push({ piece: null, code: 'group_only', text: '「公告」和「統計」要用在群組，請把對話對象改成群組。' });
  return out;
}

/** Ready to run: local checks pass and every piece has params from the AI. */
export const orbReady = (orb: Orb, others: Orb[]) =>
  !localIssues(orb, others).length && orb.pieces.every((p) => p.params);

/** LINE menu: 打開秘書 + one button per lit orb with a 「指令」 piece (slots 1–3). */
export function menuButtons(orbs: Orb[]) {
  return [1, 2, 3].map((slot) => {
    const orb = orbs.find((o) => o.slot === slot && o.on);
    const word = orb?.pieces.find((p) => p.type === 'command')?.params?.word;
    return typeof word === 'string' ? word : '';
  });
}

/** Pieces joined by links form one group of related functions. */
export function linkedGroups(orb: Orb): number[][] {
  const parent = new Map(orb.pieces.map((p) => [p.id, p.id]));
  const find = (a: number): number => (parent.get(a) === a ? a : find(parent.get(a)!));
  for (const [a, b] of orb.links) parent.set(find(a), find(b));
  const groups = new Map<number, number[]>();
  for (const p of orb.pieces) groups.set(find(p.id), [...(groups.get(find(p.id)) ?? []), p.id]);
  return [...groups.values()];
}
