/** Exercise the actual Android document-start script without replacing Wry's clients. */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseHTML } from 'linkedom';

const nativePath = new URL('../src-tauri/gen/android/app/src/main/java/com/atarq/narrate/NativeSafeArea.kt', import.meta.url);
const source = existsSync(nativePath) ? readFileSync(nativePath, 'utf8') : '';
const script = source.match(/NATIVE_INSETS_SCRIPT\s*=\s*"""([\s\S]*?)"""/)?.[1] ?? '';
type InsetsPayload = { safeArea: { top: number; right: number; bottom: number; left: number } | null; reduceMotion: boolean };
let payload: InsetsPayload = { safeArea: { top: 24, right: 0, bottom: 24, left: 0 }, reduceMotion: false };
const { window } = parseHTML('<html><head></head><body></body></html>');
Object.assign(window, { NarrateInsets: { read: () => JSON.stringify(payload) } });
const execute = () => runInNewContext(script, { window, document: window.document });

execute();
assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-top'), '24px', 'Android status-bar height reaches CSS before React mounts');
assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-bottom'), '24px', 'gesture navigation receives its own measured inset');
assert.equal(window.document.documentElement.dataset.reduceMotion, 'false');

payload = { safeArea: { top: 0, right: 48, bottom: 0, left: 30 }, reduceMotion: true };
execute();
assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-top'), '0px', 'rotation clears a stale portrait top inset');
assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-left'), '30px', 'landscape cutouts can move onto the left edge');
assert.equal(window.document.documentElement.style.getPropertyValue('--native-safe-area-right'), '48px', 'three-button navigation can move onto the right edge');
assert.equal(window.document.documentElement.dataset.reduceMotion, 'true');

const { window: initialWindow } = parseHTML('<html><body></body></html>');
Object.assign(initialWindow, { NarrateInsets: { read: () => JSON.stringify({ safeArea: null, reduceMotion: true }) } });
runInNewContext(script, { window: initialWindow, document: initialWindow.document });
assert.equal(initialWindow.document.documentElement.style.getPropertyValue('--native-safe-area-top'), '', 'unknown native insets leave CSS env fallback available');
assert.equal(initialWindow.document.documentElement.dataset.reduceMotion, 'true', 'motion preference remains available before insets are measured');

const { window: loadingWindow } = parseHTML('<html><body></body></html>');
Object.assign(loadingWindow, { NarrateInsets: { read: () => JSON.stringify(payload) } });
const html = loadingWindow.document.documentElement;
html.remove();
runInNewContext(script, { window: loadingWindow, document: loadingWindow.document });
loadingWindow.document.appendChild(html);
loadingWindow.document.dispatchEvent(new loadingWindow.Event('DOMContentLoaded'));
assert.equal(html.style.getPropertyValue('--native-safe-area-left'), '30px', 'document-start execution retries when the root element appears');

console.log('Native inset script checks passed: startup, rotation/cutouts, navigation modes, motion preference, and early-document fallback.');
