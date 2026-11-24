import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateConfig, cellMessage } from '../template/supabase/functions/_shared/logic.ts';
import { keepPictures, decodeJpeg, jpegSize } from '../template/supabase/functions/_shared/design-model.ts';

const base = validateConfig(JSON.parse(readFileSync('oaw/config.json', 'utf8')));
const PIC = 'abcdef0123456789.jpg';
const withCard = (card: object, cell: object = {}) =>
  validateConfig({
    ...base,
    card: { ...base.card, ...card },
    cells: base.cells.map((c, i) => (i === 1 ? { ...c, label: '菜單', content: '桂花拿鐵', format: 'card', ...cell } : c)),
  });

test('old settings get the default card look and no pictures', () => {
  assert.deepEqual(base.card, { head: 'band', size: 'mega', hero: '' });
  assert.ok(base.cells.every((c) => c.img === ''));
});

test('card look and picture names are validated', () => {
  assert.throws(() => withCard({ head: 'fancy' }), /invalid_card/);
  assert.throws(() => withCard({ size: 'huge' }), /invalid_card/);
  assert.throws(() => withCard({ hero: '../secret.jpg' }), /invalid_card_hero/);
  assert.throws(() => withCard({}, { img: 'https://evil.example/x.jpg' }), /invalid_cell_img/);
  assert.equal(withCard({}, { img: PIC }).cells[1].img, PIC);
});

test('cards follow the look: band, plain, and picture with a fallback', () => {
  const band = (cellMessage(withCard({}), 1) as any).contents;
  assert.ok(band.header && !band.hero);
  assert.equal(band.size, 'mega');
  const plain = (cellMessage(withCard({ head: 'plain', size: 'kilo' }), 1) as any).contents;
  assert.ok(!plain.header && !plain.hero);
  assert.equal(plain.size, 'kilo');
  assert.deepEqual(plain.body.contents.map((c: any) => c.text), ['菜單', '桂花拿鐵']);
  const pic = (cellMessage(withCard({ head: 'image', hero: PIC }), 1, 'https://x.supabase.co/p/') as any).contents;
  assert.equal(pic.hero.url, 'https://x.supabase.co/p/' + PIC);
  assert.ok(!pic.header);
  // No picture yet (or no bucket URL): the colour band is used instead of an empty card top.
  assert.ok((cellMessage(withCard({ head: 'image' }), 1, 'https://x/') as any).contents.header);
  assert.ok((cellMessage(withCard({ head: 'image', hero: PIC }), 1) as any).contents.header);
});

test('the AI can change the card look but never the pictures', () => {
  const draft = withCard({ hero: PIC, head: 'image' }, { img: PIC });
  const ai = {
    ...draft,
    card: { head: 'plain', size: 'giga', hero: 'zzzzzzzzzzzzzzzz.jpg' },
    cells: draft.cells.map((c) => ({ ...c, img: 'zzzzzzzzzzzzzzzz.jpg' })),
  };
  const kept = validateConfig(keepPictures(ai, draft));
  assert.deepEqual(kept.card, { head: 'plain', size: 'giga', hero: PIC });
  assert.equal(kept.cells[1].img, PIC);
  assert.equal(kept.cells[0].img, '');
  // An older Aprico that returns no card leaves the look as it was.
  const { card: _, ...old } = ai;
  assert.deepEqual(validateConfig(keepPictures(old, draft)).card, draft.card);
  assert.throws(() => validateConfig(keepPictures({ ...ai, cells: 'x' }, draft)));
});

test('pictures must be real JPEGs within the size limit', () => {
  const jpeg = new Uint8Array(200);
  jpeg.set([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 810 >> 8, 810 & 255, 1200 >> 8, 1200 & 255]);
  const b64 = Buffer.from(jpeg).toString('base64');
  assert.deepEqual(jpegSize(decodeJpeg(b64)), { width: 1200, height: 810 });
  assert.throws(() => decodeJpeg(Buffer.from('<svg onload=alert(1)>'.padEnd(200)).toString('base64')), /photo_invalid/);
  assert.throws(() => decodeJpeg('not base64 !!'), /photo_invalid/);
  assert.throws(() => decodeJpeg(Buffer.alloc(700000, 0xff).toString('base64')), /photo_invalid/);
  assert.equal(jpegSize(new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), null);
});
