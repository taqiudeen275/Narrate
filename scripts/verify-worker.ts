import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { WebKokoroEngine } from '../src/core/tts/web';
import { modelFiles, modelStore } from '../src/core/tts/downloads';
import type { KokoroReply, KokoroRequest } from '../src/core/tts/worker-types';

// Boundary substitutes: installed manifests and the worker host. Actual
// downloader and runtime cache behavior have their own real I/O regressions.
globalThis.caches = { async open() { return { async match() { return new Response('cached narrator'); } }; } } as unknown as CacheStorage;
for (const file of modelFiles('kokoro-q8')) await modelStore.complete(file.url, {
  url: file.url, bytes: file.sizeBytes, total: file.sizeBytes, complete: true, headers: {},
});
class TestWorker {
  static instances: TestWorker[] = [];
  static nextMode: 'normal' | 'load-stall' | 'synthesis-stall' | 'send-error' | 'gpu-load-error' | 'gpu-synthesis-error' | 'gpu-and-cpu-error' = 'normal';
  static onCreated: (() => void) | undefined;
  readonly mode = TestWorker.nextMode;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  requests: KokoroRequest[] = [];
  cpu = false;
  constructor() { TestWorker.instances.push(this); TestWorker.onCreated?.(); }
  postMessage(request: KokoroRequest) {
    if (this.mode === 'send-error') throw new Error('Worker message could not be sent');
    this.requests.push(request);
    if (request.type === 'load') this.cpu = request.device === 'wasm';
    if (this.mode === 'load-stall' || (this.mode === 'synthesis-stall' && request.type === 'synthesize')) return;
    if ((this.mode === 'gpu-load-error' || this.mode === 'gpu-and-cpu-error') && request.type === 'load' &&
      (!this.cpu || this.mode === 'gpu-and-cpu-error') ||
      this.mode === 'gpu-synthesis-error' && request.type === 'synthesize' && !this.cpu) {
      const reply: KokoroReply = { id: request.id, type: 'error', error: this.cpu ? 'CPU initialization failed' : 'GPU execution failed',
        backend: this.cpu ? 'wasm' : 'webgpu' };
      queueMicrotask(() => this.onmessage?.({ data: reply }));
      return;
    }
    const accelerated = this.mode.startsWith('gpu-');
    const reply: KokoroReply = request.type === 'load'
      ? { id: request.id, type: 'ready', ...(accelerated ? { runtime: { backend: this.cpu ? 'wasm' as const : 'webgpu' as const,
          wasmThreads: 1, crossOriginIsolated: false, reason: 'Verification host provider' } } : {}) }
      : { id: request.id, type: 'chunk', samples: new Float32Array([0.25, -0.25]), sampleRate: 24000 };
    queueMicrotask(() => this.onmessage?.({ data: reply }));
  }
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

async function settledWithin(promise: Promise<unknown>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => ({ state: 'resolved' as const }), (error: unknown) => ({ state: 'rejected' as const, error })),
      new Promise<{ state: 'hung' }>((resolve) => { timer = setTimeout(() => resolve({ state: 'hung' }), 500); }),
    ]).then((result) => {
      assert.notEqual(result.state, 'hung', `${label} settles without an error event from the living worker`);
      return result;
    });
  } finally { clearTimeout(timer); }
}

TestWorker.nextMode = 'load-stall';
const stalledLoad = new WebKokoroEngine('kokoro-q8', { loadTimeoutMs: 20, synthesisTimeoutMs: 20 });
try {
  const result = await settledWithin(stalledLoad.load(), 'stalled model initialization');
  assert.equal(result.state, 'rejected', 'stalled load rejects instead of reporting ready');
  if (result.state === 'rejected') assert.match(String(result.error), /load|initializ/i);
  assert.equal(stalledLoad.ready, false);
  const failed = TestWorker.instances.at(-1)!;
  assert.equal(failed.terminated, true, 'load deadline releases the wedged worker');
  TestWorker.nextMode = 'normal';
  await stalledLoad.load();
  assert.equal(stalledLoad.ready, true, 'model initialization retries on a fresh worker');
  assert.notEqual(TestWorker.instances.at(-1), failed);
  failed.onmessage!({ data: { id: failed.requests[0].id, type: 'ready' } });
  failed.onerror!({ message: 'Late stalled load error' });
  assert.equal(stalledLoad.ready, true, 'late failed load callbacks cannot invalidate the retry');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stalledLoad.ready, true, 'a successful load clears its deadline instead of expiring later');
} finally { stalledLoad.dispose(); }

