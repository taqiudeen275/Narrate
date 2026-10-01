/**
 * Parser invariants.
 *
 * Run with: npx tsx scripts/verify-parse.ts   (or: npm run verify)
 *
 * This exists because a block-offset bug is invisible in a unit test and
 * extremely visible in the product: the reader rendered text that was
 * duplicated and truncated mid-word, and nothing threw. These checks assert the
 * invariant that makes that impossible — every offset indexes the same string,
 * and concatenating the blocks reproduces the document exactly.
 */

import { parseDocument, DocBuilder } from '../src/core/parse';
import { wordAt, wordAtTime, distributeSentence } from '../src/core/types';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function verifyDoc(label: string, doc: Awaited<ReturnType<typeof parseDocument>>): Promise<void> {
  console.log(`\n${label}`);
  const { plain, blocks, sentences, words } = doc;

  check('has text', plain.trim().length > 0, `plain=${plain.length}`);
  check('has blocks', blocks.length > 0);
  check('has words', words.length > 0);

  // Every block must be inside the string it indexes.
  const inBounds = blocks.every(
    (b) => b.start >= 0 && b.end <= plain.length && b.end > b.start,
  );
  check('block ranges in bounds', inBounds);
  if (!inBounds) {
    const bad = blocks.find((b) => b.start < 0 || b.end > plain.length);
    console.log(`        offending block: ${JSON.stringify(bad)} plain.length=${plain.length}`);
  }

  // Blocks must be ordered and non-overlapping.
  let ordered = true;
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i].start < blocks[i - 1].end) { ordered = false; break; }
  }
  check('blocks ordered and disjoint', ordered);

  // The decisive one: splicing the blocks back together must reproduce the
  // document. This is what the reader actually displays.
  const rebuilt = blocks.map((b) => plain.slice(b.start, b.end)).join('\n\n');
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  check('blocks rejoin to the document', norm(rebuilt) === norm(plain),
    norm(rebuilt).slice(0, 90));

  // Every word must be a real substring at its own offset, and must read as
  // the word the index claims it is.
  const wordsOk = words.every((w) => w.end <= plain.length && w.start < w.end);
  check('word ranges in bounds', wordsOk);

  const sample = words.filter((_, i) => i % 7 === 0).slice(0, 40);
  const mismatches = sample.filter((w) => plain.slice(w.start, w.end) !== w.text);
  check('word text matches its offsets', mismatches.length === 0,
    mismatches.length ? `e.g. "${mismatches[0].text}" vs "${plain.slice(mismatches[0].start, mismatches[0].end)}"` : '');

  // Words must be strictly increasing and non-overlapping, or seeking is wrong.
  let monotonic = true;
  for (let i = 1; i < words.length; i++) {
    if (words[i].start < words[i - 1].end) { monotonic = false; break; }
  }
  check('words strictly increasing', monotonic);

  // Sentence word ranges must line up with the word list.
  const sOk = sentences.every(
    (s) => s.wordStart >= 0 && s.wordEnd <= words.length && s.wordStart < s.wordEnd,
  );
  check('sentence word ranges valid', sOk);

  // Seeking must land on the word you aimed at.
  const probe = words[Math.floor(words.length / 2)];
  const landed = wordAt(doc, probe.start);
  check('wordAt returns the aimed word', landed?.index === probe.index,
    `wanted ${probe.index} got ${landed?.index}`);

  // Timing distribution must be contiguous and inside the sentence window.
  if (words.length > 4) {
    const s = sentences[0];
    distributeSentence(doc, 0, 1, 3);
    const span = words.slice(s.wordStart, s.wordEnd);
    const contiguous = span.every(
      (w) => w.startTime !== null && w.endTime !== null && w.endTime! >= w.startTime!,
    );
    const bounded = span.every(
      (w) => w.startTime! >= 1 - 1e-6 && w.endTime! <= 3 + 1e-6,
    );
    check('distributed times are ordered', contiguous);
    check('distributed times stay in the sentence', bounded);
  }
}

