/** Web Audio boundary regressions; no model download or audio hardware needed. */
import assert from 'node:assert/strict';
import { Player, encodeMp3, encodeWav } from '../src/core/audio/player';
import { MPEGDecoder } from 'mpg123-decoder';

type Start = { at: number; offset: number };
type TestBuffer = { length: number; sampleRate: number; getChannelData: () => Float32Array };
class TestSource {
  buffer: TestBuffer | null = null;
  onended: (() => void) | null = null;
  starts: Start[] = [];
  stopped = false;
  connect() {}
  disconnect() {}
  start(at: number, offset = 0) { this.starts.push({ at, offset }); }
  stop() { this.stopped = true; }
}
class TestContext {
  currentTime = 10;
  state = 'running';
  sampleRate = 24000;
  destination = {};
  sources: TestSource[] = [];
  createGain() { return { connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, length: number, rate: number) {
    const samples = new Float32Array(length);
    return { length, sampleRate: rate, getChannelData: () => samples };
  }
  createBufferSource() {
    const node = new TestSource();
    this.sources.push(node);
    return node;
  }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
}

let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
Object.assign(globalThis, {
  AudioContext: TestContext,
  requestAnimationFrame: (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  },
  cancelAnimationFrame: (id: number) => frames.delete(id),
});
function nextFrame() {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(0));
}
function fixture() {
  const player = new Player();
  const ctx = player.context as unknown as TestContext;
  player.putSentence(0, new Float32Array(48000), 24000);
  return { player, ctx };
}
function finishSource(ctx: TestContext, source: TestSource) {
  assert(source.buffer, 'scheduled source has a buffer');
  const { at, offset } = source.starts[0];
  ctx.currentTime = at + source.buffer.length / source.buffer.sampleRate - offset;
  source.onended?.();
}
const near = (got: number, wanted: number) => assert.ok(Math.abs(got - wanted) < 1e-6, `${got} != ${wanted}`);
let failures = 0;
async function test(name: string, run: () => void | Promise<void>) {
  try { await run(); console.log(`ok ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error instanceof Error ? error.message : error}`); }
  finally { frames.clear(); }
}

