// Pure logic shared by the OA webhook and LIFF API. No Deno or network APIs here,
// so it can be unit-tested with Node (`npm test`).

export const THEMES = [
  ['#BDD0BE', '#DDD5BC', '#B9CCCF', '#D4C2B8'],
  ['#DDD0B8', '#C7B29E', '#EBE1CE', '#BFC2AF'],
  ['#B5CAD4', '#CCDADC', '#CEC9BD', '#A7BABE'],
  ['#D7B8B7', '#E2CCCC', '#C7B7C5', '#D8CDBC'],
  ['#C9C1D6', '#DCD5E4', '#BEC9D0', '#D3C6C2'],
  ['#E7C5A8', '#E8D6B6', '#D6C4B9', '#C9D0B4'],
  ['#A8BDCC', '#A9C9C5', '#C0D4D0', '#D4D3C4'],
  ['#C3C6C5', '#DCDDD9', '#B7BDBA', '#E7E5DE'],
];

export type Cell = {
  label: string;
  action: 'message' | 'full' | 'web';
  content: string;
  format?: 'text' | 'card';
};
export type Config = {
  oaName: string;
  grid: 4 | 6 | 8;
  theme: number;
  cells: Cell[];
  welcome: string;
  failure: string;
  secretary: boolean;
};

const str = (v: unknown, max: number, field: string) => {
  if (typeof v !== 'string' || v.length > max) throw Error('invalid_' + field);
  return v;
};

export function validateConfig(value: unknown): Config {
  const v = value as Config;
  if (!v || typeof v !== 'object') throw Error('invalid_config');
  if (![4, 6, 8].includes(v.grid)) throw Error('invalid_grid');
  if (!Number.isInteger(v.theme) || v.theme < 0 || v.theme >= THEMES.length)
    throw Error('invalid_theme');
  if (!Array.isArray(v.cells) || v.cells.length !== 8) throw Error('invalid_cells');
  const cells = v.cells.map((c) => {
    if (!c || !['message', 'full', 'web'].includes(c.action)) throw Error('invalid_cell');
    const content = str(c.content, 1000, 'cell_content');
    if (c.action === 'web' && content && !/^https:\/\/[^\s]+$/.test(content))
      throw Error('invalid_cell_url');
    if (c.format !== undefined && !['text', 'card'].includes(c.format))
      throw Error('invalid_cell_format');
    return {
      label: str(c.label, 20, 'cell_label'),
      action: c.action,
      content,
      format: c.format ?? 'text',
    };
  });
  return {
    oaName: str(v.oaName, 40, 'oa_name'),
    grid: v.grid,
    theme: v.theme,
    cells,
    welcome: str(v.welcome, 500, 'welcome'),
    failure: str(v.failure, 300, 'failure'),
    secretary: v.secretary === true,
  };
}

const b64 = (bytes: ArrayBuffer) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};

/** LINE webhook signature: base64(HMAC-SHA256(channelSecret, rawBody)). */
export async function verifySignature(secret: string, body: string, signature: string | null) {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type Intent =
  | { kind: 'bind'; code: string }
  | { kind: 'cell'; index: number }
  | { kind: 'apply' }
  | { kind: 'cancel' }
  | { kind: 'design'; request: string }
  | { kind: 'secretary' }
  | { kind: 'fallback' };

/** Decide what a text message means. Owner-only intents are ignored for other users. */
export function textIntent(text: string, config: Config, isOwner: boolean): Intent {
  const t = text.trim();
  if (/^\d{6}$/.test(t)) return { kind: 'bind', code: t };
  if (isOwner && t === '套用') return { kind: 'apply' };
  if (isOwner && t === '取消') return { kind: 'cancel' };
  const design = t.match(/^(?:設計|修改)[:：\s]\s*(.+)$/s);
  if (isOwner && design) return { kind: 'design', request: design[1].trim() };
  const index = config.cells.slice(0, config.grid).findIndex((c) => c.label && c.label === t);
  if (index >= 0) return { kind: 'cell', index };
  return config.secretary ? { kind: 'secretary' } : { kind: 'fallback' };
}

export function postbackCell(data: string, config: Config) {
  const m = /^cell=(\d)$/.exec(data);
  const index = m ? Number(m[1]) : -1;
  return index >= 0 && index < config.grid ? index : -1;
}

/** Reply message for a menu cell. */
export function cellMessage(config: Config, index: number) {
  const cell = config.cells[index];
  const text = cell.content || config.failure;
  if (cell.format !== 'card') return { type: 'text', text: text.slice(0, 5000) };
  const color = THEMES[config.theme][index % 4];
  return {
    type: 'flex',
    altText: (cell.label || config.oaName).slice(0, 400),
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: color,
        contents: [{ type: 'text', text: cell.label || config.oaName, weight: 'bold', size: 'lg' }],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [{ type: 'text', text, wrap: true }],
      },
    },
  };
}

export const MENU_SIZE = { width: 1200, height: 810 };

export function menuAreas(grid: number) {
  const columns = grid === 6 ? 3 : 2,
    rows = grid / columns,
    width = MENU_SIZE.width / columns;
  return Array.from({ length: grid }, (_, index) => {
    const row = Math.floor(index / columns),
      top = Math.floor((row * MENU_SIZE.height) / rows),
      bottom = Math.floor(((row + 1) * MENU_SIZE.height) / rows);
    return { index, bounds: { x: (index % columns) * width, y: top, width, height: bottom - top } };
  });
}

/** Rich menu definition. `liffUrl` is https://liff.line.me/{liffId}. */
export function richMenu(config: Config, px: string, liffUrl: string) {
  return {
    size: MENU_SIZE,
    selected: true,
    name: `${px}-main`,
    chatBarText: (config.oaName || '選單').slice(0, 14),
    areas: menuAreas(config.grid).map(({ index, bounds }) => {
      const cell = config.cells[index],
        label = (cell.label || `功能 ${index + 1}`).slice(0, 20);
      const action =
        cell.action === 'web' && cell.content
          ? { type: 'uri', label, uri: cell.content }
          : cell.action === 'full'
            ? { type: 'uri', label, uri: `${liffUrl}?cell=${index}` }
            : { type: 'postback', label, data: `cell=${index}`, displayText: label };
      return { bounds, action };
    }),
  };
}

/** Public part of the config sent to the LIFF page (no owner or internal data). */
export function publicConfig(config: Config) {
  return {
    oaName: config.oaName,
    grid: config.grid,
    theme: config.theme,
    colors: THEMES[config.theme],
    cells: config.cells.slice(0, config.grid),
  };
}