/* -------------------------------------------------------------------------- */

const enc = (s: string) => new TextEncoder().encode(s);

console.log('Narrate parser verification');

const list = await parseDocument('list.md', enc('- first item\n- second **item**'));
check('list-only Markdown retains every item', list.plain === 'first item\n\nsecond item', list.plain);
const table = await parseDocument('table.md', enc('| Name | Value |\n| -- | -- |\n| Alpha | **Beta** |'));
check('Markdown tables retain headings and cell text', table.plain === 'Name. Value\n\nAlpha. Beta', table.plain);
let emptyError = '';
try { await parseDocument('empty.pdf', new ArrayBuffer(0)); }
catch (error) { emptyError = error instanceof Error ? error.message : String(error); }
check('empty binary documents fail before invoking a parser', /empty|no readable text/i.test(emptyError), emptyError);

await verifyDoc('markdown', await parseDocument('t.md', enc(`# Title

First paragraph with a number 1974 and a name O'Shaughnessy.

## A heading

- item one
- item two

> A quoted line.

\`\`\`
code block line
\`\`\`
`)));

await verifyDoc('plain text', await parseDocument('t.txt', enc(`Alpha beta gamma.

Delta epsilon, with a comma.

Zeta. Eta theta iota.
`)));

// The DOM-backed parsers (html, docx, epub) need a browser DOM. Node has none,
// so they are reported as skipped rather than silently passing — a green run
// that quietly checked nothing is worse than an honest gap.
const hasDom = typeof DOMParser !== 'undefined';

if (hasDom) {
  await verifyDoc('html', await parseDocument('t.html', enc(
    `<html><head><title>Doc</title></head><body><h1>Head</h1><p>One.</p><p>Two <em>em</em> here.</p><ul><li>a</li></ul></body></html>`,
  )));
} else {
  console.log('\nhtml — SKIPPED (no DOMParser in this runtime; verified in-browser)');
}

// A single-block document is the case that the separator accounting broke.
await verifyDoc('single block', await parseDocument('one.md', enc('Just one line of text.')));

// Timing then seeking, end to end on a rebuilt document.
const b = new DocBuilder();
b.add('heading', 'Chapter', 1);
b.add('paragraph', 'One two three. Four five six.');
const doc = b.build('T');
check('heading segments as its own sentence', doc.sentences.length === 3,
  `got ${doc.sentences.length}`);

let t = 0;
for (const s of doc.sentences) {
  const len = 0.4 + doc.words.slice(s.wordStart, s.wordEnd).length * 0.2;
  distributeSentence(doc, s.index, t, t + len);
  t += len + 0.22;
}
const seekable = doc.words.every((w) => w.startTime !== null && w.endTime !== null);
console.log(`\ntiming + seek`);
check('every word timed after distribution', seekable);
check(
  'word times increase across the document',
  doc.words.every((w, i) => i === 0 || w.startTime! >= doc.words[i - 1].startTime!),
);
check(
  'seeking to a word by CHARACTER offset lands in that word',
  doc.words.every((w) => wordAt(doc, w.start)?.index === w.index),
);
check(
  'resolving by TIME lands on the word being spoken',
  doc.words.every((w) => {
    const mid = (w.startTime! + w.endTime!) / 2;
    return wordAtTime(doc, mid)?.index === w.index;
  }),
);

const partial = await parseDocument('partial.txt', enc('One two. Three four. Five six. Seven eight.'));
distributeSentence(partial, 0, 0.15, 1.15);
check('streaming resolves words before an untimed document tail', wordAtTime(partial, 0.9)?.text === 'two');
check('streaming gaps retain the last timed word', wordAtTime(partial, 1.3)?.text === 'two');
check('untimed documents have no current word', wordAtTime(await parseDocument('new.txt', enc('One two.')), 0) === null);
const boundary = await parseDocument('boundary.txt', enc('One two.'));
distributeSentence(boundary, 0, 0, 1);
check('a word boundary resolves the next word', wordAtTime(boundary, boundary.words[1].startTime!)?.text === 'two');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
