import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { KokoroReply, KokoroRequest } from '../src/core/tts/worker-types';

// This catches a stale/default engine after a real model-selection click, a
// fresh import or deletion, and incorrect edition metadata in Work history.
// Keep the store, player, React views, engine and worker handler real. Replace
// only the worker host, downloaded bytes, hardware, and heavyweight inference.
// The IndexedDB database belongs to this Node process, not the installed app.
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('Network disabled for model-selection verification'); };
// Load Node dependencies before advertising a DOM to environment detectors.
const { KokoroTTS } = await import('kokoro-js');
const { MODEL_VARIANTS, modelFiles, modelStore, refreshModelInstalls } = await import('../src/core/tts/downloads');
const { WebKokoroEngine } = await import('../src/core/tts/web');
const { storage } = await import('../src/state/persistence');
const { APP_VERSION } = await import('../src/version');
const { useNarrate } = await import('../src/state/store');
const { ModelsView } = await import('../src/views/ModelsView');
const { GenerationView } = await import('../src/views/GenerationView');
const { window } = parseHTML('<html><body><div id="test"></div></body></html>');
Object.assign(globalThis, { window, document: window.document, HTMLElement: window.HTMLElement,
  self: window, IS_REACT_ACT_ENVIRONMENT: true });
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame = id => clearTimeout(id);
// Keep the real Player's scheduling and PCM assembly; substitute its audio
// hardware so partial saved playback is observable without a speaker device.
type LocalAudioBuffer = { getChannelData(channel: number): Float32Array };
class LocalAudioSource {
  buffer: LocalAudioBuffer | null = null;
  onended: (() => void) | null = null;
  connect() {}
  disconnect() {}
  start() { LocalAudioContext.played.push(this.buffer!.getChannelData(0).slice()); }
  stop() {}
}
class LocalAudioContext {
  static played: Float32Array[] = [];
  currentTime = 10;
  state = 'running';
  destination = {};
  createGain() { return { connect() {} }; }
  createBuffer(_channels: number, length: number, _sampleRate: number): LocalAudioBuffer {
    const samples = new Float32Array(length);
    return { getChannelData: () => samples };
  }
  createBufferSource() { return new LocalAudioSource(); }
  async resume() { this.state = 'running'; }
}
globalThis.AudioContext = LocalAudioContext as unknown as typeof AudioContext;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S901B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36',
  platform: 'Linux armv8l', maxTouchPoints: 5, hardwareConcurrency: 8, deviceMemory: 8,
} });
Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: true });
Object.defineProperty(globalThis, 'crossOriginIsolated', { configurable: true, value: false });
globalThis.caches = { async open() { return { async match() { return new Response('substituted model bytes'); } }; } } as unknown as CacheStorage;
for (const variant of MODEL_VARIANTS) for (const file of modelFiles(variant.cacheId)) {
  await modelStore.complete(file.url, { url: file.url, bytes: file.sizeBytes, total: file.sizeBytes,
    complete: true, headers: {} });
}
await refreshModelInstalls();

interface LoadEvidence { worker: LocalWorker; request: KokoroRequest; dtype?: string; device?: string }
const loads: LoadEvidence[] = [];
const generated: { cacheId: string; dtype: string; text: string; voice: string; speed: number }[] = [];
let inferenceGate: { text: string; reached: () => void; wait: Promise<void> } | null = null;
const originalLoader = KokoroTTS.from_pretrained;
KokoroTTS.from_pretrained = async (_repo, options) => {
  const load = loads.findLast(entry => entry.dtype === undefined)!;
  assert.ok(load, 'the actual worker receives a load request before initializing Kokoro');
  load.dtype = options?.dtype;
  load.device = options?.device;
  return { async generate(text: string, options: { voice: string; speed: number }) {
    generated.push({ cacheId: load.request.cacheId!, dtype: load.dtype!, text, voice: options.voice, speed: options.speed });
    if (inferenceGate?.text === text) { inferenceGate.reached(); await inferenceGate.wait; }
    return { audio: new Float32Array([0.1, -0.1]), sampling_rate: 24000 };
  } } as unknown as InstanceType<typeof KokoroTTS>;
};

