import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import type { KokoroBackend } from '../src/core/tts/worker-types';

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
let generationOutput = { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24000 };
const transfers = new Map<number, Transferable[] | undefined>();
const phases: { id: number; type: 'backend'; backend: KokoroBackend }[] = [];
let providerReportedBeforeLoad = false;
const originalLoader = KokoroTTS.from_pretrained;
KokoroTTS.from_pretrained = async (_repo, options) => {
  device = options?.device ?? '';
  dtype = options?.dtype ?? '';
  providerReportedBeforeLoad = phases.at(-1)?.id === nextId && phases.at(-1)?.backend === device;
  if (loadFailure) throw new Error('GPU session could not initialize');
  if (runtimeReducedThreads) env.backends.onnx.wasm!.numThreads = 1;
  return { async generate() { return generationOutput; } } as unknown as KokoroTTS;
};
const waiting = new Map<number, (reply: any) => void>();
const scope = { onmessage: undefined as unknown as (event: { data: unknown }) => void,
  postMessage(reply: { id: number; type: string; backend?: KokoroBackend }, transfer?: Transferable[]) {
    transfers.set(reply.id, transfer);
    if (reply.type === 'backend') phases.push(reply as (typeof phases)[number]);
    else waiting.get(reply.id)?.(reply);
  } };
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
function synthesize() {
  const id = ++nextId;
  return new Promise<any>((resolve) => {
    waiting.set(id, resolve);
    scope.onmessage({ data: { id, type: 'synthesize', text: 'Validate the returned audio.', voiceId: 'af_heart', speed: 1 } });
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
  assert.equal(gpu.runtime.wasmThreads, 1, 'the native GPU runtime reports its single-thread CPU support');
  assert.equal(providerReportedBeforeLoad, true, 'worker announces its GPU provider before model initialization can stall');
  assert.equal(created, 1, 'the probe verifies device creation beyond API presence');
  assert.equal(released, 1, 'the temporary probe device is released');
  const chunk = await synthesize();
  assert.equal(chunk.type, 'chunk', 'valid inference output produces a chunk');
  assert.deepEqual(chunk.samples, new Float32Array([0.1, -0.1]), 'the worker preserves valid PCM samples');
  assert.equal(chunk.sampleRate, 24000, 'the worker preserves the inference sample rate');
  assert.deepEqual(transfers.get(chunk.id), [generationOutput.audio.buffer], 'valid PCM ownership transfers to the host');

  client.gpu = undefined;
  const absent = await load();
  assert.equal(device, 'wasm', 'missing WebGPU keeps offline inference available');
  assert.equal(absent.runtime.backend, 'wasm');
  assert.equal(providerReportedBeforeLoad, true, 'CPU initialization also reports its selected provider before loading');
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
  client.gpu = { async requestAdapter() { return { async requestDevice() { return { destroy() {} }; } }; } };
  client.userAgent = 'Mozilla/5.0 (Linux; Android 14)';
  const mobile = await load();
  assert.equal(mobile.runtime.backend, 'webgpu', 'the native ONNX GPU backend accepts a capable Android host');
  assert.equal(device, 'webgpu');
  assert.equal(dtype, 'fp32', 'mobile acceleration preserves the selected full-precision edition');
  const mobileQuantized = await load('kokoro-q8');
  assert.equal(mobileQuantized.runtime.backend, 'wasm', 'mobile quantized weights stay on their supported provider');
  assert.equal(dtype, 'q8');
  assert.match(mobileQuantized.runtime.reason, /quantiz|precision/i,
    'mobile CPU selection explains the selected weights rather than blanket-blocking phone hardware');
  client.gpu = undefined;
  assert.equal((await load()).runtime.backend, 'wasm', 'Android without WebGPU keeps offline CPU inference available');
  client.gpu = { async requestAdapter() { return { async requestDevice() { throw new Error('Mobile device denied'); } }; } };
  assert.equal((await load()).runtime.backend, 'wasm', 'Android GPU device rejection safely uses CPU');
  client.gpu = { async requestAdapter() { return { async requestDevice() { return { destroy() {} }; } }; } };
  client.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15';
  client.platform = 'MacIntel';
  client.maxTouchPoints = 5;
  assert.equal((await load()).runtime.backend, 'webgpu', 'capable iPad desktop-mode Safari can initialize the native GPU backend');
  client.maxTouchPoints = 0;
  assert.equal((await load('kokoro-fp32', 'auto', true)).runtime.backend, 'webgpu',
    'the app mobile hint does not blanket-block a capable GPU after migration');
  client.userAgent = 'Desktop verification host';
  client.platform = 'Win32';
  client.maxTouchPoints = 5;
  assert.equal((await load()).runtime.backend, 'webgpu', 'a touch-enabled desktop is still eligible for GPU');
  client.maxTouchPoints = 0;
  client.userAgentData = { mobile: true };
  assert.equal((await load()).runtime.backend, 'webgpu', 'mobile client hints do not bypass GPU capability probing');
  client.userAgentData = { mobile: false, platform: 'Android' };
  assert.equal((await load()).runtime.backend, 'webgpu', 'capable Android desktop mode can use native GPU inference');
  client.userAgentData = undefined;
  // Accelerate only the capability deadline; an alive-but-wedged GPU probe
  // must select CPU before heavyweight initialization starts.
  const originalTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) =>
    originalTimeout(callback, delay === 10_000 ? 10 : delay, ...args)) as typeof setTimeout;
  let lateDeviceReleased = 0;
  let probeDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    client.gpu = { requestAdapter() { return new Promise(() => undefined); } };
    const stalled = await Promise.race([load(), new Promise<never>((_, reject) => {
      probeDeadline = originalTimeout(() => reject(new Error('Stalled GPU capability probe did not fall back to CPU')), 300);
    })]);
    assert.equal(stalled.runtime.backend, 'wasm', 'a stalled adapter probe selects CPU');
    assert.match(stalled.runtime.reason, /timed out/i);
    client.gpu = { async requestAdapter() { return { async requestDevice() {
      await new Promise(resolve => originalTimeout(resolve, 30));
      return { destroy() { lateDeviceReleased++; } };
    } }; } };
    const stalledDevice = await load();
    assert.equal(stalledDevice.runtime.backend, 'wasm', 'a stalled device probe selects CPU');
    await new Promise(resolve => originalTimeout(resolve, 45));
    assert.equal(lateDeviceReleased, 1, 'a probe device arriving after its deadline is released');
  } finally { clearTimeout(probeDeadline); globalThis.setTimeout = originalTimeout; }
  client.gpu = { async requestAdapter() { return { async requestDevice() { return { destroy() {} }; } }; } };
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
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: true });
  assert.equal((await load()).runtime.wasmThreads, 1, 'native GPU initialization remains single-threaded on an isolated host');
  Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
  loadFailure = true;
  const failed = await load();
  assert.equal(failed.type, 'error');
  assert.equal(failed.backend, 'webgpu', 'GPU session failure is tagged so the host can restart the poisoned runtime');
  assert.match(failed.error, /session/i);
  loadFailure = false;
  for (const [selection, expectedBackend] of [['auto', 'webgpu'], ['wasm', 'wasm']] as const) {
    await load('kokoro-fp32', selection);
    for (const invalid of [
      { label: 'empty PCM', audio: new Float32Array(), sampling_rate: 24000 },
      { label: 'NaN PCM', audio: new Float32Array([NaN]), sampling_rate: 24000 },
      { label: 'infinite PCM', audio: new Float32Array([Infinity]), sampling_rate: 24000 },
      { label: 'runaway finite PCM', audio: new Float32Array([10000, -10000]), sampling_rate: 24000 },
      { label: 'sustained overload', audio: new Float32Array([2, -2, 2, -2]), sampling_rate: 24000 },
      { label: 'zero sample rate', audio: new Float32Array([0.25]), sampling_rate: 0 },
      { label: 'negative sample rate', audio: new Float32Array([0.25]), sampling_rate: -1 },
      { label: 'NaN sample rate', audio: new Float32Array([0.25]), sampling_rate: NaN },
      { label: 'infinite sample rate', audio: new Float32Array([0.25]), sampling_rate: Infinity },
      { label: 'untyped PCM', audio: [0.25], sampling_rate: 24000 },
    ]) {
      generationOutput = invalid as typeof generationOutput;
      const reply = await synthesize();
      assert.equal(reply.type, 'error', `${invalid.label} is rejected before audio can be persisted or played`);
      assert.equal(reply.backend, expectedBackend, `${invalid.label} error identifies the provider for safe host recovery`);
      assert.match(reply.error, /audio|sample|finite|invalid/i);
      assert.equal(transfers.get(reply.id), undefined, `${invalid.label} never transfers invalid PCM to the host`);
    }
    generationOutput = { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24000 };
    const recovered = await synthesize();
    assert.equal(recovered.type, 'chunk', 'a validation rejection does not poison the worker message queue');
    assert.deepEqual(recovered.samples, new Float32Array([0.1, -0.1]));
    generationOutput = { audio: new Float32Array([1.05, -1.05, ...Array(100).fill(0.05)]), sampling_rate: 24000 };
    assert.equal((await synthesize()).type, 'chunk', 'isolated slight overshoot is allowed rather than treated as a corrupt signal');
    generationOutput = { audio: new Float32Array(100), sampling_rate: 24000 };
    assert.equal((await synthesize()).type, 'chunk', 'a silent sentence is not rejected as noise');
  }
} finally { KokoroTTS.from_pretrained = originalLoader; }
console.log('Acceleration selection regressions passed: real worker selection, desktop/mobile capability and device rejection, quantized model guards, selected dtype preservation and tagged initialization failure. Hardware and inference are substituted; no real GPU audio quality or speed is measured.');
