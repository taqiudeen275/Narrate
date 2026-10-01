/** Modal behavior checks against the real narrator picker, without a browser. */
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { act, createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceSheet } from '../src/components/VoiceSheet';
import { useNarrate } from '../src/state/store';

const { window } = parseHTML('<html><body><div id="test"><button id="opener">Narrators</button></div><aside id="existing" inert aria-hidden="true"></aside></body></html>');
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true });
let activeElement: HTMLElement | null = null;
Object.defineProperty(window.document, 'activeElement', { get: () => activeElement });
window.HTMLElement.prototype.focus = function () { activeElement = this; };
let reducedMotion = false;
window.matchMedia = ((query: string) => ({ matches: query.includes('reduced-motion') ? reducedMotion : true })) as typeof window.matchMedia;

// Linkedom has no compositor. Observe our API boundary and control completion,
// while keeping the picker, DOM event handlers, modal lifecycle and store real.
type ObservedAnimation = { target: HTMLElement; frames: Keyframe[]; duration: number; cancelled: boolean; finish: () => void };
const animations: ObservedAnimation[] = [];
window.HTMLElement.prototype.animate = function (frames: Keyframe[] | PropertyIndexedKeyframes, options?: number | KeyframeAnimationOptions) {
  let finish!: () => void;
  const finished = new Promise<Animation>(resolve => { finish = () => resolve({} as Animation); });
  const observed = { target: this, frames: frames as Keyframe[], duration: typeof options === 'number' ? options : Number(options?.duration), cancelled: false, finish };
  animations.push(observed);
  return { finished, cancel() { observed.cancelled = true; } } as Animation;
};

const container = window.document.getElementById('test')!;
const root = createRoot(container);
let closes = 0;
function Picker() {
  const [open, setOpen] = useState(false);
  return createElement(Fragment, null,
    createElement('button', { id: 'opener', onClick() { setOpen(true); } }, 'Narrators'),
    open ? createElement(VoiceSheet, { onClose() { closes++; setOpen(false); } }) : null);
}
const render = async (view: React.ReactNode) => { await act(async () => root.render(view)); };
const click = async (element: Element | null) => {
  assert.ok(element, 'expected a modal control');
  await act(async () => element.dispatchEvent(new window.Event('click', { bubbles: true })));
};
const key = async (name: string, shiftKey = false) => {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key: name, shiftKey });
  await act(async () => (activeElement ?? window.document).dispatchEvent(event));
  return event;
};
const dialog = () => window.document.querySelector<HTMLElement>('[role="dialog"]');
const close = () => window.document.querySelector('[aria-label="Close"]');
const openPicker = async () => {
  closes = 0; animations.length = 0;
  useNarrate.setState({ busy: false });
  await render(createElement(Picker));
  window.document.getElementById('opener')!.focus();
  await click(window.document.getElementById('opener'));
};
let failures = 0;
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`); }
  finally { await render(null); reducedMotion = false; delete window.document.documentElement.dataset.reduceMotion; }
}

await check('Phone picker rises on opening and waits for its shorter exit before unmounting', async () => {
  await openPicker();
  assert.equal(animations.length, 1, 'opening the modal must start its entrance');
  const entrance = animations[0];
  assert.equal(entrance.target, dialog(), 'only the sheet moves; the backdrop has no animated ancestor');
  assert.equal(entrance.frames[0].transform, 'translateY(100%)');
  assert.equal(entrance.frames.at(-1)!.transform, 'translateY(0)');
  assert.equal(dialog()!.parentElement!.parentElement, window.document.body, 'modal is outside view compositing layers');
  await click(close());
  assert.equal(closes, 0, 'closing must keep the sheet mounted through its exit');
  assert.ok(dialog());
  assert.equal(entrance.cancelled, true, 'dismissal interrupts the entrance');
  const exit = animations.at(-1)!;
  assert.ok(exit.duration < entrance.duration);
  assert.equal(exit.frames.at(-1)!.transform, 'translateY(100%)');
  await act(async () => exit.finish());
  assert.equal(closes, 1);
  assert.equal(dialog(), null);
});

await check('Modal protects the background through exit and restores focus and existing attributes', async () => {
  window.document.body.style.overflow = 'auto';
  container.setAttribute('aria-hidden', 'false');
  await openPicker();
  assert.ok(container.hasAttribute('inert'), 'underlying playback controls must be inert');
  assert.equal(container.getAttribute('aria-hidden'), 'true');
  assert.equal(window.document.body.style.overflow, 'hidden');
  assert.equal(activeElement?.getAttribute('aria-label'), 'Close', 'initial focus must not open the phone keyboard');
  const controls = Array.from(dialog()!.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])'));
  controls[0].focus();
  assert.equal((await key('Tab', true)).defaultPrevented, true);
  assert.equal(activeElement, controls.at(-1));
  await key('Tab');
  assert.equal(activeElement, controls[0]);
  const escape = await key('Escape');
  assert.equal(escape.defaultPrevented, true);
  assert.ok(container.hasAttribute('inert'), 'background remains protected during exit');
  await act(async () => animations.at(-1)!.finish());
  assert.equal(container.hasAttribute('inert'), false);
  assert.equal(container.getAttribute('aria-hidden'), 'false');
  assert.ok(window.document.getElementById('existing')!.hasAttribute('inert'));
  assert.equal(window.document.body.style.overflow, 'auto');
  assert.equal(activeElement?.id, 'opener');
});

for (const source of ['browser', 'Android'] as const) {
  await check(`${source} reduced motion omits spatial entrance and dismisses immediately`, async () => {
    if (source === 'browser') reducedMotion = true;
    else window.document.documentElement.dataset.reduceMotion = 'true';
    await openPicker();
    assert.equal(animations.length, 0);
    await click(close());
    assert.equal(closes, 1);
    assert.equal(dialog(), null);
  });
}

await check('Scrim closes once and an unfinished animation cannot strand the modal', async () => {
  await openPicker();
  await click(window.document.querySelector('.n-sheet-scrim'));
  await click(window.document.querySelector('.n-sheet-scrim'));
  assert.equal(closes, 0);
  assert.equal(animations.length, 2, 'repeated dismissal must not restart the exit');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
  assert.equal(closes, 1);
  assert.equal(dialog(), null);
});

await check('WebViews without animate retain the modal until CSS exit completes', async () => {
  const animate = window.HTMLElement.prototype.animate;
  delete (window.HTMLElement.prototype as Partial<HTMLElement>).animate;
  try {
    await openPicker();
    await click(close());
    assert.equal(closes, 0);
    const event = new window.Event('animationend', { bubbles: true });
    Object.assign(event, { animationName: 'n-sheet-leave' });
    await act(async () => dialog()!.dispatchEvent(event));
    assert.equal(closes, 1);
    assert.equal(dialog(), null);
  } finally { window.HTMLElement.prototype.animate = animate; }
});

await act(async () => root.unmount());
console.log(failures ? `${failures} VOICE SHEET CHECK(S) FAILED` : 'ALL VOICE SHEET CHECKS PASSED');
process.exitCode = failures ? 1 : 0;
