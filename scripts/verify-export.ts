/** Audio export boundaries; no device, filesystem picker, or browser required. */
import assert from 'node:assert/strict';
import { createAudioExporter, saveAudioExport, type AudioExportBoundary } from '../src/core/audio/export';
import { mock } from 'node:test';

const bytes = Uint8Array.from({ length: 300_007 }, (_, index) => index % 251);
const blob = new Blob([bytes], { type: 'audio/wav' });
function fixture(native = true, session: string | null = 'session-1') {
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const written: Uint8Array[] = [];
  const events: string[] = [];
  let writing = false;
  let fail: string | undefined;
  const boundary: AudioExportBoundary = {
    isTauri: () => true,
    async invoke(command, args) {
      calls.push({ command, args });
      assert.ok(Buffer.byteLength(JSON.stringify(args ?? {})) < 128 * 1024, 'IPC JSON stays below 128 KiB');
      if (command === fail) throw new Error('disk full');
      if (command === 'audio_export_begin') return { native, session };
      if (command === 'audio_export_write') {
        assert.equal(writing, false, 'chunk writes must be sequential');
        writing = true;
        await new Promise(resolve => setTimeout(resolve, 1));
        written.push(Buffer.from(args!.data as string, 'base64'));
        writing = false;
      }
      if (command === 'audio_export_finish') events.push('closed');
      if (command === 'audio_export_abort') events.push('aborted');
      return {};
    },
    async beginBackgroundWork() { events.push('begin'); },
    async endBackgroundWork() { events.push('end'); },
    download(_blob, filename) { assert.equal(filename, 'book.wav'); events.push('anchor'); },
  };
  return { boundary, calls, written, events, fail: (command: string) => { fail = command; } };
}

const complete = fixture();
assert.equal(await createAudioExporter(complete.boundary)(blob, 'book.wav'), true);
assert.deepEqual(Buffer.concat(complete.written), Buffer.from(bytes));
assert.ok(complete.written.length > 1);
assert.deepEqual(complete.events, ['begin', 'closed', 'end']);
assert.equal(complete.calls[0].args?.expectedBytes, blob.size);
assert.equal(complete.calls[0].args?.mimeType, 'audio/wav');
console.log('ok native export writes bounded sequential bytes and succeeds only after close');

const cancelled = fixture(true, null);
assert.equal(await createAudioExporter(cancelled.boundary)(blob, 'book.wav'), false);
assert.deepEqual(cancelled.calls.map(call => call.command), ['audio_export_begin']);
assert.deepEqual(cancelled.events, []);
console.log('ok cancelling the save picker neither writes audio nor reports success');

for (const command of ['audio_export_write', 'audio_export_finish']) {
  const failed = fixture();
  failed.fail(command);
  await assert.rejects(createAudioExporter(failed.boundary)(blob, 'book.wav'), /disk full/);
  assert.deepEqual(failed.events, ['begin', 'aborted', 'end']);
  assert.equal(failed.calls.at(-1)?.command, 'audio_export_abort');
}
console.log('ok write and close failures abort the partial file and end background work');

const startFailed = fixture();
startFailed.boundary.beginBackgroundWork = async () => { throw new Error('service failed'); };
await assert.rejects(createAudioExporter(startFailed.boundary)(blob, 'book.wav'), /service failed/);
assert.deepEqual(startFailed.events, ['aborted']);
console.log('ok background startup failure aborts the newly selected file');

for (const tauri of [false, true]) {
  const desktop = fixture(false);
  desktop.boundary.isTauri = () => tauri;
  assert.equal(await createAudioExporter(desktop.boundary)(blob, 'book.wav'), true);
  assert.deepEqual(desktop.events, ['anchor']);
  assert.equal(desktop.calls.length, tauri ? 1 : 0);
}
console.log('ok browser and desktop preserve the anchor download without native writes');

const documentBefore = Object.getOwnPropertyDescriptor(globalThis, 'document');
const link = { href: '', download: '', click: () => { clicked++; } };
let clicked = 0;
let revokes = 0;
let revokeLater: (() => void) | undefined;
Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => link } });
const createUrl = mock.method(URL, 'createObjectURL', (value: Blob) => { assert.equal(value, blob); return 'blob:audio'; });
const revokeUrl = mock.method(URL, 'revokeObjectURL', (value: string) => { assert.equal(value, 'blob:audio'); revokes++; });
const timer = mock.method(globalThis, 'setTimeout', (callback: () => void, delay: number) => {
  assert.equal(delay, 30_000);
  revokeLater = callback;
  return 0 as unknown as ReturnType<typeof setTimeout>;
});
try {
  assert.equal(await saveAudioExport(blob, 'book.wav'), true);
  assert.equal(clicked, 1);
  assert.equal(link.href, 'blob:audio');
  assert.equal(link.download, 'book.wav');
  assert.equal(revokes, 0);
  revokeLater!();
  assert.equal(revokes, 1);
} finally {
  createUrl.mock.restore(); revokeUrl.mock.restore(); timer.mock.restore();
  if (documentBefore) Object.defineProperty(globalThis, 'document', documentBefore);
  else Reflect.deleteProperty(globalThis, 'document');
}
console.log('ok default browser boundary clicks the filename and defers blob URL cleanup');
