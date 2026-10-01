import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { useNarrate } from '../src/state/store';
import type { Segment, Player } from '../src/core/audio/player';
import type { TtsEngine } from '../src/core/tts/engine';
import { EDGE_PAD, SENTENCE_GAP } from '../src/core/tts/engine';

class TestPlayer {
  segments: Segment[] = [];
  isRunning = false;
  position = 0;
  get renderedCount() { return this.segments.length; }
  get duration() {
    const last = this.segments.at(-1);
    return last ? last.start + last.duration + EDGE_PAD : 0;
  }
  time() { return this.position; }
  pause() { this.isRunning = false; }
  setTimeline(segments: Segment[]) { this.segments = segments; this.position = 0; this.pause(); }
  putSentence(sentenceIndex: number, samples: Float32Array, sampleRate: number) {
    const last = this.segments.at(-1);
    this.segments.push({ sentenceIndex, samples, sampleRate, duration: samples.length / sampleRate,
      start: last ? last.start + last.duration + SENTENCE_GAP : EDGE_PAD });
  }
  async play(from = 0) { this.position = from; this.isRunning = true; }
  async toggle() { this.isRunning = !this.isRunning; }
  seek(from: number) { this.position = from; }
  hasSentence(index: number) { return this.segments.some(s => s.sentenceIndex === index); }
  segmentAt(time: number) { return this.segments.find(s => time >= s.start && time < s.start + s.duration) ?? null; }
  toExportChunks() { return { chunks: this.segments.map(s => s.samples), sampleRate: 10 }; }
}

let calls = 0;
let beforeSynthesis: (() => Promise<void>) | null = null;
const engine: TtsEngine = {
  id: 'test-engine', name: 'Test engine', ready: true,
  async load() {}, voices: () => [], dispose() {},
  async synthesize() {
    calls++;
    await beforeSynthesis?.();
    return { samples: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]), sampleRate: 10, duration: 0.5 };
  },
};
const player = new TestPlayer();
useNarrate.setState({ engine, player: player as unknown as Player });

assert.equal(useNarrate.getState().view, 'library', 'launch starts in Library');
assert.equal(useNarrate.getState().doc, null, 'launch does not open a sample');
await useNarrate.getState().hydrate();
const open = (name: string, text: string) => useNarrate.getState().openBuffer(name, new TextEncoder().encode(text).buffer);
assert.equal(await open('first.txt', 'First sentence. Second sentence. Third sentence.'), true);
const firstId = useNarrate.getState().activeDocId!;
await useNarrate.getState().generate('full');
assert.equal(calls, 3, 'full rendering generates every sentence');
assert.equal(player.isRunning, false, 'full rendering waits for deliberate play');
assert.equal(useNarrate.getState().library[0].audioReady, true);
assert.equal(useNarrate.getState().generationJobs[0].status, 'completed');
assert.equal(useNarrate.getState().generationJobs[0].modelId, engine.id, 'generation audit records the actual model edition');
assert.equal(await open('second.txt', 'A completely different document.'), true);
await useNarrate.getState().openLibraryDoc(firstId);
assert.match(useNarrate.getState().doc!.plain, /First sentence/);
assert.equal(player.renderedCount, 3, 'reopening restores saved audio');
await useNarrate.getState().toggle();
assert.equal(calls, 3, 'playing saved audio never loads or regenerates synthesis');
player.pause();
await useNarrate.getState().generate('full');
assert.equal(calls, 3, 're-render uses completed cached narration');
useNarrate.setState({ hydrated: false, library: [], generationJobs: [], doc: null, activeDocId: null });
await useNarrate.getState().hydrate();
assert.equal(useNarrate.getState().library.length, 2, 'documents survive app restart');
assert.equal(useNarrate.getState().view, 'library');
assert.equal(useNarrate.getState().doc, null);
await useNarrate.getState().openLibraryDoc(firstId);
assert.equal(player.renderedCount, 3, 'audio survives app restart');
assert.equal(await open('empty.pdf', ''), false, 'empty import fails without replacing selected document');
assert.equal(useNarrate.getState().activeDocId, firstId);
assert.equal(useNarrate.getState().library.length, 2);

await open('stream.txt', 'One sentence. Two sentences. Three sentences. Four sentences. Five sentences. Six sentences. Seven sentences.');
await useNarrate.getState().generate('stream');
assert.equal(player.renderedCount, 7, 'stream continues beyond its initial lookahead');
assert.equal(useNarrate.getState().library[0].audioReady, true, 'stream saves all generated audio');

