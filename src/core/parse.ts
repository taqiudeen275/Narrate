/**
 * Document parsing.
 *
 * Every parser returns the same shape — a flat `plain` string plus block ranges
 * that index into it — and `indexDocument` turns that into the sentence and
 * word index. Offsets are therefore always absolute and always comparable, no
 * matter which format the text came from.
 *
 * This module is deliberately dependency-light and DOM-based so the browser
 * extension can run the exact same code as the desktop app.
 */

import type { Block, BlockKind } from './types';
import { indexDocument, type Doc } from './types';
import { marked } from 'marked';
import JSZip from 'jszip';

/* ---------------------------------------------------------------- builder ---- */

/**
 * Accumulates block text into one flat string while recording block ranges.
 *
 * The separator has to be added to the running length before the block's start
 * is recorded, and only when a block has already been written. Getting that
 * order wrong shifts every block by the separator width, which surfaces as
 * text repeated and truncated mid-word.
 */
export class DocBuilder {
  private parts: string[] = [];
  private blocks: Block[] = [];
  private len = 0;

  private push(kind: BlockKind, clean: string, level?: number): void {
    if (!clean) return;
    if (this.len > 0) {
      this.parts.push('\n\n');
      this.len += 2;
    }
    const start = this.len;
    this.parts.push(clean);
    this.len += clean.length;
    this.blocks.push({ kind, start, end: this.len, level });
  }

  add(kind: BlockKind, text: string, level?: number): void {
    this.push(kind, text.replace(/\s+/g, ' ').trim(), level);
  }

  addRaw(kind: BlockKind, text: string, level?: number): void {
    this.push(kind, text.trim(), level);
  }

  get plain(): string {
    return this.parts.join('');
  }

  build(title: string, sourceName?: string): Doc {
    const doc = indexDocument(this.plain, this.blocks, title);
    return sourceName ? { ...doc, sourceName } : doc;
  }
}

/* -------------------------------------------------------------------- dom ---- */

const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'NAV', 'HEAD', 'SVG', 'TEMPLATE']);
const HEADINGS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };
const DOM_BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR',
  'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION', 'TABLE', 'TBODY', 'THEAD', 'TR', 'TD', 'TH', 'DL', 'DT', 'DD']);

/** textContent includes scripts and joins both sides of a BR without a space. */
function readableText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? '';
  if (node.nodeType !== 1) return '';
  const tag = (node as Element).tagName.toUpperCase();
  if (SKIP.has(tag)) return '';
  if (tag === 'BR') return '\n';
  const text = Array.from(node.childNodes).map(readableText).join('');
  return DOM_BLOCKS.has(tag) || HEADINGS[tag] ? `\n${text}\n` : text;
}

function hasNestedBlock(node: Element): boolean {
  return Array.from(node.children).some(child => DOM_BLOCKS.has(child.tagName.toUpperCase()) ||
    !!HEADINGS[child.tagName.toUpperCase()] || hasNestedBlock(child));
}

/** Turn a DOM subtree into ordered blocks. Shared by docx, epub, and html. */
export function blocksFromDom(root: Element, b: DocBuilder, depth = 0): void {
  let inline = '';
  const flush = () => { b.add('paragraph', inline); inline = ''; };
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3) { inline += child.textContent ?? ''; continue; }
    if (child.nodeType !== 1) continue;
    const node = child as Element;
    const tag = node.tagName.toUpperCase();
    if (SKIP.has(tag)) continue;
    if (tag === 'BR') { inline += ' '; continue; }
    const level = HEADINGS[tag];
    if (level) {
      flush();
      b.add('heading', readableText(node), level);
      continue;
    }
    if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE') {
      flush();
      if (hasNestedBlock(node)) blocksFromDom(node, b, depth + 1);
      else b.add('paragraph', readableText(node));
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      flush();
      for (const li of Array.from(node.children)) {
        if (li.tagName.toUpperCase() === 'LI') b.add('listItem', readableText(li));
      }
      continue;
    }
    if (tag === 'BLOCKQUOTE') {
      flush();
      b.add('quote', readableText(node));
      continue;
    }
    if (tag === 'PRE') {
      flush();
      b.addRaw('code', readableText(node));
      continue;
    }
    if (tag === 'HR') {
      flush();
      b.add('paragraph', '— — —');
      continue;
    }
    if (DOM_BLOCKS.has(tag) || hasNestedBlock(node)) { flush(); blocksFromDom(node, b, depth + 1); }
    else inline += readableText(node);
  }
  flush();
}

