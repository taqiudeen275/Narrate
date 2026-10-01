import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';

// Substitute only hardware and heavyweight model loading. The worker's actual
// selection, queue, metadata and error protocol remain under test.
const client = { userAgent: 'Desktop verification host', platform: 'Win32', maxTouchPoints: 0,
  userAgentData: undefined as { mobile: boolean; platform?: string } | undefined, hardwareConcurrency: 8, gpu: undefined as unknown };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: client });
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
let device = '';
let dtype = '';
let loadFailure = false;
let runtimeReducedThreads = false;
const originalLoader = KokoroTTS.from_pretrained;
KokoroTTS.from_pretrained = async (_repo, options) => {
  device = options?.device ?? '';
  dtype = options?.dtype ?? '';
  if (loadFailure) throw new Error('GPU session could not initialize');
  if (runtimeReducedThreads) env.backends.onnx.wasm!.numThreads = 1;
  return { async generate() { return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24000 }; } } as unknown as KokoroTTS;
};
const waiting = new Map<number, (reply: any) => void>();
const scope = { onmessage: undefined as unknown as (event: { data: unknown }) => void,
  postMessage(reply: { id: number }) { waiting.get(reply.id)?.(reply); } };
Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
await import('../src/core/tts/kokoro.worker');
let nextId = 0;
function load(cacheId = 'kokoro-fp32', selected = 'auto', mobile?: boolean) {
  const id = ++nextId;
  return new Promise<any>((resolve) => {
    waiting.set(id, resolve);
    scope.onmessage({ data: { id, type: 'load', cacheId, device: selected, mobile } });
  }).finally(() => waiting.delete(id));
}
try {
  let created = 0;
  let released = 0;
  client.gpu = { async requestAdapter() { return { async requestDevice() {
    created++;
    return { destroy() { released++; } };
  } }; } };
  const gpu = await load();
  assert.equal(device, 'webgpu', 'a capable desktop uses WebGPU for the selected full-precision edition');
  assert.equal(dtype, 'fp32', 'acceleration preserves the selected weights');
  assert.equal(gpu.runtime.backend, 'webgpu', 'ready reports the initialized provider');
  assert.equal(created, 1, 'the probe verifies device creation beyond API presence');
  assert.equal(released, 1, 'the temporary probe device is released');

  client.gpu = undefined;
  const absent = await load();
  assert.equal(device, 'wasm', 'missing WebGPU keeps offline inference available');
  assert.equal(absent.runtime.backend, 'wasm');
  assert.equal(absent.runtime.wasmThreads, 1, 'unisolated hosts report one CPU thread');
  assert.match(absent.runtime.reason, /unavailable|support/i);

  client.gpu = { async requestAdapter() { return null; } };
  assert.equal((await load()).runtime.backend, 'wasm', 'a null hardware adapter safely uses CPU');
  client.gpu = { async requestAdapter() { throw new Error('Adapter denied'); } };
  assert.equal((await load()).runtime.backend, 'wasm', 'adapter rejection safely uses CPU');
  client.gpu = { async requestAdapter() { return { async requestDevice() { throw new Error('Device denied'); } }; } };
  assert.equal((await load()).runtime.backend, 'wasm', 'GPU device creation failure safely uses CPU');

  client.gpu = { async requestAdapter() { throw new Error('This model must not probe GPU'); } };
  for (const [cacheId, expectedDtype] of [['kokoro-q8', 'q8'], ['kokoro-q4', 'q4']]) {
    const reply = await load(cacheId);
    assert.equal(reply.runtime.backend, 'wasm', 'quantized editions remain on their supported runtime');
    assert.equal(dtype, expectedDtype, 'no alternate larger model is selected');
    assert.match(reply.runtime.reason, /quantiz|precision/i);
  }
  client.userAgent = 'Mozilla/5.0 (Linux; Android 14)';
  const mobile = await load();
  assert.equal(mobile.runtime.backend, 'wasm', 'known Android JSEP audio corruption is not enabled automatically');
  assert.match(mobile.runtime.reason, /mobile|Android/i);
  assert.match((await load('kokoro-q8')).runtime.reason, /mobile|Android/i,
    'the default phone edition explains the mobile restriction instead of implying that a larger edition unlocks GPU');
  client.gpu = { async requestAdapter() { return { async requestDevice() { return { destroy() {} }; } }; } };
  client.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15';
  client.platform = 'MacIntel';
  client.maxTouchPoints = 5;
  assert.equal((await load()).runtime.backend, 'wasm', 'iPad desktop-mode Safari remains guarded as mobile');
  client.maxTouchPoints = 0;
  assert.equal((await load('kokoro-fp32', 'auto', true)).runtime.backend, 'wasm',
    'a worker without touch information honors the app mobile hint');
  client.userAgent = 'Desktop verification host';
  client.platform = 'Win32';
  client.maxTouchPoints = 5;
  assert.equal((await load()).runtime.backend, 'webgpu', 'a touch-enabled desktop is still eligible for GPU');
  client.maxTouchPoints = 0;
  client.userAgentData = { mobile: true };
  assert.equal((await load()).runtime.backend, 'wasm', 'client hints can identify mobile without mobile user-agent tokens');
  client.userAgentData = { mobile: false, platform: 'Android' };
  assert.equal((await load()).runtime.backend, 'wasm', 'Android desktop mode remains mobile even when the mobile hint is false');
  client.userAgentData = undefined;
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false });
  assert.equal((await load()).runtime.backend, 'wasm', 'insecure origins do not attempt WebGPU');
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });

  assert.equal((await load('kokoro-fp32', 'wasm')).runtime.backend, 'wasm', 'forced CPU fallback never probes GPU');
  // Simulate host capabilities and ONNX's post-initialization flags; this checks
  // requested CPU limits/reporting and does not claim actual parallel inference.
  env.backends.onnx.wasm ??= {};
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  assert.equal((await load('kokoro-q8')).runtime.wasmThreads, 4, 'an isolated eight-core host requests bounded CPU parallelism');
  client.hardwareConcurrency = 3;
  assert.equal((await load('kokoro-q8')).runtime.wasmThreads, 2, 'odd core counts leave CPU headroom');
  runtimeReducedThreads = true;
  assert.equal((await load('kokoro-q8')).runtime.wasmThreads, 1, 'reporting reflects ONNX capability fallback after initialization');
  runtimeReducedThreads = false;
  const sharedMemory = globalThis.SharedArrayBuffer;
  Object.defineProperty(globalThis, 'SharedArrayBuffer', { configurable: true, value: undefined });
  try {
    assert.equal((await load('kokoro-q8')).runtime.wasmThreads, 1, 'isolation without shared memory never requests CPU threads');
  } finally { Object.defineProperty(globalThis, 'SharedArrayBuffer', { configurable: true, value: sharedMemory }); }
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
  client.gpu = { async requestAdapter() { return { async requestDevice() { return { destroy() {} }; } }; } };
  loadFailure = true;
  const failed = await load();
  assert.equal(failed.type, 'error');
  assert.equal(failed.backend, 'webgpu', 'GPU session failure is tagged so the host can restart the poisoned runtime');
  assert.match(failed.error, /session/i);
} finally { KokoroTTS.from_pretrained = originalLoader; }
console.log('Acceleration selection regressions passed: real worker selection, capability/device rejection, model and mobile guards, selected dtype preservation and tagged initialization failure. Hardware and inference are substituted; no real GPU speed is measured.');