await open('seek.txt', 'First word here. Second word there. Third word ends.');
const wanted = useNarrate.getState().doc!.sentences[2].wordStart + 1;
await useNarrate.getState().seekWord(wanted);
assert.equal(player.position, useNarrate.getState().doc!.words[wanted].startTime, 'unrendered seeking lands on requested word after streaming');

await open('pause.txt', 'Pause while this renders. Then resume while rendering.');
let releasePause!: () => void;
let reachedSecond!: () => void;
const secondReached = new Promise<void>(resolve => { reachedSecond = resolve; });
const pauseGate = new Promise<void>(resolve => { releasePause = resolve; });
let step = 0;
beforeSynthesis = async () => { if (++step === 2) { reachedSecond(); await pauseGate; } };
const pausedRun = useNarrate.getState().generate('stream');
await secondReached;
// Pause the automatic playback request before enough audio is buffered, then
// explicitly resume the prefix and pause again without cancelling generation.
assert.equal(useNarrate.getState().playing, true, 'streaming retains playback intent while preparing audio');
await useNarrate.getState().toggle();
assert.equal(player.isRunning, false);
await useNarrate.getState().toggle();
assert.equal(player.isRunning, true);
await useNarrate.getState().toggle();
assert.equal(player.isRunning, false);
releasePause();
await pausedRun;
beforeSynthesis = null;
assert.equal(player.isRunning, false, 'new chunks cannot undo an explicit pause');
assert.equal(player.renderedCount, 2, 'pausing playback does not stop generation');

await open('cancel.txt', 'Cancel this sentence. Keep the later sentences.');
const cancelledId = useNarrate.getState().activeDocId!;
let release!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
beforeSynthesis = () => gate;
const pending = useNarrate.getState().generate('full');
await new Promise(resolve => setTimeout(resolve, 10));
await open('replacement.txt', 'Replacement stays selected.');
release();
await pending;
beforeSynthesis = null;
assert.match(useNarrate.getState().doc!.plain, /Replacement/);
assert.equal(player.renderedCount, 0, 'cancelled old synthesis cannot contaminate newly selected document');
assert.equal(useNarrate.getState().generationJobs.find(j => j.docId === cancelledId)!.status, 'cancelled');
await useNarrate.getState().openLibraryDoc(cancelledId);
const callsBeforeResume = calls;
await useNarrate.getState().generate('full');
assert.equal(calls - callsBeforeResume, 2, 'cancelled unfinished job can be resumed');
assert.equal(useNarrate.getState().generationJobs[0].status, 'completed');

const { storage } = await import('../src/state/persistence');
const interrupted = { ...useNarrate.getState().generationJobs[0], id: 'interrupted-test', status: 'running' as const };
await storage.saveJobs([interrupted]);
useNarrate.setState({ hydrated: false });
await useNarrate.getState().hydrate();
assert.equal(useNarrate.getState().generationJobs[0].status, 'interrupted', 'unfinished audit recovers after restart');
await useNarrate.getState().removeDoc(firstId);
assert.equal(useNarrate.getState().library.some(e => e.id === firstId), false);
await open('delete-one.txt', 'Delete the first document.');
const deleteOne = useNarrate.getState().activeDocId!;
await open('delete-two.txt', 'Delete the second document.');
const deleteTwo = useNarrate.getState().activeDocId!;
await open('keep.txt', 'Keep this document.');
await Promise.all([useNarrate.getState().removeDoc(deleteOne), useNarrate.getState().removeDoc(deleteTwo)]);
assert.equal(useNarrate.getState().library.some(e => e.id === deleteOne || e.id === deleteTwo), false, 'concurrent deletes never resurrect a broken library entry');
assert.equal((await storage.load()).library.some(e => e.id === deleteOne || e.id === deleteTwo), false);
const cachedVoice = useNarrate.getState().voiceId;
const cachedSpeed = useNarrate.getState().speed;
await useNarrate.getState().generate('full');
const cachedVoiceId = useNarrate.getState().activeDocId!;
useNarrate.getState().setVoice(cachedVoice === 'af_bella' ? 'af_nicole' : 'af_bella');
useNarrate.getState().setSpeed(1.5);
await open('other-voice.txt', 'A different document with a different narrator.');
await useNarrate.getState().generate('full');
const beforeCachedReopen = calls;
await useNarrate.getState().openLibraryDoc(cachedVoiceId);
assert.equal(useNarrate.getState().voiceId, cachedVoice, 'opening a saved document restores its own narrator');
assert.equal(useNarrate.getState().speed, cachedSpeed, 'opening restores the saved narration pace');
assert.equal(player.renderedCount, 1, 'a saved document keeps its audio after another document uses a different narrator');
await useNarrate.getState().toggle();
assert.equal(calls, beforeCachedReopen, 'reopening with a different global narrator still plays cached audio');
player.pause();
useNarrate.setState({ engine: { ...engine, id: 'kokoro-q4' }, selectedModel: 'kokoro-q4' });
await open('model-cache.txt', 'This narration uses a different model edition.');
await useNarrate.getState().generate('full');
const modelCacheId = useNarrate.getState().activeDocId!;
useNarrate.setState({ engine: { ...engine, id: 'kokoro-q8' }, selectedModel: 'kokoro-q8' });
await open('another-model.txt', 'Another document changes the current model.');
await useNarrate.getState().generate('full');
const beforeModelReopen = calls;
await useNarrate.getState().openLibraryDoc(modelCacheId);
assert.equal(useNarrate.getState().selectedModel, 'kokoro-q8', 'opening saved audio preserves the selected generation edition');
assert.equal(useNarrate.getState().engine.id, 'kokoro-q8', 'saved playback never replaces the selected generation engine');
assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q4', 'saved PCM retains its own model identity');
await useNarrate.getState().toggle();
assert.equal(calls, beforeModelReopen, 'a different global model never forces cached narration to regenerate');
player.pause();