TestWorker.nextMode = 'synthesis-stall';
const stalledSynthesis = new WebKokoroEngine('kokoro-q8', { loadTimeoutMs: 20, synthesisTimeoutMs: 20 });
try {
  await stalledSynthesis.load();
  const failed = TestWorker.instances.at(-1)!;
  const first = stalledSynthesis.synthesize('First pending sentence.', 'af_heart');
  const second = stalledSynthesis.synthesize('Second pending sentence.', 'af_heart');
  const results = await settledWithin(Promise.allSettled([first, second]), 'stalled synthesis requests');
  assert.equal(results.state, 'resolved');
  const outcomes = await Promise.allSettled([first, second]);
  assert(outcomes.every((outcome) => outcome.status === 'rejected'), 'every pending sentence rejects when its worker times out');
  for (const outcome of outcomes) if (outcome.status === 'rejected') assert.match(String(outcome.reason), /audio|synthes|timed out/i);
  assert.equal(stalledSynthesis.ready, false, 'timed-out synthesis clears model readiness');
  assert.equal(failed.terminated, true);
  TestWorker.nextMode = 'normal';
  const audio = await stalledSynthesis.synthesize('Retry this sentence.', 'af_heart');
  assert.deepEqual([...audio.samples], [0.25, -0.25], 'retry synthesizes actual returned audio on a fresh worker');
  assert.equal(audio.sampleRate, 24000);
  assert.notEqual(TestWorker.instances.at(-1), failed);
  const oldRequest = failed.requests.find((request) => request.type === 'synthesize')!;
  failed.onmessage!({ data: { id: oldRequest.id, type: 'chunk', samples: new Float32Array([1]), sampleRate: 1 } });
  failed.onerror!({ message: 'Late timed-out synthesis error' });
  assert.equal(stalledSynthesis.ready, true, 'stale synthesis replies and errors leave the replacement ready');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(stalledSynthesis.ready, true, 'successful audio clears its deadline instead of killing a ready worker');
} finally { stalledSynthesis.dispose(); }

TestWorker.nextMode = 'load-stall';
const immediateRetry = new WebKokoroEngine('kokoro-q8', { loadTimeoutMs: 100, synthesisTimeoutMs: 100 });
try {
  const created = new Promise<void>((resolve) => { TestWorker.onCreated = resolve; });
  const oldLoad = immediateRetry.load();
  const oldRejection = assert.rejects(oldLoad, /Failed during initialization/);
  await created;
  TestWorker.onCreated = undefined;
  const failed = TestWorker.instances.at(-1)!;
  failed.onerror!({ message: 'Failed during initialization' });
  TestWorker.nextMode = 'normal';
  const beforeRetry = TestWorker.instances.length;
  const retry = immediateRetry.load();
  await oldRejection;
  await Promise.all([retry, immediateRetry.load()]);
  assert.equal(immediateRetry.ready, true, 'an immediate retry survives the old load rejection handler');
  assert.equal(TestWorker.instances.length, beforeRetry + 1, 'parallel retry callers share one replacement worker');
} finally { TestWorker.onCreated = undefined; immediateRetry.dispose(); }

TestWorker.nextMode = 'send-error';
const sendFailure = new WebKokoroEngine('kokoro-q8', { loadTimeoutMs: 20, synthesisTimeoutMs: 20 });
try {
  await assert.rejects(sendFailure.load(), /could not be sent/);
  assert.equal(TestWorker.instances.at(-1)!.terminated, true, 'failed postMessage releases worker ownership');
  TestWorker.nextMode = 'normal';
  await sendFailure.load();
  assert.equal(sendFailure.ready, true, 'sending a request can be retried after failure');
} finally { sendFailure.dispose(); }

