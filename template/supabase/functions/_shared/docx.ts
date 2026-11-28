// Plain text out of a Word .docx file, without any library: a .docx is a zip whose
// word/document.xml holds the paragraphs. Only text is read; pictures and layout are ignored.
// Works in Deno and Node 18+ (DecompressionStream).
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** The bytes of one file in a zip, or null. Reads the central directory, so data descriptors are fine. */
async function unzip(zip: Uint8Array, name: string, maxOut: number) {
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 66000); i--)
    if (u32(zip, i) === 0x06054b50) { end = i; break; }
  if (end < 0) return null;
  let at = u32(zip, end + 16);
  for (let n = u16(zip, end + 10); n > 0 && at + 46 <= zip.length && u32(zip, at) === 0x02014b50; n--) {
    const method = u16(zip, at + 10), size = u32(zip, at + 20), full = u32(zip, at + 24);
    const nameLen = u16(zip, at + 28), local = u32(zip, at + 42);
    const file = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLen));
    if (file === name) {
      if (full > maxOut || local + 30 > zip.length) return null;
      const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) return null;
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    at += 46 + nameLen + u16(zip, at + 30) + u16(zip, at + 32);
  }
  return null;
}

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Paragraph text of a WordprocessingML document. */
export function wordXmlText(xml: string) {
  return xml
    .replace(/<w:(tab)\b[^>]*\/>/g, ' ')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITY[e])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** Text of a .docx, or '' when it is not one (or is too large to read). */
export async function docxText(bytes: Uint8Array) {
  const xml = await unzip(bytes, 'word/document.xml', 8_000_000).catch(() => null);
  return xml ? wordXmlText(new TextDecoder('utf-8').decode(xml)) : '';
}