const beforeImmediateStop = calls;
const immediateStopRun = useNarrate.getState().generate('full');
const immediateStopJobId = useNarrate.getState().generationJobs[0].id;
const stopBeforeRender = useNarrate.getState().cancel;
assert.ok(stopBeforeRender, 'Stop is available before the selected edition starts rendering');
stopBeforeRender();
await immediateStopRun;
const immediatelyStopped = useNarrate.getState().generationJobs.find(job => job.id === immediateStopJobId)!;
assert.equal(immediatelyStopped.modelId, 'kokoro-q8');
assert.equal(immediatelyStopped.status, 'cancelled');
assert.equal(immediatelyStopped.completedSentences, 0,
  'an immediately stopped attempt must not count another edition\'s saved PCM as its own generation');
assert.equal((await storage.load()).jobs.find(job => job.id === immediateStopJobId)?.completedSentences, 0,
  'persisted Work progress excludes the different edition\'s saved PCM');
assert.equal(calls, beforeImmediateStop, 'an immediate Stop prevents synthesis');
assert.equal(useNarrate.getState().audioProfile?.modelId, 'kokoro-q4', 'an immediate Stop retains the saved playback edition');
assert.equal(player.renderedCount, 1, 'an immediate Stop retains the existing saved audio');

await open('stop-final-write.txt', 'Keep the saved audio when generation is stopped.');
await useNarrate.getState().generate('full');
const finalWriteDocId = useNarrate.getState().activeDocId!;
let reachedFinalWrite!: () => void;
let releaseFinalWrite!: () => void;
const finalWriteReached = new Promise<void>(resolve => { reachedFinalWrite = resolve; });
const finalWriteGate = new Promise<void>(resolve => { releaseFinalWrite = resolve; });
const originalSaveLibrary = storage.saveLibrary;
storage.saveLibrary = async entries => {
  reachedFinalWrite();
  await finalWriteGate;
  await originalSaveLibrary(entries);
};
let finalizingRun: Promise<void> | undefined;
try {
  // A fully cached attempt performs one Library write at finalization.
  finalizingRun = useNarrate.getState().generate('full');
  await finalWriteReached;
  const finalJobId = useNarrate.getState().generationJobs[0].id;
  const stop = useNarrate.getState().cancel;
  assert.ok(stop, 'Stop remains available while the final Library write is pending');
  stop();
  assert.equal(useNarrate.getState().generationJobs[0].status, 'cancelled');
  releaseFinalWrite();
  await finalizingRun;
  assert.equal(useNarrate.getState().generationJobs.find(job => job.id === finalJobId)?.status, 'cancelled',
    'finishing the final Library write must not overwrite an explicit Stop with completed');
  assert.equal((await storage.load()).jobs.find(job => job.id === finalJobId)?.status, 'cancelled',
    'persisted Work history keeps the explicit Stop after the final Library write');
  assert.equal(useNarrate.getState().library.find(entry => entry.id === finalWriteDocId)?.audioReady, true,
    'Stop during finalization retains the complete saved PCM');
} finally {
  releaseFinalWrite();
  storage.saveLibrary = originalSaveLibrary;
  await finalizingRun;
}