function titleFromDom(doc: Document, fallback: string): string {
  const h1 = doc.querySelector('h1');
  const t = doc.querySelector('title');
  return (h1?.textContent || t?.textContent || fallback).trim().slice(0, 200) || fallback;
}

/* ---------------------------------------------------------------- parsers ---- */

function parsePlainText(text: string): Doc {
  const b = new DocBuilder();
  for (const para of text.split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t) continue;
    const heading = /^(#{1,6})[ \t]+([^\n]*)(?:\n([\s\S]*))?$/.exec(t);
    if (heading) {
      b.add('heading', heading[2], heading[1].length);
      if (heading[3]) b.add('paragraph', heading[3]);
    }
    else b.add('paragraph', t);
  }
  return b.build(firstLineTitle(text) ?? 'Document');
}

export function parseMarkdown(text: string, fileName: string): Doc {
  const tokens = marked.lexer(text, { gfm: true });
  const b = new DocBuilder();
  for (const tok of tokens) {
    const t = tok as { type: string; text?: string; depth?: number; tokens?: unknown[] };
    switch (t.type) {
      case 'heading':
        b.add('heading', stripInline(t.text ?? ''), t.depth ?? 1);
        break;
      case 'paragraph':
        b.add('paragraph', stripInline(t.text ?? ''));
        break;
      case 'blockquote':
        b.add('quote', stripInline(t.text ?? ''));
        break;
      case 'code':
        b.add('code', t.text ?? '');
        break;
      case 'space':
        break;
      case 'list': {
        for (const item of (tok as { items?: { text?: string }[] }).items ?? []) {
          b.add('listItem', stripInline(item.text ?? ''));
        }
        break;
      }
      case 'table': {
        const table = tok as { header?: { text: string }[]; rows?: { text: string }[][] };
        for (const row of [table.header ?? [], ...(table.rows ?? [])]) {
          b.add('paragraph', row.map((cell) => stripInline(cell.text)).join('. '));
        }
        break;
      }
      default:
        if (t.text && /\p{L}|\p{N}/u.test(t.text)) b.add('paragraph', stripInline(t.text));
    }
  }
  const first = tokens.find((x) => (x as { type: string }).type === 'heading') as
    | { text?: string }
    | undefined;
  return b.build(first?.text ? stripInline(first.text) : fileName, fileName);
}

/** Markdown inline syntax is not meant to be spoken. */
function stripInline(s: string): string {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}([-*+]|\d+\.)\s+/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

async function parseHtml(text: string, fileName: string): Promise<Doc> {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const b = new DocBuilder();
  blocksFromDom(doc.body, b);
  return b.build(titleFromDom(doc, fileName), fileName);
}

async function parseDocx(buf: ArrayBuffer, fileName: string): Promise<Doc> {
  const mammoth = await import('mammoth');
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const b = new DocBuilder();
  blocksFromDom(doc.body, b);
  return b.build(firstHeading(doc) ?? fileName.replace(/\.docx$/i, ''), fileName);
}