// Run the actual worker handler in this process. Globally unique request IDs
// route replies to each WebKokoroEngine without changing its own protocol.
// Scenarios are sequential; this bridge does not test worker isolation or GPU.
let nextBridgeId = 0;
const pending = new Map<number, { worker: LocalWorker; localId: number }>();
const scope = {
  onmessage: undefined as unknown as (event: { data: KokoroRequest }) => void,
  postMessage(reply: KokoroReply) {
    const owner = pending.get(reply.id);
    if (!owner) return;
    if (reply.type !== 'backend') pending.delete(reply.id);
    if (!owner.worker.terminated) owner.worker.onmessage?.({ data: { ...reply, id: owner.localId } });
  },
};
Object.defineProperty(globalThis, 'self', { configurable: true, value: scope });
await import('../src/core/tts/kokoro.worker');
class LocalWorker {
  static instances: LocalWorker[] = [];
  onmessage: ((event: { data: KokoroReply }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminated = false;
  requests: KokoroRequest[] = [];
  constructor() { LocalWorker.instances.push(this); }
  postMessage(request: KokoroRequest) {
    this.requests.push({ ...request });
    if (request.type === 'load') loads.push({ worker: this, request: { ...request } });
    const id = ++nextBridgeId;
    pending.set(id, { worker: this, localId: request.id });
    scope.onmessage({ data: { ...request, id } });
  }
  terminate() {
    this.terminated = true;
    for (const [id, owner] of pending) if (owner.worker === this) pending.delete(id);
  }
}
globalThis.Worker = LocalWorker as unknown as typeof Worker;

const root = createRoot(window.document.getElementById('test')!);
const render = async (view: React.ReactNode) => { await act(async () => root.render(view)); };
const run = async <T,>(action: () => Promise<T>): Promise<T> => {
  let result!: T;
  await act(async () => { result = await action(); });
  return result;
};
const until = async (condition: () => boolean, label: string) => {
  const deadline = performance.now() + 3000;
  while (!condition() && performance.now() < deadline) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  assert.ok(condition(), label);
};
const card = (name: string) => {
  const result = Array.from(window.document.querySelectorAll('.n-model-card'))
    .find(item => item.querySelector('h3')?.textContent?.startsWith(name));
  assert.ok(result, `the real Models view contains ${name}`);
  return result;
};
const control = (parent: ParentNode, text: string) => {
  const result = Array.from(parent.querySelectorAll('button')).find(item => item.textContent === text);
  assert.ok(result, `the real view exposes ${text}`);
  assert.equal(result.hasAttribute('disabled'), false, `${text} is enabled`);
  return result;
};
const click = async (element: Element) => {
  await act(async () => { element.dispatchEvent(new window.Event('click', { bubbles: true })); });
};
const open = (name: string, text = 'This edition must stay selected. Reimport the same file.') =>
  run(async () => {
    const opened = await useNarrate.getState().openBuffer(name, new TextEncoder().encode(text).buffer);
    assert.equal(opened, true, `import ${name}: ${useNarrate.getState().error ?? useNarrate.getState().status}`);
    return opened;
  });
const detailText = (row: ParentNode, label: string) => Array.from(row.querySelectorAll('.n-job-details > div'))
  .find(item => item.querySelector('dt')?.textContent === label)?.querySelector('dd')?.textContent;
const generationModelLabels = () => Array.from(window.document.querySelectorAll('.n-job'))
  .map(row => detailText(row, 'Model'));
const assertJob = async (modelId: string, label: string, docId: string) => {
  const job = useNarrate.getState().generationJobs[0];
  assert.equal(job.docId, docId, 'the newest attempt belongs to the requested document');
  assert.equal(job.modelId, modelId, 'the actual generation records the chosen edition');
  assert.equal(job.requestedModelId, modelId, 'the attempt records the model explicitly requested at generation start');
  assert.equal(job.runtime?.backend, 'wasm', 'the attempt records the provider actually reported by this CPU worker');
  assert.equal(job.runtime?.wasmThreads, 1, 'the attempt records the real unisolated worker thread count');
  assert.equal(job.runtime?.crossOriginIsolated, false);
  assert.equal(job.appVersion, APP_VERSION, 'new attempts identify the current app version');
  assert.notEqual(job.runtime, useNarrate.getState().engine.runtime, 'the attempt stores an independent runtime snapshot');
  assert.equal(job.status, 'completed', 'the worker path completes narration');
  assert.equal(job.completedSentences, job.totalSentences, 'the attempt saves every sentence');
  const saved = (await storage.load()).jobs.find(item => item.id === job.id)!;
  assert.equal(saved.modelId, modelId, 'persisted Work history keeps the same edition');
  assert.equal(saved.requestedModelId, modelId, 'persisted Work history keeps the requested edition');
  assert.equal(saved.runtime?.backend, 'wasm', 'persisted Work history keeps the actual provider');
  assert.equal(saved.runtime?.wasmThreads, 1);
  assert.equal(saved.appVersion, APP_VERSION);
  assert.equal(saved.runtime?.reason, job.runtime?.reason, 'persistence retains the actual runtime explanation');
  assert.equal(saved.status, 'completed');
  assert.equal(useNarrate.getState().library.find(item => item.id === docId)?.narration?.modelId, modelId,
    'saved Library narration records the same edition');
  await render(createElement(GenerationView));
  assert.equal(generationModelLabels()[0], label, 'the actual Work row displays the newest attempt edition');
  const row = window.document.querySelector('.n-job')!;
  assert.equal(detailText(row, 'Requested model'), label, 'Work displays the edition requested when this attempt started');
  assert.equal(detailText(row, 'Generation backend'), 'CPU · 1 thread', 'Work displays the backend saved for this attempt');
  assert.equal(detailText(row, 'App version'), APP_VERSION, 'Work displays the app version saved for this attempt');
  assert.ok(row.textContent?.includes(job.runtime!.reason), 'Work displays the saved backend explanation');
};
const selectAndLoad = async (modelId: string, label: string, dtype: string) => {
  await render(createElement(ModelsView));
  await click(control(card(label), 'Use this model'));
  await until(() => useNarrate.getState().selectedModel === modelId, 'the UI selects the requested edition');
  assert.ok(useNarrate.getState().engine instanceof WebKokoroEngine, 'selection creates the real WebKokoroEngine');
  assert.equal(useNarrate.getState().engine.id, modelId);
  assert.equal((await storage.load()).preferences?.selectedModel, modelId, 'the real click persists selection');
  const before = loads.length;
  await click(control(card(label), 'Load model'));
  await until(() => useNarrate.getState().engineReady, 'the requested model finishes loading');
  assert.equal(loads.length, before + 1, 'loading creates one worker load request');
  assert.equal(loads.at(-1)!.request.cacheId, modelId, 'the real engine sends the chosen cache ID to the worker');
  assert.equal(loads.at(-1)!.request.mobile, true, 'the phone hint reaches the worker');
  assert.equal(loads.at(-1)!.dtype, dtype, 'the actual worker initializes the chosen weight precision');
  assert.equal(useNarrate.getState().selectedModel, modelId);
  assert.equal(useNarrate.getState().engine.ready, true);
  assert.ok(Array.from(card(label).querySelectorAll('button')).some(item => item.textContent === 'Selected'),
    'Models displays the chosen edition as selected');
};

const restartedEngines: InstanceType<typeof WebKokoroEngine>[] = [];
const assertRestart = async (modelId: string) => {
  // A fresh evaluation creates a new store, while the real persistence module
  // reads the same isolated IndexedDB records saved by the selection action.
  const restarted = await import(`../src/state/store.ts?model-selection-restart=${modelId}`) as typeof import('../src/state/store');
  assert.notEqual(restarted.useNarrate, useNarrate, 'restart uses a distinct store instance');
  assert.equal(restarted.useNarrate.getState().hydrated, false);
  assert.equal(restarted.useNarrate.getState().selectedModel, 'kokoro-q8', 'the new store starts at its default');
  await restarted.useNarrate.getState().hydrate();
  const state = restarted.useNarrate.getState();
  assert.equal(state.selectedModel, modelId, 'startup restores the preference written by the real UI click');
  assert.ok(state.engine instanceof WebKokoroEngine);
  assert.equal(state.engine.id, modelId, 'startup constructs the matching real engine');
  assert.equal(state.engineReady, false, 'startup leaves inference unloaded until needed');
  assert.equal(state.doc, null, 'startup does not reopen an older document and change selection');
  restartedEngines.push(state.engine as InstanceType<typeof WebKokoroEngine>);
};

try {
  await run(() => useNarrate.getState().hydrate());
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-q8');
  assert.ok(useNarrate.getState().engine instanceof WebKokoroEngine);
  assert.equal(await open('samefile.txt'), true);
  const oldDocId = useNarrate.getState().activeDocId!;
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-q8', 'Kokoro · Balanced', oldDocId);
  assert.equal(loads[0].request.cacheId, 'kokoro-q8');
  assert.equal(loads[0].dtype, 'q8', 'a fresh default import uses the default quantized weights');
  console.log('ok fresh default import: worker=q8, saved job=kokoro-q8, Work=Kokoro · Balanced');

  assert.equal(await open('saved-balanced.txt', 'This saved narration keeps its balanced audio.'), true);
  const savedBalancedId = useNarrate.getState().activeDocId!;
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-q8', 'Kokoro · Balanced', savedBalancedId);

  // Stop a genuine store run after its first sentence is persisted, while
  // heavyweight inference for the second sentence waits at its boundary.
  assert.equal(await open('partial-balanced.txt', 'A saved Balanced prefix. Await this second sentence.'), true);
  const partialBalancedId = useNarrate.getState().activeDocId!;
  let reachedSecond!: () => void;
  let releaseSecond!: () => void;
  const secondReached = new Promise<void>(resolve => { reachedSecond = resolve; });
  inferenceGate = { text: 'Await this second sentence.', reached: reachedSecond,
    wait: new Promise<void>(resolve => { releaseSecond = resolve; }) };
  await act(async () => {
    const partialRun = useNarrate.getState().generate('full');
    await secondReached;
    assert.equal(useNarrate.getState().renderedCount, 1, 'the first Balanced sentence is saved before Stop');
    useNarrate.getState().cancel!();
    releaseSecond();
    await partialRun;
  });
  inferenceGate = null;
  assert.equal(useNarrate.getState().generationJobs[0].status, 'cancelled');
  const partialKey = storage.narrationKey(partialBalancedId, 'kokoro-q8', useNarrate.getState().voiceId, useNarrate.getState().speed);
  const partialSaved = await storage.loadNarration(partialKey);
  assert.equal(partialSaved.length, 1, 'the stopped narration persists only its Balanced prefix');

  await selectAndLoad('kokoro-fp32', 'Kokoro · Full precision', 'fp32');
  const selectedEngine = useNarrate.getState().engine;
  const loadCount = loads.length;
  await run(() => useNarrate.getState().openLibraryDoc(partialBalancedId));
  assert.equal(useNarrate.getState().renderedCount, 1);
  assert.equal(useNarrate.getState().doc!.sentences.length, 2);
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q8');
  const beforePartialPlay = generated.length;
  const beforePartialPlayJobs = useNarrate.getState().generationJobs.length;
  const beforePlaybackBuffers = LocalAudioContext.played.length;
  await run(() => useNarrate.getState().toggle());
  assert.equal(generated.length, beforePartialPlay, 'Play of a partial saved Balanced prefix must not generate Full precision PCM');
  assert.equal(loads.length, loadCount, 'playing the saved prefix requires no inference model load');
  assert.equal(useNarrate.getState().generationJobs.length, beforePartialPlayJobs, 'playing the saved prefix creates no generation attempt');
  assert.equal(useNarrate.getState().renderedCount, 1, 'Play retains the partial saved timeline');
  assert.equal(useNarrate.getState().player.segments.length, 1);
  assert.equal(useNarrate.getState().player.isRunning, true, 'Play schedules the saved Balanced PCM');
  assert.equal(LocalAudioContext.played.length, beforePlaybackBuffers + 1, 'the real Player schedules only the saved sentence');
  assert.deepEqual(LocalAudioContext.played.at(-1)!.subarray(0, partialSaved[0].samples.length), partialSaved[0].samples,
    'the audio hardware receives the persisted Balanced PCM');
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q8', 'partial playback retains the Balanced PCM profile');
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-fp32', 'partial playback retains the explicit Full precision selection');
  assert.equal(useNarrate.getState().engine, selectedEngine, 'partial playback retains the loaded Full precision engine');
  await run(() => useNarrate.getState().toggle());
  assert.equal(useNarrate.getState().player.isRunning, false, 'Pause stops the saved prefix without generation');
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-fp32', 'Kokoro · Full precision', partialBalancedId);
  assert.equal(generated.length, beforePartialPlay + 2, 'explicit Generate still renders both sentences with selected fp32');
  assert.ok(generated.slice(-2).every(item => item.dtype === 'fp32'));
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-fp32');
  console.log('ok partial saved Balanced PCM → Play under selected Full precision: saved PCM plays without inference; explicit Generate uses fp32');
  const generatedCount = generated.length;
  await run(() => useNarrate.getState().openLibraryDoc(oldDocId));
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-fp32', 'opening old saved Balanced audio keeps the explicitly selected Full precision edition');
  assert.equal(useNarrate.getState().engine, selectedEngine, 'opening saved audio retains the chosen loaded inference engine');
  assert.equal(useNarrate.getState().renderedCount, 2, 'opening saved Balanced audio restores its PCM without inference');
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q8', 'saved playback keeps its recorded Balanced profile');
  assert.equal(generated.length, generatedCount, 'saved audio opens without generating new PCM');
  assert.equal(loads.length, loadCount, 'saved audio opens without loading another model');
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-fp32', 'Kokoro · Full precision', oldDocId);
  assert.equal(generated.length, generatedCount + 2, 'explicit generation renders the chosen edition instead of reusing the old Balanced PCM');
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-fp32', 'new Full precision PCM updates the playback profile');
  console.log('ok Full precision selection → open saved Balanced PCM → generate: selection and loaded engine retained; saved PCM uses zero inference; next attempt uses fp32');
  await run(() => useNarrate.getState().removeDoc(oldDocId));
  assert.equal(await storage.loadDocument(oldDocId), undefined, 'deletion removes the old document');
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-fp32', 'deletion retains Full precision selection');
  assert.equal(useNarrate.getState().engine, selectedEngine, 'deletion retains the already loaded engine');
  assert.equal(selectedEngine.ready, true);
  assert.equal(await open('samefile.txt'), true);
  const newDocId = useNarrate.getState().activeDocId!;
  assert.notEqual(newDocId, oldDocId, 'same-file reimport is a fresh document');
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-fp32', 'same-file reimport retains selection');
  assert.equal(useNarrate.getState().engine, selectedEngine, 'same-file reimport retains the loaded engine');
  assert.equal(useNarrate.getState().engineReady, true);
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-fp32', 'Kokoro · Full precision', newDocId);
  assert.equal(loads.length, loadCount, 'reimport uses the already loaded Full precision worker');
  assert.ok(generated.slice(-2).every(item => item.cacheId === 'kokoro-fp32' && item.dtype === 'fp32'),
    'the same-file narration uses the actual worker loaded with fp32');
  assert.ok(generationModelLabels().includes('Kokoro · Balanced'), 'Work retains the older Balanced attempts with their actual edition');
  assert.ok(Array.from(window.document.querySelectorAll('.n-job')).some(row =>
    row.textContent?.includes('Kokoro · Balanced') && row.textContent.includes('Document removed from Library')),
  'the removed original document keeps its historical Balanced attempt');
  await assertRestart('kokoro-fp32');
  console.log('ok loaded Full precision → delete → same-file reimport → generate: worker=fp32, saved job=kokoro-fp32, newest Work=Kokoro · Full precision; restart retained preference');

  assert.equal(await open('fresh-full-precision.txt', 'A new unrelated file uses the chosen full precision model.'), true);
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-fp32', 'Kokoro · Full precision', useNarrate.getState().activeDocId!);
  console.log('ok fresh unrelated import after selection: worker=fp32, saved job=kokoro-fp32, Work=Kokoro · Full precision');

  await selectAndLoad('kokoro-q4', 'Kokoro · 4-bit edition', 'q4');
  const fourBitEngine = useNarrate.getState().engine;
  const beforeFourBitGeneration = generated.length;
  const beforeFourBitLoad = loads.length;
  await run(() => useNarrate.getState().openLibraryDoc(savedBalancedId));
  assert.equal(useNarrate.getState().selectedModel, 'kokoro-q4', 'opening older saved audio keeps the explicit 4-bit selection');
  assert.equal(useNarrate.getState().engine, fourBitEngine, 'opening older saved audio retains the loaded 4-bit engine');
  assert.equal(useNarrate.getState().renderedCount, 1, 'opening saved audio restores its complete PCM');
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q8');
  assert.equal(generated.length, beforeFourBitGeneration, 'opening saved audio requires no inference');
  assert.equal(loads.length, beforeFourBitLoad, 'opening saved audio requires no alternate model load');
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-q4', 'Kokoro · 4-bit edition', savedBalancedId);
  assert.equal(generated.length, beforeFourBitGeneration + 1, 'the next explicit generation renders selected q4 weights');
  assert.equal(generated.at(-1)!.dtype, 'q4');
  assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q4');
  console.log('ok 4-bit selection → open saved Balanced PCM → generate: selection and loaded engine retained; saved PCM uses zero inference; next attempt uses q4');
  assert.equal(await open('fresh-four-bit.txt', 'A new file uses the selected four bit model.'), true);
  await run(() => useNarrate.getState().generate('full'));
  await assertJob('kokoro-q4', 'Kokoro · 4-bit edition', useNarrate.getState().activeDocId!);
  assert.equal(generated.at(-1)!.dtype, 'q4');
  await assertRestart('kokoro-q4');
  assert.equal(networkRequests, 0, 'the regression is local and does not download models');
  console.log('ok real 4-bit selection → fresh import: worker=q4, saved job=kokoro-q4, Work=Kokoro · 4-bit edition; restart retained preference');
  console.log('Model-selection regressions passed: explicit selection survives saved playback, fresh import and same-file reimport; generation, Work labels and restart preferences agree. Real UI/store/player/engine/worker metadata and persistence were exercised; model bytes, inference and worker isolation/hardware were substituted. No installed Android build was exercised.');
} finally {
  await render(null);
  await act(async () => root.unmount());
  useNarrate.getState().player.pause();
  useNarrate.getState().engine.dispose();
  for (const engine of restartedEngines) engine.dispose();
  KokoroTTS.from_pretrained = originalLoader;
}