// A fresh take must bypass this profile's saved PCM, while keeping other
// documents/editions and retaining the old take if the first sentence fails.
const recoveryDocId = useNarrate.getState().activeDocId!;
const recoveryEngine = useNarrate.getState().engine;
const recoveryVoice = useNarrate.getState().voiceId;
const recoverySpeed = useNarrate.getState().speed;
const recoveryKey = storage.narrationKey(recoveryDocId, recoveryEngine.id, recoveryVoice, recoverySpeed);
const otherKey = storage.narrationKey(recoveryDocId, 'kokoro-fp32', recoveryVoice, recoverySpeed);
const oldTake = await storage.loadNarration(recoveryKey);
assert.ok(oldTake.length > 0);
await storage.saveSegment(otherKey, oldTake[0]);
const otherDocumentKey = storage.narrationKey(cachedVoiceId, 'test-engine', cachedVoice, cachedSpeed);
const otherDocument = await storage.loadNarration(otherDocumentKey);
assert.ok(otherDocument.length > 0);
const normalSynthesis = recoveryEngine.synthesize;
try {
  recoveryEngine.synthesize = async () => { throw new Error('First replacement sentence failed'); };
  await useNarrate.getState().generate('full', { fresh: true });
  assert.equal(useNarrate.getState().generationJobs[0].status, 'failed', 'a fresh take performs new synthesis instead of replaying the completed cache');
  assert.deepEqual(await storage.loadNarration(recoveryKey), oldTake, 'failed replacement leaves previous audio intact');
  assert.equal(player.renderedCount, oldTake.length, 'failed replacement restores previous playback');

  let releaseFresh!: () => void;
  let reachedFresh!: () => void;
  const freshReached = new Promise<void>(resolve => { reachedFresh = resolve; });
  const freshGate = new Promise<void>(resolve => { releaseFresh = resolve; });
  recoveryEngine.synthesize = async () => { reachedFresh(); await freshGate;
    return { samples: new Float32Array([0.25, -0.25]), sampleRate: 10, duration: 0.2 }; };
  const cancelledFresh = useNarrate.getState().generate('full', { fresh: true });
  await freshReached;
  useNarrate.getState().cancel!();
  releaseFresh(); await cancelledFresh;
  assert.deepEqual(await storage.loadNarration(recoveryKey), oldTake, 'Stop before a replacement arrives keeps previous PCM');
  assert.equal(player.renderedCount, oldTake.length, 'Stop before replacement restores previous playback');

  recoveryEngine.synthesize = async () => ({ samples: new Float32Array([0.25, -0.25]), sampleRate: 10, duration: 0.2 });
  await useNarrate.getState().generate('full', { fresh: true });
  const freshTake = await storage.loadNarration(recoveryKey);
  assert.equal(freshTake.length, oldTake.length);
  assert.deepEqual([...freshTake[0].samples], [0.25, -0.25], 'fresh audio replaces only the chosen narration');
  assert.deepEqual(await storage.loadNarration(otherKey), [oldTake[0]], 'another edition remains saved');
  assert.deepEqual(await storage.loadNarration(otherDocumentKey), otherDocument, 'another document remains saved');
  assert.equal(useNarrate.getState().generationJobs[0].freshAudio, true, 'Work records a fresh take');
  await useNarrate.getState().openLibraryDoc(recoveryDocId);
  assert.deepEqual([...player.segments[0].samples], [0.25, -0.25], 'reopening plays the replacement without synthesis');
} finally { recoveryEngine.synthesize = normalSynthesis; }

Object.assign(globalThis, { window: {}, isTauri: true });
try {
  mockIPC((command) => {
    assert.equal(command, 'audio_export_begin', 'cancelled export opens only the native picker');
    return { native: true, session: null };
  });
  await useNarrate.getState().exportAudio('wav');
  assert.match(useNarrate.getState().status, /cancelled/i, 'picker cancellation is not reported as success');
  assert.equal(useNarrate.getState().busy, false);
  assert.equal(useNarrate.getState().library[0].audioReady, true, 'cancelling export retains saved narration');
  mockIPC(() => { throw new Error('Could not open the save picker'); });
  await useNarrate.getState().exportAudio('wav');
  assert.match(useNarrate.getState().error!, /save picker/);
  assert.equal(useNarrate.getState().status, 'Export failed');
  assert.equal(useNarrate.getState().busy, false);
} finally {
  clearMocks();
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'isTauri');
}
console.log('State regressions passed: Library startup, durable documents/audio/audit, cache reuse, full/stream semantics, cancellation, deletion and native export outcomes.');
