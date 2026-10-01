/** Exercise the real store and Player; replace only model inference and Web Audio hardware. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { useNarrate } from '../src/state/store';
import type { TtsEngine } from '../src/core/tts/engine';

type BufferFixture = { length: number; sampleRate: number; getChannelData: () => Float32Array };
class SourceFixture {
  buffer: BufferFixture | null = null;
  onended: (() => void) | null = null;
  startTime = 0;
  offset = 0;
  connect() {}
  disconnect() {}
  start(time: number, offset = 0) { this.startTime = time; this.offset = offset; }
  stop() {}
}
class ContextFixture {
  currentTime = 10;
  state = 'running';
  sampleRate = 100;
  destination = {};
  sources: SourceFixture[] = [];
  createGain() { return { connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const samples = new Float32Array(length);
    return { length, sampleRate, getChannelData: () => samples };
  }
  createBufferSource() { const source = new SourceFixture(); this.sources.push(source); return source; }
  async resume() { this.state = 'running'; }
}
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
Object.assign(globalThis, {
  AudioContext: ContextFixture,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(ready => { resolve = ready; });
  return { promise, resolve };
}
const player = useNarrate.getState().player;
const context = player.context as unknown as ContextFixture;
const near = (actual: number, expected: number, message: string) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
function drainBuffer() {
  const sources = context.sources.filter(source => source.onended);
  for (const source of sources) {
    context.currentTime = source.startTime + source.buffer!.length / source.buffer!.sampleRate - source.offset;
    source.onended?.();
  }
}
let beforeSynthesis: (index: number) => Promise<void> = async () => {};
let synthesized = 0;
const engine: TtsEngine = {
  id: 'test-stream-engine', name: 'Test stream engine', ready: true,
  async load() {}, voices: () => [], dispose() {},
  async synthesize() {
    await beforeSynthesis(synthesized++);
    return { samples: new Float32Array(100).fill(0.2), sampleRate: 100, duration: 1 };
  },
};
useNarrate.setState({ engine });
let failures = 0;
async function test(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
  finally { player.pause(); frames.clear(); }
}
async function withBlockedStream(run: (release: () => void, task: Promise<void>) => Promise<void>) {
  const reached = gate();
  const blocked = gate();
  synthesized = 0;
  beforeSynthesis = async index => { if (index === 2) { reached.resolve(); await blocked.promise; } };
  assert.equal(await useNarrate.getState().openBuffer('stream.txt', new TextEncoder().encode('First sentence. Second sentence. Third sentence. Fourth sentence.').buffer), true);
  const task = useNarrate.getState().generate('stream');
  await reached.promise;
  assert.equal(player.renderedCount, 2);
  assert.equal(player.isRunning, true);
  try { await run(blocked.resolve, task); }
  finally { blocked.resolve(); await task; beforeSynthesis = async () => {}; }
}

await test('a drained streaming buffer retains playback intent and resumes new PCM', async () => {
  await withBlockedStream(async (release, task) => {
    drainBuffer();
    const boundary = player.time();
    assert.equal(player.isRunning, false, 'audio waits after available PCM finishes');
    assert.equal(useNarrate.getState().playing, true, 'Pause stays available while waiting for the next sentence');
    assert.match(useNarrate.getState().status, /next sentence/i);
    const oldSources = context.sources.length;
    release(); await task;
    assert.equal(player.isRunning, true);
    assert.equal(useNarrate.getState().playing, true);
    assert.equal(player.time(), boundary, 'refill keeps the buffered boundary instead of replaying its tail');
    near(context.sources[oldSources].offset, 0, 'the next sentence starts at its first PCM sample');
    drainBuffer();
    assert.equal(useNarrate.getState().playing, false, 'the completed document ends playback intent');
    assert.equal(useNarrate.getState().status, 'Finished');
  });
});

await test('Pause while waiting prevents later chunks from starting playback', async () => {
  await withBlockedStream(async (release, task) => {
    drainBuffer();
    await useNarrate.getState().toggle();
    assert.equal(useNarrate.getState().playing, false);
    const oldSources = context.sources.length;
    release(); await task;
    assert.equal(player.isRunning, false, 'an explicit pause wins over generation completion');
    assert.equal(useNarrate.getState().playing, false);
    assert.equal(context.sources.length, oldSources, 'paused generation does not schedule sound');
    assert.equal(player.renderedCount, 4, 'pausing listening keeps generation running');
  });
});

await test('Play after a waiting pause waits for new PCM without replaying the buffer end', async () => {
  await withBlockedStream(async (release, task) => {
    drainBuffer();
    await useNarrate.getState().toggle();
    const boundary = player.time();
    const oldSources = context.sources.length;
    await useNarrate.getState().toggle();
    assert.equal(player.isRunning, false, 'Play at the current buffer end keeps waiting');
    assert.equal(useNarrate.getState().playing, true, 'Play records the intent to resume');
    assert.equal(context.sources.length, oldSources, 'no source is restarted at the old boundary');
    release(); await task;
    assert.equal(player.isRunning, true);
    assert.equal(player.time(), boundary);
    near(context.sources[oldSources].offset, 0, 'the resumed sentence starts at its first PCM sample');
  });
});

await test('Pause and Play keep a pending word seek until its sentence is rendered', async () => {
  await withBlockedStream(async (release, task) => {
    const word = useNarrate.getState().doc!.sentences[3].wordStart + 1;
    await useNarrate.getState().seekWord(word);
    const oldSources = context.sources.length;
    assert.equal(player.isRunning, false);
    assert.equal(useNarrate.getState().playing, true);
    await useNarrate.getState().toggle();
    assert.equal(useNarrate.getState().playing, false);
    await useNarrate.getState().toggle();
    assert.equal(useNarrate.getState().playing, true);
    assert.equal(player.isRunning, false);
    assert.equal(context.sources.length, oldSources, 'Play cannot abandon the requested unrendered word');
    release(); await task;
    assert.equal(player.time(), useNarrate.getState().doc!.words[word].startTime);
    assert.equal(context.sources.length, oldSources + 1, 'only the target sentence is scheduled');
  });
});

await test('starting a stream after the saved document ends replays from the beginning', async () => {
  await useNarrate.getState().toggle();
  drainBuffer();
  assert.equal(player.time(), player.duration);
  await useNarrate.getState().generate('stream');
  assert.equal(player.isRunning, true, 'completed saved audio restarts without waiting for nonexistent chunks');
  assert.equal(player.time(), 0);
  assert.equal(useNarrate.getState().playing, true);
});

console.log(`${failures ? `${failures} CHECK(S) FAILED` : 'ALL STATE STREAMING CHECKS PASSED'}`);
process.exitCode = failures ? 1 : 0;
