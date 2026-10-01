import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { WebKokoroEngine } from '../src/core/tts/web';
import { modelFiles, modelStore } from '../src/core/tts/downloads';

// Boundary substitutes: installed manifests and the worker host. Actual
// downloader and runtime cache behavior have their own real I/O regressions.
globalThis.caches = { async open() { return { async match() { return new Response('cached narrator'); } }; } } as unknown as CacheStorage;
for (const file of modelFiles('kokoro-q8')) await modelStore.complete(file.url, {
  url: file.url, bytes: file.sizeBytes, total: file.sizeBytes, complete: true, headers: {},
});
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  constructor() { TestWorker.instances.push(this); }
  postMessage(request: { id: number }) { queueMicrotask(() => this.onmessage?.({ data: { id: request.id, type: 'ready' } })); }
  terminate() { this.terminated = true; }
}
globalThis.Worker = TestWorker as unknown as typeof Worker;
const engine = new WebKokoroEngine();
await engine.load();
assert.equal(engine.ready, true);
TestWorker.instances[0].onerror!({ message: 'Worker crashed' });
assert.equal(engine.ready, false);
await engine.load();
assert.equal(engine.ready, true, 'load retries after worker failure');
assert.equal(TestWorker.instances.length, 2, 'retry creates a fresh worker');
assert.equal(TestWorker.instances[0].terminated, true, 'failed worker is terminated');
TestWorker.instances[0].onerror!({ message: 'Late old error' });
assert.equal(engine.ready, true, 'late errors from an old worker cannot kill its replacement');
engine.dispose();
console.log('Worker regressions passed: failure recovery, fresh worker, disposal and stale error isolation.');
