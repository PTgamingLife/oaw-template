// 介面設計中心 (領航者版, ?view=design): the owner talks to the AI, a draft of the settings
// changes on screen, and nothing goes live until 套用並發布. The AI returns a full settings
// object (never code); it is validated here before the page ever sees it.
import { THEMES, validateConfig, type Config } from './logic.ts';
import { decodeJpeg, keepPictures, MAX_PHOTO } from './design-model.ts';
export { decodeJpeg, jpegSize } from './design-model.ts';
import { apricoKey, db, env, IMAGE_BASE, IMAGE_BUCKET, loadConfig } from './store.ts';

const MAX_PHOTOS = 20;

/** Store one picture in this OA app's own bucket (made on first use). Returns its file name. */
export async function designUpload(b64: unknown) {
  const bytes = decodeJpeg(b64);
  const made = await db.storage.createBucket(IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_PHOTO,
    allowedMimeTypes: ['image/jpeg'],
  });
  if (made.error && !/exist/i.test(made.error.message)) throw Error('photo_store_failed');
  const bucket = db.storage.from(IMAGE_BUCKET);
  const { data: files } = await bucket.list('', { limit: 100 });
  if ((files?.length ?? 0) >= MAX_PHOTOS) {
    // Make room: drop pictures the live settings no longer use (drafts older than a day).
    const live = await loadConfig();
    const used = new Set([live.card.hero, ...live.cells.map((c) => c.img)]);
    const stale = files!
      .filter((f) => !used.has(f.name) && Date.now() - new Date(f.created_at ?? 0).getTime() > 86400000)
      .map((f) => f.name);
    if (stale.length) await bucket.remove(stale);
    if (files!.length - stale.length >= MAX_PHOTOS) throw Error('photos_full');
  }
  const name = `${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}.jpg`;
  const { error } = await bucket.upload(name, bytes, { contentType: 'image/jpeg', cacheControl: '31536000' });
  if (error) throw Error('photo_store_failed');
  return { name };
}

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
    next = validateConfig(keepPictures(data.config, config));
  } catch {
    throw Error('design_failed');
  }
  return { config: next, summary: data.summary.slice(0, 300) };
}

export async function designOpen() {
  return { config: await loadConfig(), themes: THEMES, imageBase: IMAGE_BASE };
}
