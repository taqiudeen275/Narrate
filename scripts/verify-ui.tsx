/** Exercise React event handlers in a local DOM, without launching a browser. */
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { act, createElement, Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { useNarrate } from '../src/state/store';
import { DocBuilder } from '../src/core/parse';
import { distributeSentence, wordAtTime } from '../src/core/types';
import { ReaderView } from '../src/views/ReaderView';
import { VoicePicker } from '../src/views/VoicePicker';
import { VoiceSheet } from '../src/components/VoiceSheet';
import { VoiceLab } from '../src/views/VoiceLab';
import { LibraryView } from '../src/views/LibraryView';
import { PlayerView } from '../src/views/PlayerView';
import { Transport } from '../src/components/Transport';

const { window } = parseHTML('<html><body><div id="test"></div></body></html>');
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true });
let scrolled: ScrollToOptions[] = [];
let scrollBehavior: ScrollBehavior | undefined;
window.HTMLElement.prototype.getBoundingClientRect = function () { return (this.tagName === 'ARTICLE' || this.classList.contains('n-focus-stage') ? { top: 100, bottom: 600, height: 500 } : { top: 1000, bottom: 1050, height: 50 }) as DOMRect; };
window.HTMLElement.prototype.scrollIntoView = () => { throw new Error('following must not scroll the viewport or horizontal ancestors'); };
window.HTMLElement.prototype.scrollTo = function (options?: ScrollToOptions | number) {
  assert.ok(this.tagName === 'ARTICLE' || this.classList.contains('n-focus-stage'), 'only the active reading pane may scroll');
  assert.equal(typeof options, 'object');
  scrolled.push(options as ScrollToOptions); scrollBehavior = (options as ScrollToOptions).behavior;
};
Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', { get: () => 500, configurable: true });
Object.defineProperty(window.HTMLElement.prototype, 'scrollTop', { get: () => 0, configurable: true });
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
  assert.equal(scrolled[0].top, 675);
  assert.equal(scrolled[0].left, undefined, 'following must leave horizontal positioning unchanged');
});
await check('Reader respects manual scrolling and attaches scroll listeners after Focus', async () => {
  useNarrate.setState({ doc, readerMode: 'focus', playing: true, currentSentence: doc.sentences[0] });
  await render(createElement(ReaderView));
  await act(async () => { useNarrate.setState({ readerMode: 'page' }); });
  scrolled = [];
  await act(async () => window.document.querySelector('article')!.dispatchEvent(new window.Event('wheel')));
  await act(async () => { useNarrate.setState({ currentSentence: doc.sentences[2] }); });
  assert.equal(scrolled.length, 0, 'manual scrolling must suppress automatic recentering');
  await click(window.document.querySelector('.n-reader-follow'));
  assert.equal(scrolled.length, 1, 'Resume follow must bring the narration back into view');
});
await check('Reader following respects Android reduced motion', async () => {
  window.document.documentElement.dataset.reduceMotion = 'true';
  useNarrate.setState({ doc, activeDocId: 'reduced-reader', readerMode: 'page', playing: false, currentSentence: doc.sentences[0] });
  await render(createElement(ReaderView));
  await act(async () => useNarrate.setState({ playing: true, currentSentence: doc.sentences[1] }));
  assert.equal(scrollBehavior, 'instant', 'automatic following must not force smooth scrolling when animations are removed');
  delete window.document.documentElement.dataset.reduceMotion;
});
await check('Reader list prose wraps in one flex child', async () => {
  const list = new DocBuilder(); list.add('listItem', 'A long list item keeps all its words together and wraps on a phone.');
  useNarrate.setState({ doc: list.build('List'), playing: false, currentSentence: null, currentWord: null, readerMode: 'page' });
  await render(createElement(ReaderView));
  assert.equal(window.document.querySelector('.n-li')!.children.length, 2, 'bullet and prose must be the only flex children');
  assert.match(window.document.querySelector('.n-li-text')!.textContent ?? '', /wraps on a phone/);
});
await check('Both reading modes remain reachable and following advances within a long sentence', async () => {
  const text = new DocBuilder(); text.add('paragraph', 'First second third fourth fifth sixth.');
  const indexed = text.build('Long sentence'); distributeSentence(indexed, 0, 1, 7);
  useNarrate.setState({ doc: indexed, time: 1.01, activeDocId: 'mode-test', readerMode: 'page', playing: false,
    currentSentence: indexed.sentences[0], setReaderMode: mode => useNarrate.setState({ readerMode: mode }) });
  await render(createElement(ReaderView));
  await click(window.document.querySelector('[aria-label="Reading mode"] button:last-child'));
  assert.ok(window.document.querySelector('.n-reader-focus'));
  assert.equal(window.document.querySelectorAll('[aria-label="Reading mode"] button').length, 2);
  await click(window.document.querySelector('[aria-label="Reading mode"] button:first-child'));
  assert.ok(window.document.querySelector('article'));
  await act(async () => useNarrate.setState({ playing: true })); scrolled = [];
  await act(async () => useNarrate.setState({ time: indexed.words[4].startTime! + 0.01 }));
  assert.equal(scrolled.length, 1, 'the next offscreen word must be followed even before the sentence changes');
  assert.equal(scrolled[0].left, undefined);
});
await check('Reader updates at word boundaries, without rerendering every audio tick', async () => {
  const timed = new DocBuilder(); timed.add('paragraph', 'First second.');
  const indexed = timed.build('Timing'); distributeSentence(indexed, 0, 1, 2);
  const first = indexed.words[0]; const second = indexed.words[1];
  let commits = 0;
  useNarrate.setState({ doc: indexed, time: first.startTime! + 0.01, currentWord: first,
    currentSentence: indexed.sentences[0], readerMode: 'page', playing: false });
  await render(createElement(Profiler, { id: 'reader', onRender: () => { commits++; } }, createElement(ReaderView)));
  const mounted = commits;
  for (const time of [first.startTime! + 0.02, first.startTime! + 0.03, first.startTime! + 0.04]) {
    await act(async () => useNarrate.setState({ time, currentWord: wordAtTime(indexed, time) }));
  }
  assert.equal(commits, mounted, 'audio frames within one word must not rerender the whole document');
  assert.equal(window.document.querySelector('.n-w-now')?.textContent, 'First');
  await act(async () => useNarrate.setState({ time: second.startTime! + 0.01, currentWord: second }));
  assert.equal(window.document.querySelector('.n-w-now')?.textContent, 'second');
  await act(async () => useNarrate.setState({ time: second.endTime! + 0.01, currentWord: second }));
  assert.equal(window.document.querySelector('.n-w-now'), null, 'a sentence pause must not leave a word highlighted');
  await act(async () => useNarrate.setState({ time: 0 }));
  assert.equal(window.document.querySelector('.n-w-spent'), null, 'a reset timeline must not retain spent words from the last position');
  assert.equal(window.document.querySelector('.n-w-now'), null, 'leading silence must not highlight the first word early');
});
await check('Reader only rebuilds the affected text block during playback and generation', async () => {
  const text = new DocBuilder();
  text.add('paragraph', 'First second third.');
  text.add('quote', 'Next later last.');
  text.add('code', 'Future words wait.');
  const indexed = text.build('Stable blocks');
  distributeSentence(indexed, 0, 1, 4);
  const reads = [0, 0, 0];
  for (const word of indexed.words) {
    const surface = word.text;
    Object.defineProperty(word, 'text', { get() { reads[word.blockIndex]++; return surface; } });
  }
  useNarrate.setState({ doc: indexed, time: 1.1, currentSentence: indexed.sentences[0], readerMode: 'page',
    activeDocId: 'stable-blocks', playing: false, renderedCount: 1 });
  await render(createElement(ReaderView));
  reads.fill(0);
  await act(async () => useNarrate.setState({ time: indexed.words[1].startTime! + 0.01 }));
  assert.ok(reads[0] > 0, 'the playing block must update its word highlight');
  assert.deepEqual(reads.slice(1), [0, 0], 'a word boundary must leave every inactive block cached');
  assert.equal(window.document.querySelector('.n-w-now')?.textContent, 'second');
  reads.fill(0);
  await act(async () => {
    distributeSentence(indexed, 1, 5, 8);
    useNarrate.setState({ doc: { ...indexed }, renderedCount: 2 });
  });
  assert.equal(reads[0], 0, 'saving a later sentence must leave the playing block cached');
  assert.ok(reads[1] > 0, 'newly generated words must update their seek availability');
  assert.equal(reads[2], 0, 'saving a sentence must leave the remaining untimed blocks cached');
  assert.equal(window.document.querySelector('.n-block-quote .n-w')?.getAttribute('title'), 'Play from here');
  assert.equal(window.document.querySelector('.n-block-code .n-w')?.getAttribute('title'), 'Render and play from here');
  reads.fill(0);
  await act(async () => useNarrate.setState({ doc: { ...indexed } }));
  assert.deepEqual(reads, [0, 0, 0], 'a timing wrapper update alone must reuse all text content');
  await act(async () => {
    for (const word of indexed.words) { word.startTime = null; word.endTime = null; }
    for (const sentence of indexed.sentences) { sentence.startTime = null; sentence.endTime = null; }
    useNarrate.setState({ doc: { ...indexed }, renderedCount: 0, time: 0 });
  });
  assert.equal(window.document.querySelector('[title="Play from here"]'), null, 'a new narration must reset seek availability');
  assert.equal(window.document.querySelector('.n-w-spent, .n-w-now'), null, 'a timing reset must clear playback highlights');
});
await check('Reader memoized blocks retain seeking and follow the next block', async () => {
  const text = new DocBuilder(); text.add('paragraph', 'First second.'); text.add('paragraph', 'Third fourth.');
  const indexed = text.build('Seek boundaries');
  distributeSentence(indexed, 0, 1, 3); distributeSentence(indexed, 1, 4, 6);
  const sought: number[] = [];
  const originalSeek = useNarrate.getState().seekWord;
  try {
    useNarrate.setState({ doc: indexed, time: 1.1, currentSentence: indexed.sentences[0], readerMode: 'page',
      playing: true, activeDocId: 'seek-boundaries', seekWord: async index => { sought.push(index); } });
    await render(createElement(ReaderView));
    await act(async () => window.document.querySelector('article')!.dispatchEvent(new window.Event('wheel')));
    scrolled = [];
    await click(window.document.querySelectorAll('.n-w')[1]);
    assert.deepEqual(sought, [1], 'pointer seeking must preserve the exact word index');
    await act(async () => {
      const event = new window.Event('keydown', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'key', { value: 'Enter' });
      window.document.querySelectorAll('.n-w')[3].dispatchEvent(event);
    });
    assert.deepEqual(sought, [1, 3], 'keyboard seeking must preserve the exact word index');
    scrolled = [];
    await act(async () => useNarrate.setState({ time: 5.1, currentSentence: indexed.sentences[1] }));
    assert.equal(window.document.querySelector('.n-w-now')?.textContent, 'fourth');
    assert.equal(scrolled.length, 1, 'follow must use the active word ref after entering a cached block');
  } finally { await act(async () => useNarrate.setState({ seekWord: originalSeek })); }
});
await check('Transport ignores generation metadata and keeps playback position current', async () => {
  let commits = 0;
  useNarrate.setState({ doc, time: 0, duration: 10, busy: false, playing: false, engineLoading: false });
  await render(createElement(Profiler, { id: 'transport', onRender: () => { commits++; } }, createElement(Transport)));
  const mounted = commits;
  await act(async () => useNarrate.setState({ library: [...useNarrate.getState().library] }));
  await act(async () => useNarrate.setState({ generationJobs: [...useNarrate.getState().generationJobs] }));
  assert.equal(commits, mounted, 'saving Library/Work metadata must not rebuild the playback controls');
  await act(async () => useNarrate.setState({ time: 5 }));
  assert.equal(window.document.querySelector('[aria-label="Position in document"]')?.getAttribute('aria-valuenow'), '50');
  assert.ok(commits > mounted, 'playback position changes must still update the transport');
});
await check('Listen keeps the current sentence visible during streaming and exposes saved progress', async () => {
  let cancelled = false;
  useNarrate.setState({ doc, currentSentence: doc.sentences[1], renderedCount: 1, busy: true, engineLoading: false,
    duration: 2, status: 'Paused · rendering continues', generateMode: 'stream', cancel: () => { cancelled = true; } });
  await render(createElement(PlayerView));
  assert.match(window.document.querySelector('.n-caption')!.textContent ?? '', /Second sentence/);
  assert.match(window.document.querySelector('.n-player-generation')!.textContent ?? '', /Paused · rendering continues/);
  assert.match(window.document.querySelector('.n-player-generation-foot')!.textContent ?? '', /1 of 4 sentences saved/);
  assert.equal(window.document.querySelector('[aria-label="Generating audio"]')!.getAttribute('aria-valuenow'), '25');
  assert.match(window.document.querySelector('.n-player-voice')!.textContent ?? '', /Change narrator/);
  await click(window.document.querySelector('.n-player-generation-foot button'));
  assert.equal(cancelled, true);
});
await check('Listen prepares full documents, then offers both exports when audio is complete', async () => {
  const exports: string[] = [];
  useNarrate.setState({ doc, currentSentence: null, renderedCount: 0, busy: true, engineLoading: false,
    duration: 0, generateMode: 'full', cancel: null, exportAudio: async format => { exports.push(format); } });
  await render(createElement(PlayerView));
  assert.match(window.document.querySelector('.n-caption')!.textContent ?? '', /Preparing the document/);
  await act(async () => useNarrate.setState({ busy: false, renderedCount: doc.sentences.length, duration: 10 }));
  assert.equal(window.document.querySelector('.n-player-generation'), null);
  assert.match(window.document.querySelector('.n-caption')!.textContent ?? '', /saved audio is ready/);
  const actions = Array.from(window.document.querySelectorAll('.n-player-actions button'));
  await click(actions.find(button => button.textContent === 'WAV') ?? null);
  await click(actions.find(button => button.textContent === 'MP3') ?? null);
  assert.deepEqual(exports, ['wav', 'mp3']);
});
for (const [name, component] of [['Library', createElement(LibraryView)], ['VoicePicker', createElement(VoicePicker)],
  ['VoiceLab', createElement(VoiceLab)], ['VoiceSheet', createElement(VoiceSheet, { onClose() {} })]] as const) {
  await check(`${name} does not rerender its full list on playback frames`, async () => {
    let commits = 0;
    await render(createElement(Profiler, { id: name, onRender: () => { commits++; } }, component));
    const mounted = commits;
    for (const time of [30.1, 30.2, 30.3]) await act(async () => useNarrate.setState({ time }));
    assert.equal(commits, mounted, 'background playback must not rebuild static lists on every frame');
  });
}
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

await check('Saved playback identifies its edition and offers generation with the selected model', async () => {
  const calls: string[] = [];
  useNarrate.setState({ doc, busy: false, engineLoading: false, renderedCount: doc.sentences.length,
    audioProfile: { modelId: 'kokoro-q8', voiceId: 'af_bella', speed: 1 }, generateMode: 'full',
    engine: { id: 'kokoro-fp32', name: 'Kokoro · Full precision', ready: true,
      async load() {}, voices: () => [], dispose() {}, async synthesize() { throw new Error('No inference during a UI check'); } },
    generate: async mode => { calls.push(mode); } });
  await render(createElement(PlayerView));
  assert.match(window.document.querySelector('[aria-label="Saved audio model"]')?.textContent ?? '', /Balanced/,
    'saved PCM must not be labelled with the selected generation edition');
  const action = Array.from(window.document.querySelectorAll('button')).find(button => button.textContent?.includes('Generate with'));
  assert.match(action?.textContent ?? '', /Full precision/);
  await click(action ?? null);
  assert.deepEqual(calls, ['full'], 'the explicit action generates with the currently chosen mode');
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
