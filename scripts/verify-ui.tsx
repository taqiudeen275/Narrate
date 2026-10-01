/** Exercise React event handlers in a local DOM, without launching a browser. */
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { useNarrate } from '../src/state/store';
import { DocBuilder } from '../src/core/parse';
import { ReaderView } from '../src/views/ReaderView';
import { VoicePicker } from '../src/views/VoicePicker';
import { VoiceSheet } from '../src/components/VoiceSheet';
import { VoiceLab } from '../src/views/VoiceLab';
import { LibraryView } from '../src/views/LibraryView';

const { window } = parseHTML('<html><body><div id="test"></div></body></html>');
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true });
let scrolled: string[] = [];
window.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 1000, bottom: 1050 } as DOMRect);
window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.textContent ?? ''); };
Object.defineProperty(window, 'innerHeight', { value: 800 });
const root = createRoot(window.document.getElementById('test')!);
const render = async (view: React.ReactNode) => { await act(async () => { root.render(view); }); };
const click = async (element: Element | null) => {
  assert.ok(element, 'expected the user control to exist');
  await act(async () => { element.dispatchEvent(new window.Event('click', { bubbles: true })); });
};
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
  finally { await render(null); }
}

const builder = new DocBuilder();
builder.add('paragraph', 'First sentence. Second sentence.');
builder.add('paragraph', 'Third sentence. Fourth sentence.');
const doc = builder.build('Reader test');
await check('Reader follows a later sentence within the same paragraph', async () => {
  useNarrate.setState({ doc, activeDocId: 'reader-test', readerMode: 'page', playing: false, currentSentence: doc.sentences[0] });
  await render(createElement(ReaderView)); scrolled = [];
  await act(async () => { useNarrate.setState({ playing: true, currentSentence: doc.sentences[1] }); });
  assert.equal(scrolled.length, 1);
  assert.match(scrolled[0], /Second/);
});
await check('Reader respects manual scrolling and attaches scroll listeners after Focus', async () => {
  useNarrate.setState({ doc, readerMode: 'focus', playing: true, currentSentence: doc.sentences[0] });
  await render(createElement(ReaderView));
  await act(async () => { useNarrate.setState({ readerMode: 'page' }); });
  scrolled = [];
  window.document.querySelector('article')!.dispatchEvent(new window.Event('wheel'));
  await act(async () => { useNarrate.setState({ currentSentence: doc.sentences[2] }); });
  assert.equal(scrolled.length, 0, 'manual scrolling must suppress automatic recentering');
});
await check('Library awaits file bytes before importing the actual filename and ArrayBuffer', async () => {
  let release!: (buffer: ArrayBuffer) => void;
  const pendingBytes = new Promise<ArrayBuffer>(resolve => { release = resolve; });
  const file = new File(['%PDF fixture bytes'], 'selected-document.pdf', { type: 'application/pdf' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => pendingBytes });
  const imported: { name: string; buffer: ArrayBuffer }[] = [];
  const opened: string[] = [];
  useNarrate.setState({ library: [], busy: false, activeDocId: null,
    openBuffer: async (name, buffer) => { imported.push({ name, buffer }); return true; },
    setView: view => opened.push(view) });
  await render(createElement(LibraryView));
  const input = window.document.querySelector('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file] });
  await act(async () => { input.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(imported.length, 0, 'file reads must finish before parser/state receives them');
  assert.equal(opened.length, 0, 'the document must not open while its bytes are pending');
  const bytes = new TextEncoder().encode('%PDF fixture bytes').buffer;
  await act(async () => { release(bytes); });
  assert.equal(imported.length, 1);
  assert.equal(imported[0].name, 'selected-document.pdf');
  assert.equal(imported[0].buffer, bytes);
  assert.deepEqual(opened, ['player']);
});

class TestSource {
  buffer: unknown;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect() {}
  disconnect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
class TestContext {
  static all: TestContext[] = [];
  state = 'suspended';
  destination = {};
  sources: TestSource[] = [];
  constructor() { TestContext.all.push(this); }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
  createBuffer(_channels: number, length: number) { return { getChannelData: () => new Float32Array(length) }; }
  createBufferSource() { const source = new TestSource(); this.sources.push(source); return source; }
}
Object.assign(globalThis, { AudioContext: TestContext });
const chunk = { samples: new Float32Array([0.1, 0.2]), sampleRate: 24000, duration: 2 / 24000 };
let synthesize = async () => chunk;
const unhandled: unknown[] = [];
process.on('unhandledRejection', error => unhandled.push(error));
const engine = { id: 'test', name: 'Test narrator', ready: true, async load() {}, voices: () => [], dispose() {},
  synthesize: async () => synthesize() };
const audition = () => window.document.querySelector('[aria-label^="Audition"], .n-vcard-foot button');
for (const [name, component] of [['VoiceSheet', createElement(VoiceSheet, { onClose() {} })],
  ['VoicePicker', createElement(VoicePicker)], ['VoiceLab', createElement(VoiceLab)]] as const) {
  await check(`${name} resumes audio and closes its context when the preview ends`, async () => {
    TestContext.all = []; synthesize = async () => chunk;
    useNarrate.setState({ engine, engineReady: true, ensureEngine: async () => {}, busy: false });
    await render(component); await click(audition());
    const context = TestContext.all.at(-1)!;
    assert.equal(context.state, 'running', 'previews must resume a suspended AudioContext');
    context.sources[0].onended?.();
    await act(async () => {});
    assert.equal(context.state, 'closed');
  });
  await check(`${name} suppresses a late preview after unmount`, async () => {
    TestContext.all = [];
    let release!: (value: typeof chunk) => void;
    synthesize = () => new Promise(resolve => { release = resolve; });
    useNarrate.setState({ engine, engineReady: true, ensureEngine: async () => {}, busy: false });
    await render(component); await click(audition()); await render(null);
    await act(async () => { release(chunk); });
    assert.equal(TestContext.all.flatMap(context => context.sources).filter(source => source.started).length, 0,
      'unmounted previews must never start late audio');
    assert.ok(TestContext.all.every(context => context.state === 'closed'));
  });
  await check(`${name} reports model preparation failures without leaking audio`, async () => {
    TestContext.all = [];
    const before = unhandled.length;
    useNarrate.setState({ engine, ensureEngine: async () => { throw new Error('Preparation failed'); }, busy: false });
    await render(component); await click(audition());
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(unhandled.length, before, 'failed auditions must not reject an ignored event promise');
    assert.match(window.document.querySelector('[role="alert"]')?.textContent ?? '', /Preparation failed/);
    assert.ok(TestContext.all.every(context => context.state === 'closed'));
  });
}
await check('Changing an audition stops the old source and closes its context', async () => {
  TestContext.all = []; synthesize = async () => chunk;
  useNarrate.setState({ engine, engineReady: true, ensureEngine: async () => {}, busy: false });
  await render(createElement(VoicePicker)); await click(audition()); await click(audition());
  assert.equal(TestContext.all[0].state, 'closed');
  assert.equal(TestContext.all[0].sources[0].stopped, true);
  assert.equal(TestContext.all[1].state, 'running');
});

await act(async () => root.unmount());
console.log(failures ? `${failures} UI CHECK(S) FAILED` : 'ALL UI CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
