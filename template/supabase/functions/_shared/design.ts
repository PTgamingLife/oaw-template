// 介面設計中心 (領航者版, ?view=design): the owner talks to the AI, a draft of the settings
// changes on screen, and nothing goes live until 套用並發布. The AI returns a full settings
// object (never code); it is validated here before the page ever sees it.
import { THEMES, validateConfig, type Config } from './logic.ts';
import { apricoKey, env, loadConfig } from './store.ts';

/** Ask Aprico's /design for an updated draft. Throws points_insufficient / rate_limited / design_failed. */
export async function designChat(request: unknown, draft: unknown) {
  const text = typeof request === 'string' ? request.trim() : '';
  if (!text || text.length > 500) throw Error('invalid_request');
  const config = validateConfig(draft);
  const base = env('APRICO_URL'),
    key = await apricoKey();
  if (!base || !key) throw Error('aprico_not_connected');
  const res = await fetch(`${base}/design`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: `design-${crypto.randomUUID()}`, request: text, config }),
    signal: AbortSignal.timeout(60000),
  }).catch(() => null);
  if (res?.status === 402) throw Error('points_insufficient');
  if (res?.status === 429) throw Error('rate_limited');
  const data = res?.ok ? await res.json().catch(() => null) : null;
  if (!data?.config || typeof data.summary !== 'string') throw Error('design_failed');
  let next: Config;
  try {
    next = validateConfig(data.config);
  } catch {
    throw Error('design_failed');
  }
  return { config: next, summary: data.summary.slice(0, 300) };
}

export async function designOpen() {
  return { config: await loadConfig(), themes: THEMES };
}
