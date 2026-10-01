import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
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
await useNarrate.getState().removeDoc(firstId);
assert.equal(useNarrate.getState().library.some(e => e.id === firstId), false);
console.log('State regressions passed: Library startup, durable documents/audio/audit, cache reuse, full/stream semantics, input failure, cancellation, deletion.');
