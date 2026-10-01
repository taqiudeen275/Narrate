/** Source fidelity fixtures use a local DOM, never a browser or network. */
import assert from 'node:assert/strict';
import { DOMParser as LocalDOMParser } from 'linkedom';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseDocument } from '../src/core/parse';

// Linkedom parses HTML fragments literally; browser DOMParser adds html/body.
class FixtureDOMParser {
  parseFromString(source: string, type: string) {
    return new LocalDOMParser().parseFromString(
      type === 'text/html' && !/<html[\s>]/i.test(source) ? `<html><body>${source}</body></html>` : source,
      type as 'text/html',
    );
  }
}
Object.assign(globalThis, { DOMParser: FixtureDOMParser });
const enc = (text: string) => new TextEncoder().encode(text).buffer;
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
}

await check('RTF standard font tables do not swallow document prose', async () => {
  const doc = await parseDocument('fonts.rtf', enc(String.raw`{\rtf1\ansi{\fonttbl{\f0 Arial;}}\f0 Hello world.\par Second paragraph.}`));
  assert.equal(doc.plain, 'Hello world.\n\nSecond paragraph.');
});
await check('RTF Unicode fallback bytes and Windows punctuation retain source characters', async () => {
  const doc = await parseDocument('unicode.rtf', enc(String.raw`{\rtf1\ansi\ansicpg1252\uc1 caf\u233? \u8212\'97 \uc0\u945  \uc1\'93quoted\'94.}`));
  assert.equal(doc.plain, 'café — α “quoted”.');
});
await check('RTF starred destination groups are excluded without dropping following text', async () => {
  const doc = await parseDocument('groups.rtf', enc(String.raw`{\rtf1 Before. {\*\custom hidden metadata} After.}`));
  assert.equal(doc.plain, 'Before. After.');
});
await check('plain text headings preserve following lines without a blank separator', async () => {
  const doc = await parseDocument('heading.txt', enc('# Title\nFirst body sentence.\nSecond body line.'));
  assert.equal(doc.plain, 'Title\n\nFirst body sentence. Second body line.');
  assert.equal(doc.blocks[0].kind, 'heading');
  assert.equal(doc.blocks[1].kind, 'paragraph');
});
await check('HTML retains loose text around paragraphs in source order', async () => {
  const doc = await parseDocument('loose.html', enc('<html><body>Opening text.<p>Middle paragraph.</p>Closing text.</body></html>'));
  assert.equal(doc.plain, 'Opening text.\n\nMiddle paragraph.\n\nClosing text.');
});
await check('HTML mixed nested blocks retain inline content and omit hidden metadata', async () => {
  const doc = await parseDocument('nested.html', enc('<html><body><div>Lead <strong>bold</strong>.<section><h2>Heading</h2><p>Inside<br/>second line.</p></section>Tail.</div><script>hidden</script><p>Visible<script>secret</script> finish.</p><pre>line one\n  line two</pre></body></html>'));
  assert.equal(doc.plain, 'Lead bold.\n\nHeading\n\nInside second line.\n\nTail.\n\nVisible finish.\n\nline one\n  line two');
});
await check('HTML quoted paragraphs and nested list items keep word boundaries', async () => {
  const doc = await parseDocument('groups.html', enc('<html><body><blockquote><p>First quote.</p><p>Second quote.</p></blockquote><ul><li>Parent<ul><li>Child one.</li><li>Child two.</li></ul></li></ul></body></html>'));
  assert.equal(doc.plain, 'First quote. Second quote.\n\nParent Child one. Child two.');
});

