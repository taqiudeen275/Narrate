import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createRequire } from 'node:module';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
require.extensions['.css'] = () => undefined;
const { window } = parseHTML('<html><body><div id="test"></div></body></html>');
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
let reducedMotion = false;
window.matchMedia = (() => ({ matches: reducedMotion })) as typeof window.matchMedia;
const animations: { frames: Keyframe[]; cancelled: boolean }[] = [];
window.HTMLElement.prototype.animate = function (frames: Keyframe[] | PropertyIndexedKeyframes) {
  const animation = { frames: frames as Keyframe[], cancelled: false };
  animations.push(animation);
  return { cancel() { animation.cancelled = true; } } as Animation;
};
let requests = 0;
globalThis.fetch = async () => { requests++; throw new DOMException('Test download paused', 'AbortError'); };
const { useNarrate } = require('../src/state/store.ts') as typeof import('../src/state/store');
const App = require('../src/App.tsx').default;
const { LibraryView } = require('../src/views/LibraryView.tsx') as typeof import('../src/views/LibraryView');
const { syncNativeInsets } = require('../src/core/safeArea.ts') as typeof import('../src/core/safeArea');
const root = createRoot(window.document.getElementById('test')!);
const render = async (view: React.ReactNode) => { await act(async () => root.render(view)); };
const click = async (element: Element | null) => {
  assert.ok(element, 'expected a visible control');
  await act(async () => element.dispatchEvent(new window.Event('click', { bubbles: true })));
};
const button = (parent: ParentNode, label: string) => Array.from(parent.querySelectorAll('button')).find(item => item.textContent === label) ?? null;
let failures = 0;
const check = async (name: string, run: () => Promise<void>) => {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`); }
  finally { await render(null); }
};

const appState = () => useNarrate.setState({ hydrated: true, library: [], doc: null, activeDocId: null, view: 'library', busy: false,
  error: null, hydrate: async () => {}, setView: view => useNarrate.setState({ view }) });
await check('Startup safe-area fallback works on older WebViews without breaking browser launch', async () => {
  window.NarrateInsets = { read: () => JSON.stringify({ safeArea: { top: 27, right: 0, bottom: 24, left: 0 }, reduceMotion: true }) };
  syncNativeInsets();
  assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-top'), '27px');
  assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-bottom'), '24px');
  assert.equal(window.document.documentElement.dataset.reduceMotion, 'true');
  window.NarrateInsets = { read: () => 'invalid JSON' };
  assert.doesNotThrow(syncNativeInsets, 'a broken bridge cannot prevent app startup');
  delete window.NarrateInsets;
  assert.doesNotThrow(syncNativeInsets, 'ordinary browsers launch without the native bridge');
  delete window.document.documentElement.dataset.reduceMotion;
});
await check('Mobile navigation animates changes and cancels interrupted page motion', async () => {
  appState(); animations.length = 0;
  await render(createElement(App));
  await click(window.document.querySelector('.n-bottomnav [aria-label="Settings"]'));
  assert.ok(animations.length > 0, 'page changes must animate');
  const first = animations.at(-1)!;
  assert.ok(String(first.frames[0].transform).includes('18px'), 'forward navigation travels along the section axis');
  await click(window.document.querySelector('.n-bottomnav [aria-label="Library"]'));
  assert.equal(first.cancelled, true, 'rapid navigation cancels the previous animation');
  assert.ok(String(animations.at(-1)!.frames[0].transform).includes('-18px'), 'back navigation reverses direction');
  const count = animations.length;
  await act(async () => useNarrate.setState({ time: 10 }));
  assert.equal(animations.length, count, 'audio ticks must not replay page animations');
});
await check('Reduced motion keeps page navigation instant, including Android preference', async () => {
  appState(); reducedMotion = true; animations.length = 0;
  await render(createElement(App));
  await click(window.document.querySelector('.n-bottomnav [aria-label="Settings"]'));
  assert.equal(animations.length, 0);
  reducedMotion = false;
  window.document.documentElement.dataset.reduceMotion = 'true';
  await click(window.document.querySelector('.n-bottomnav [aria-label="Library"]'));
  assert.equal(animations.length, 0);
  delete window.document.documentElement.dataset.reduceMotion;
});
await check('Section controls wait for startup so hydration cannot discard a user selection', async () => {
  appState();
  let release!: () => void;
  useNarrate.setState({ hydrated: false, hydrate: () => new Promise(resolve => { release = () => { useNarrate.setState({ hydrated: true }); resolve(); }; }) });
  await render(createElement(App));
  const settings = window.document.querySelector('.n-bottomnav [aria-label="Settings"]')!;
  assert.equal(settings.hasAttribute('disabled'), true, 'startup navigation must wait for stored Library to load');
  await click(settings);
  assert.equal(useNarrate.getState().view, 'library');
  await act(async () => release());
  assert.equal(settings.hasAttribute('disabled'), false);
  await click(settings);
  assert.equal(useNarrate.getState().view, 'settings');
});
await check('A larger model waits for consent; Cancel makes no request and Proceed downloads', async () => {
  appState(); requests = 0;
  await render(createElement(App));
  await click(window.document.querySelector('.n-bottomnav [aria-label="Settings"]'));
  assert.equal(window.document.querySelectorAll('.n-model-card').length, 3, 'the full supported catalog stays visible');
  const card = Array.from(window.document.querySelectorAll('.n-model-card')).find(item => item.textContent?.includes('Full precision'))!;
  await click(button(card, 'Download'));
  assert.match(card.querySelector('[role="alert"]')?.textContent ?? '', /memory|larger/i);
  assert.equal(requests, 0, 'warning must appear before network download begins');
  await click(button(card, 'Cancel'));
  assert.equal(card.querySelector('[role="alert"]'), null);
  assert.equal(requests, 0);
  await click(button(card, 'Download'));
  await click(button(card, 'Download anyway'));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  assert.ok(requests > 0, 'user can proceed with the larger model');
});
await check('Empty Library offers the sample and awaits success before opening Listen', async () => {
  appState();
  let release!: (success: boolean) => void;
  const views: string[] = [];
  useNarrate.setState({ openSample: () => new Promise(resolve => { release = resolve; }), setView: view => views.push(view) });
  await render(createElement(LibraryView));
  await click(button(window.document, 'Try the sample'));
  assert.deepEqual(views, [], 'sample save/open must finish first');
  await act(async () => release(true));
  assert.deepEqual(views, ['player']);
});
await check('A failed sample open stays in Library', async () => {
  appState(); const views: string[] = [];
  useNarrate.setState({ openSample: async () => false, setView: view => views.push(view) });
  await render(createElement(LibraryView));
  await click(button(window.document, 'Try the sample'));
  assert.deepEqual(views, []);
});

await act(async () => root.unmount());
console.log(failures ? `${failures} MOBILE UI CHECK(S) FAILED` : 'ALL MOBILE UI CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