for (const file of modelFiles('kokoro-fp32')) await modelStore.complete(file.url, {
  url: file.url, bytes: file.sizeBytes, total: file.sizeBytes, complete: true, headers: {},
});
TestWorker.nextMode = 'gpu-load-error';
const initializationFallback = new WebKokoroEngine('kokoro-fp32');
try {
  const firstIndex = TestWorker.instances.length;
  await initializationFallback.load();
  assert.equal(initializationFallback.ready, true, 'GPU initialization failure recovers automatically on CPU');
  assert.equal(initializationFallback.runtime?.backend, 'wasm', 'reported provider reflects CPU fallback');
  assert.match(initializationFallback.runtime?.reason ?? '', /GPU.*fail|GPU.*unavailable/i);
  const failed = TestWorker.instances[firstIndex];
  const replacement = TestWorker.instances[firstIndex + 1];
  assert.equal(TestWorker.instances.length, firstIndex + 2, 'GPU failure creates exactly one fresh runtime');
  assert.equal(failed.terminated, true, 'a poisoned GPU runtime is released before CPU initialization');
  assert.equal(replacement.requests[0].cacheId, 'kokoro-fp32', 'CPU fallback preserves the selected model');
  assert.equal(replacement.requests[0].device, 'wasm');
  failed.onmessage!({ data: { id: failed.requests[0].id, type: 'ready', runtime: { backend: 'webgpu' } } });
  failed.onerror!({ message: 'Late GPU error' });
  assert.equal(initializationFallback.runtime?.backend, 'wasm', 'stale GPU callbacks cannot change CPU reporting');
} finally { initializationFallback.dispose(); }
assert.equal(initializationFallback.runtime, null, 'disposing clears the provider instead of claiming a running CPU/GPU');

TestWorker.nextMode = 'gpu-synthesis-error';
const inferenceFallback = new WebKokoroEngine('kokoro-fp32');
try {
  await inferenceFallback.load();
  assert.equal(inferenceFallback.runtime?.backend, 'webgpu', 'reported backend follows successful initialization');
  const firstIndex = TestWorker.instances.length;
  const chunks = await Promise.all([
    inferenceFallback.synthesize('Retry the GPU sentence on CPU.', 'af_heart'),
    inferenceFallback.synthesize('A second pending GPU sentence.', 'af_heart'),
  ]);
  for (const chunk of chunks) assert.deepEqual([...chunk.samples], [0.25, -0.25], 'retried sentences produce returned PCM');
  assert.equal(inferenceFallback.runtime?.backend, 'wasm', 'inference fallback updates backend reporting');
  assert.equal(TestWorker.instances.length, firstIndex + 1, 'pending GPU failures share one new CPU worker');
  assert.equal(TestWorker.instances[firstIndex - 1].terminated, true);
  assert.equal(TestWorker.instances[firstIndex].requests[0].device, 'wasm');
} finally { inferenceFallback.dispose(); }

TestWorker.nextMode = 'gpu-and-cpu-error';
const failedFallback = new WebKokoroEngine('kokoro-fp32');
try {
  const firstIndex = TestWorker.instances.length;
  await assert.rejects(failedFallback.load(), /CPU initialization failed/);
  assert.equal(failedFallback.ready, false);
  assert.equal(failedFallback.runtime, null);
  assert.equal(TestWorker.instances.length, firstIndex + 2, 'CPU failure is surfaced after one fallback, never retried forever');
} finally { failedFallback.dispose(); }

TestWorker.nextMode = 'load-stall';
const cancelledGpuFallback = new WebKokoroEngine('kokoro-fp32');
try {
  const created = new Promise<void>((resolve) => { TestWorker.onCreated = resolve; });
  const loading = cancelledGpuFallback.load();
  const rejection = assert.rejects(loading, /Cancelled GPU initialization/);
  await created;
  TestWorker.onCreated = undefined;
  const failed = TestWorker.instances.at(-1)!;
  const count = TestWorker.instances.length;
  failed.onmessage!({ data: { id: failed.requests[0].id, type: 'error', backend: 'webgpu', error: 'Cancelled GPU initialization' } });
  cancelledGpuFallback.dispose();
  await rejection;
  assert.equal(TestWorker.instances.length, count, 'cancelling between GPU failure and its retry prevents resurrection');
  assert.equal(cancelledGpuFallback.runtime, null);
} finally { TestWorker.onCreated = undefined; cancelledGpuFallback.dispose(); }

const hostNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15',
  platform: 'MacIntel', maxTouchPoints: 5,
} });
TestWorker.nextMode = 'normal';
const tablet = new WebKokoroEngine('kokoro-fp32');
try {
  await tablet.load();
  assert.equal(TestWorker.instances.at(-1)!.requests[0].mobile, true,
    'the app forwards tablet detection because WorkerNavigator lacks touch information');
} finally {
  tablet.dispose();
  if (hostNavigator) Object.defineProperty(globalThis, 'navigator', hostNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
}
console.log('Worker regressions passed: failure recovery, bounded load and synthesis, all pending request rejection, fresh-worker retry, stale callback isolation and disposal.');
