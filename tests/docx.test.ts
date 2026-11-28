import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { docxText, wordXmlText } from '../template/supabase/functions/_shared/docx.ts';

// A minimal zip writer for the test: local header + data, then the central directory.
function zip(files: [string, Buffer, boolean][]) {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, raw, deflate] of files) {
    const data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(deflate ? 8 : 0, 8);
    h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
    local.push(h, n, data); central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, dir, end]));
}
const XML =
  '<?xml version="1.0"?><w:document><w:body>' +
  '<w:p><w:r><w:t>第一章 光合作用</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t xml:space="preserve">植物利用光能 &amp; 二氧化碳</w:t></w:r><w:r><w:tab/><w:t>製造葡萄糖</w:t></w:r></w:p>' +
  '<w:p><w:r><w:t>A &lt; B，&#20013;&#x6587;</w:t><w:br/><w:t>下一行</w:t></w:r></w:p>' +
  '</w:body></w:document>';

test('a .docx gives its paragraphs as text, compressed or stored', async () => {
  const want = '第一章 光合作用\n植物利用光能 & 二氧化碳 製造葡萄糖\nA < B，中文\n下一行\n';
  assert.equal(wordXmlText(XML), want);
  for (const deflate of [true, false])
    assert.equal(await docxText(zip([['[Content_Types].xml', Buffer.from('<x/>'), deflate], ['word/document.xml', Buffer.from(XML), deflate]])), want);
});

test('anything that is not a .docx reads as empty', async () => {
  assert.equal(await docxText(new TextEncoder().encode('just a text file, not a zip at all')), '');
  assert.equal(await docxText(zip([['other.xml', Buffer.from('<x/>'), true]])), '');
  assert.equal(await docxText(new Uint8Array(0)), '');
});