await test('seeking inside a sentence plays its PCM from that offset', async () => {
  const { player, ctx } = fixture();
  await player.play(1);
  near(ctx.sources[0].starts[0].offset, 0.85);
  near(player.time(), 1);
  player.pause();
});
await test('appended streaming audio is scheduled once without restarting current audio', async () => {
  const { player, ctx } = fixture();
  await player.play(0);
  player.putSentence(1, new Float32Array(24000), 24000);
  assert.equal(ctx.sources.length, 2);
  assert.equal(ctx.sources[0].stopped, false);
  near(ctx.sources[1].starts[0].at, 12.37);
  player.pause();
});
await test('overdue streaming refill plays all new PCM while animation frames are suspended', async () => {
  const { player, ctx } = fixture();
  await player.play(0);
  ctx.currentTime = 15;
  player.putSentence(1, new Float32Array(24000), 24000);
  assert.equal(ctx.sources.length, 2, 'the new sentence must still be scheduled after the old buffer drains');
  near(ctx.sources[1].starts[0].offset, 0);
  near(ctx.sources[1].starts[0].at, 15.07);
  near(player.time(), 2.3);
  player.pause();
});
await test('source completion ends the padded timeline without an animation frame', async () => {
  const { player, ctx } = fixture();
  let ends = 0;
  player.attach({ onEnd: () => { ends++; } });
  await player.play(0);
  player.putSentence(1, new Float32Array(24000), 24000);
  finishSource(ctx, ctx.sources[0]);
  assert.equal(player.isRunning, true, 'ending an earlier source must retain the scheduled sentence');
  assert.equal(ends, 0);
  finishSource(ctx, ctx.sources[1]);
  near(ctx.currentTime, 13.52);
  near(player.time(), 3.52);
  assert.equal(player.isRunning, false);
  assert.equal(ends, 1);
  assert.equal(frames.size, 0);
});
await test('seeking into the final silent padding completes without animation frames', async () => {
  const { player, ctx } = fixture();
  let ends = 0;
  player.attach({ onEnd: () => { ends++; } });
  await player.play(2.2);
  assert.equal(ctx.sources.length, 1, 'the silent tail needs a source completion callback');
  finishSource(ctx, ctx.sources[0]);
  near(ctx.currentTime, 10.1);
  near(player.time(), 2.3);
  assert.equal(player.isRunning, false);
  assert.equal(ends, 1);
});
await test('obsolete source completion cannot finish replacement audio or restart a paused player', async () => {
  const { player, ctx } = fixture();
  let ends = 0;
  player.attach({ onEnd: () => { ends++; } });
  await player.play(0);
  const oldEnd = ctx.sources[0].onended;
  player.putSentence(0, new Float32Array(24000), 24000);
  oldEnd?.();
  assert.equal(player.isRunning, true);
  assert.equal(ends, 0);
  const replacedEnd = ctx.sources[1].onended;
  player.pause();
  replacedEnd?.();
  oldEnd?.();
  player.putSentence(1, new Float32Array(24000), 24000);
  assert.equal(player.isRunning, false);
  assert.equal(ctx.sources.length, 2, 'appending after pause must not restart playback');
  assert.equal(ends, 0);
});
await test('pause freezes the playhead and resume slices the current sentence', async () => {
  const { player, ctx } = fixture();
  await player.play(0);
  ctx.currentTime = 10.8;
  player.pause();
  ctx.currentTime = 20;
  near(player.time(), 0.8);
  await player.play();
  near(ctx.sources.at(-1)!.starts[0].offset, 0.65);
  player.pause();
});
await test('clearing a playing timeline stops sound and clears time and rendered count', async () => {
  const { player, ctx } = fixture();
  await player.play(0);
  player.setTimeline([]);
  assert.equal(ctx.sources[0].stopped, true);
  assert.equal(player.isRunning, false);
  assert.equal(player.renderedCount, 0);
  assert.equal(player.time(), 0);
  assert.equal(player.duration, 0);
});
await test('restored timeline reports rendered audio and can play', async () => {
  const { player } = fixture();
  const snapshot = player.segments.map((segment) => ({ ...segment }));
  const restored = new Player();
  restored.setTimeline(snapshot);
  assert.equal(restored.renderedCount, 1);
  await restored.play(0);
  assert.equal(restored.isRunning, true);
  restored.pause();
});
await test('natural completion clamps time and the next play restarts', async () => {
  const { player, ctx } = fixture();
  let ends = 0;
  player.attach({ onEnd: () => { ends++; } });
  await player.play(0);
  ctx.currentTime = 15;
  nextFrame();
  near(player.time(), 2.3);
  assert.equal(player.isRunning, false);
  assert.equal(ends, 1);
  await player.toggle();
  near(player.time(), 0);
  assert.equal(player.isRunning, true);
  player.pause();
});
await test('repeated seeks retain one animation loop', async () => {
  const { player } = fixture();
  await player.play(0);
  await player.play(0.5);
  await player.play(1);
  assert.equal(frames.size, 1);
  player.pause();
});
await test('exports include the silence used by the word timing timeline', () => {
  const { player } = fixture();
  player.putSentence(1, new Float32Array(24000), 24000);
  const { chunks, sampleRate } = player.toExportChunks();
  assert.equal(sampleRate, 24000);
  assert.equal(chunks.reduce((length, chunk) => length + chunk.length, 0), 84480);
});

await test('WAV export writes audible signed 16-bit PCM', async () => {
  const blob = encodeWav([new Float32Array([0, 0.5, -0.5, 1, -1])], 24000);
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 24000);
  assert.deepEqual(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true)), [0, 16383, -16384, 32767, -32768]);
});
await test('MP3 export produces valid frames that decode into audible PCM', async () => {
  const samples = Float32Array.from({ length: 24000 }, (_, index) => 0.8 * Math.sin(index * 2 * Math.PI * 440 / 24000));
  const blob = await encodeMp3([samples], 24000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/mpeg');
  assert.ok(bytes.length > 1000);
  const id3 = new TextDecoder().decode(bytes.subarray(0, 3)) === 'ID3';
  assert.ok(id3 || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0), 'missing MP3 frame or ID3 header');
  const decoder = new MPEGDecoder();
  try {
    await decoder.ready;
    const audio = decoder.decode(bytes);
    assert.equal(audio.errors.length, 0);
    assert.equal(audio.sampleRate, 22050);
    assert.ok(audio.samplesDecoded > 20000, 'one second of audio must survive encoding');
    const pcm = audio.channelData[0];
    const rms = Math.sqrt(pcm.reduce((power, sample) => power + sample * sample, 0) / pcm.length);
    assert.ok(rms > 0.3 && rms < 0.8, `exported tone is silent or distorted: RMS=${rms}`);
    console.log(`MP3 round-trip: ${bytes.length} bytes, ${audio.samplesDecoded} samples, RMS=${rms.toFixed(3)}`);
  } finally { decoder.free(); }
});

console.log(`${failures ? `${failures} CHECK(S) FAILED` : 'ALL AUDIO CHECKS PASSED'}`);
process.exitCode = failures ? 1 : 0;
