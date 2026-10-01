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
// Simulate playback on the buffered prefix, then pause without cancelling work.
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
assert.equal(useNarrate.getState().selectedModel, 'kokoro-q4', 'opening restores the saved model edition');
assert.equal(useNarrate.getState().engine.ready, false, 'saved audio needs no loaded inference engine');
await useNarrate.getState().toggle();
assert.equal(calls, beforeModelReopen, 'a different global model never forces cached narration to regenerate');
player.pause();
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