async function parseEpub(buf: ArrayBuffer, fileName: string): Promise<Doc> {
  const zip = await JSZip.loadAsync(buf);
  const b = new DocBuilder();
  let title = fileName.replace(/\.epub$/i, '');

  const container = zip.file('META-INF/container.xml');
  if (container) {
    const cx = new DOMParser().parseFromString(await container.async('text'), 'application/xml');
    const rootfile = cx.querySelector('rootfile')?.getAttribute('full-path');
    if (rootfile && zip.file(rootfile)) {
      const opf = new DOMParser().parseFromString(
        await zip.file(rootfile)!.async('text'),
        'application/xml',
      );
      title = opf.querySelector('title')?.textContent?.trim() || title;
      const manifest = new Map<string, string>();
      opf.querySelectorAll('manifest > item').forEach((it) => {
        const id = it.getAttribute('id');
        const href = it.getAttribute('href');
        if (id && href) manifest.set(id, href);
      });
      const base = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : '';
      for (const itemref of Array.from(opf.querySelectorAll('spine > itemref'))) {
        const href = manifest.get(itemref.getAttribute('idref') ?? '');
        if (!href) continue;
        // Manifest hrefs are relative URIs, not ZIP paths. Normalize dot
        // segments and remove fragments before looking up the archive entry.
        const resolved = new URL(href, `https://epub.invalid/${base}`);
        const entry = zip.file(decodeURIComponent(resolved.pathname.slice(1)));
        if (!entry) continue;
        const html = new DOMParser().parseFromString(await entry.async('text'), 'text/html');
        blocksFromDom(html.body, b);
      }
    }
  }
  return b.build(title, fileName);
}

/**
 * Minimal RTF reader. Handles the control words that actually appear in prose
 * documents: groups, unicode escapes, hex escapes, and the handful of
 * destination words that must be dropped rather than spoken.
 */
function parseRtf(text: string, fileName: string): Doc {
  let out = '';
  let i = 0;
  const drop = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header',
    'footer', 'footnote', 'listtable', 'rsidtbl', 'generator', 'themedata',
  ]);
  const groupStack: { skipping: boolean; unicodeFallback: number; encoding: string }[] = [];
  let skipping = false;
  let unicodeFallback = 1;
  let fallbackLeft = 0;
  let encoding = 'windows-1252';
  const emit = (value: string) => {
    if (fallbackLeft > 0) { fallbackLeft--; return; }
    if (!skipping) out += value;
  };

  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(text.slice(i));
      if (m) {
        const word = m[1];
        const arg = m[2];
        if (drop.has(word)) {
          skipping = true;
        } else if (word === 'uc' && arg) {
          unicodeFallback = Math.max(0, parseInt(arg, 10));
        } else if (word === 'ansicpg' && arg) {
          const candidate = `windows-${arg}`;
          try { new TextDecoder(candidate); encoding = candidate; } catch { /* retain the previous supported codepage */ }
        } else if (word === 'u' && arg) {
          if (!skipping) out += String.fromCharCode(parseInt(arg, 10) < 0 ? parseInt(arg, 10) + 65536 : parseInt(arg, 10));
          fallbackLeft = unicodeFallback;
        } else if (word === 'par' || word === 'line' || word === 'sect') {
          if (!skipping) out += '\n\n';
        } else if (word === 'tab') {
          if (!skipping) out += ' ';
        } else if (word === 'emdash' || word === 'endash' || word === 'lquote' || word === 'rquote' || word === 'ldblquote' || word === 'rdblquote') {
          emit(({ emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”' })[word]);
        }
        i += m[0].length;
        continue;
      }
      const esc = /^\\([\\{}])/.exec(text.slice(i));
      if (esc) { emit(esc[1]); i += 2; continue; }
      const hex = /^\\'([0-9a-fA-F]{2})/.exec(text.slice(i));
      if (hex) { emit(new TextDecoder(encoding).decode(new Uint8Array([parseInt(hex[1], 16)]))); i += 4; continue; }
      if (text[i + 1] === '*') { skipping = true; i += 2; continue; }
      if (text[i + 1] === '~') { emit(' '); i += 2; continue; }
      if (text[i + 1] === '-' || text[i + 1] === '_') { emit(text[i + 1] === '_' ? '‑' : ''); i += 2; continue; }
      i += 1;
      continue;
    }
    if (c === '{') { groupStack.push({ skipping, unicodeFallback, encoding }); i += 1; continue; }
    if (c === '}') {
      const group = groupStack.pop();
      skipping = group?.skipping ?? false; unicodeFallback = group?.unicodeFallback ?? 1; encoding = group?.encoding ?? 'windows-1252';
      fallbackLeft = 0; i += 1; continue;
    }
    if (c !== '\r' && c !== '\n') emit(c);
    i += 1;
  }
  const cleaned = out.replace(/\n{3,}/g, '\n\n');
  return retitle(parsePlainText(cleaned), fileName);
}