function epub(href: string, chapterPath: string) {
  const zip = new JSZip();
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>');
  zip.file('OPS/package.opf', `<package><metadata><title>Test book</title></metadata><manifest><item id="chapter" href="${href}" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`);
  zip.file(chapterPath, '<html><body>Chapter opening.<p>Chapter body.</p></body></html>');
  return zip.generateAsync({ type: 'arraybuffer' });
}
await check('EPUB resolves parent paths, percent encoding and fragment identifiers', async () => {
  const doc = await parseDocument('paths.epub', await epub('../Text/chapter%201.xhtml#start', 'Text/chapter 1.xhtml'));
  assert.equal(doc.plain, 'Chapter opening.\n\nChapter body.');
});
await check('unknown binary inputs are rejected after source escape normalization', async () => {
  await assert.rejects(parseDocument('unknown.bin', new Uint8Array([0, 65, 66]).buffer), /not a document format/);
});

// Mammoth's production browser entry accepts ArrayBuffers. Bundle with the
// same browser mappings instead of testing its different Node Buffer API.
// PDF.js uses its compatible Node entry and actual worker; nothing is mocked.
const require = createRequire(import.meta.url);
const nativePdf = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
const standardFonts = require.resolve('pdfjs-dist/package.json').replace(/package\.json$/, 'standard_fonts/').replace(/\\/g, '/');
const browserBundle = await build({ entryPoints: ['src/core/parse.ts'], bundle: true, platform: 'browser',
  format: 'esm', write: false, logLevel: 'silent', plugins: [{ name: 'node-pdf-fixture', setup(builder) {
    builder.onResolve({ filter: /^pdfjs-dist$/ }, () => ({ path: 'pdf', namespace: 'node-pdf' }));
    builder.onLoad({ filter: /.*/, namespace: 'node-pdf' }, () => ({ contents:
      `import * as pdfjs from ${JSON.stringify(nativePdf)}; export const GlobalWorkerOptions = pdfjs.GlobalWorkerOptions;
       export const getDocument = options => pdfjs.getDocument({ ...options, standardFontDataUrl: ${JSON.stringify(standardFonts)} });` }));
    builder.onResolve({ filter: /^file:\/\// }, ({ path }) => ({ path, external: true }));
    builder.onResolve({ filter: /pdf\.worker\.min\.mjs\?url$/ }, () => ({ path: 'worker', namespace: 'pdf-worker' }));
    builder.onLoad({ filter: /.*/, namespace: 'pdf-worker' }, () => ({ contents: `export default ${JSON.stringify(
      pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')).href)}` }));
  } }] });
const browserParser: typeof import('../src/core/parse') = await import(
  `data:text/javascript;base64,${Buffer.from(browserBundle.outputFiles[0].contents).toString('base64')}`);

await check('genuine DOCX archive retains headings, styled runs, line breaks and table cells', async () => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter heading</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Opening </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> text.</w:t></w:r></w:p><w:p><w:r><w:t>Another line</w:t><w:br/><w:t>with a break.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Left cell.</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Right cell.</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/></w:body></w:document>');
  const doc = await browserParser.parseDocument('binary.docx', await zip.generateAsync({ type: 'arraybuffer' }));
  assert.equal(doc.title, 'Chapter heading');
  assert.equal(doc.plain, 'Chapter heading\n\nOpening bold text.\n\nAnother line with a break.\n\nLeft cell.\n\nRight cell.');
  assert.equal(doc.blocks[0].kind, 'heading');
  assert.equal(doc.sourceName, 'binary.docx');
});

function pdfFixture() {
  const stream = 'BT /F1 12 Tf 50 750 Td (First PDF line.) Tj 0 -18 Td (Second PDF line.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Title (PDF fixture title) >>'];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return enc(pdf);
}
await check('genuine PDF binary extracts prose and metadata through the real PDF.js worker', async () => {
  const doc = await browserParser.parseDocument('binary.pdf', pdfFixture());
  assert.equal(doc.title, 'PDF fixture title');
  assert.equal(doc.plain.replace(/\s+/g, ' '), 'First PDF line. Second PDF line.');
  assert.equal(doc.sourceName, 'binary.pdf');
  assert.equal(doc.words.length, 6);
});

console.log(failures ? `${failures} SOURCE CHECK(S) FAILED` : 'ALL SOURCE CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