function retitle(d: Doc, name: string): Doc {
  return { ...d, sourceName: name };
}

async function parsePdf(buf: ArrayBuffer, fileName: string): Promise<Doc> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const b = new DocBuilder();
  let title = fileName.replace(/\.pdf$/i, '');

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Reconstruct lines from item positions, then paragraphs from line gaps.
    type Line = { y: number; text: string };
    const lines: Line[] = [];
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[]; hasEOL?: boolean };
      if (!it.str) continue;
      const y = Math.round((it.transform?.[5] ?? 0) * 10) / 10;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.y - y) < 3) last.text += it.str;
      else lines.push({ y, text: it.str });
      if (it.hasEOL) lines.push({ y: y - 0.1, text: '' });
    }

    let buf = '';
    let prevY: number | null = null;
    for (const line of lines) {
      const t = line.text.replace(/\s+/g, ' ').trim();
      if (!t) { if (buf.trim()) { b.add('paragraph', buf); buf = ''; prevY = null; } continue; }
      // A vertical jump larger than a line and a half is a paragraph break.
      if (prevY !== null && prevY - line.y > 14 && buf.trim()) {
        b.add('paragraph', buf);
        buf = '';
      }
      buf = buf ? `${buf} ${t}` : t;
      prevY = line.y;
    }
    if (buf.trim()) b.add('paragraph', buf);
  }

  try {
    const meta = await pdf.getMetadata();
    const info = (meta?.info ?? {}) as Record<string, string>;
    if (info.Title) title = info.Title.trim().slice(0, 200);
  } catch { /* metadata is optional */ }

  return b.build(title || fileName, fileName);
}

function firstHeading(doc: Document): string | null {
  const h = doc.querySelector('h1, h2');
  return h?.textContent?.trim().slice(0, 200) || null;
}

function firstLineTitle(text: string): string | null {
  const line = text.split('\n').map((s) => s.trim()).find(Boolean);
  if (!line || line.length > 120) return null;
  if (!/^[\w\s.,'’:—-]+$/.test(line)) return null;
  return line;
}

/* -------------------------------------------------------------- dispatch ---- */

export const SUPPORTED = [
  'md', 'markdown', 'txt', 'text', 'pdf', 'docx', 'epub', 'rtf', 'html', 'htm', 'xhtml',
] as const;

/**
 * Formats with no reliable client-side parser. We say so plainly rather than
 * failing with a stack trace, and suggest the conversion the user can do.
 */
export const UNSUPPORTED: Record<string, string> = {
  doc: 'Word 97-2003 (.doc) has no client-side parser. Open it in Word or LibreOffice and save as .docx.',
  pages: 'Apple Pages has no client-side parser. Export to .docx or .epub from Pages first.',
  wpd: 'WordPerfect has no client-side parser. Convert to .docx or .txt first.',
};

export async function parseDocument(fileName: string, buf: ArrayBuffer): Promise<Doc> {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase();

  if (buf.byteLength === 0) throw new Error('That document is empty; no readable text was found.');

  if (UNSUPPORTED[ext]) throw new Error(UNSUPPORTED[ext]);

  const text = async () => new TextDecoder('utf-8', { fatal: false }).decode(buf);

  switch (ext) {
    case 'md':
    case 'markdown':
      return parseMarkdown(await text(), fileName);
    case 'txt':
    case 'text':
      return parsePlainText(await text());
    case 'pdf':
      return parsePdf(buf, fileName);
    case 'docx':
      return parseDocx(buf, fileName);
    case 'epub':
      return parseEpub(buf, fileName);
    case 'rtf':
      return parseRtf(await text(), fileName);
    case 'html':
    case 'htm':
    case 'xhtml':
      return parseHtml(await text(), fileName);
    default: {
      // Unknown extension: if it decodes as text, read it as text rather than
      // refusing outright.
      const t = await text();
      if (/[\x00-\x08\x0e-\x1f]/.test(t.slice(0, 2048))) {
        throw new Error(
          `"${ext}" is not a document format Narrate can read. Supported: ${SUPPORTED.join(', ')}.`,
        );
      }
      return parsePlainText(t);
    }
  }
}
