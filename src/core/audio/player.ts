/**
 * Audio assembly and the streaming player.
 *
 * The player is where the product's central claim is either true or false: the
 * highlight follows the voice. So the playhead is read from the Web Audio
 * clock, never from a JavaScript timer. A `setInterval` drifts against a
 * hardware clock within seconds, and a word highlight that drifts is worse than
 * no highlight at all.
 *
 * Playback is scheduled per sentence. In full mode every sentence is rendered
 * and scheduled up front; in streaming mode sentences are rendered just ahead
 * of the playhead and scheduled as they arrive. Both produce the same timeline
 * structure, so everything above the player is identical.
 */

import { EDGE_PAD, SENTENCE_GAP, totalDuration } from '../tts/engine';

export interface Segment {
  sentenceIndex: number;
  /** Offset of this sentence in the document timeline, seconds. */
  start: number;
  duration: number;
  samples: Float32Array;
  sampleRate: number;
}

/* -------------------------------------------------------------- encoding ---- */

export function concatFloat32(chunks: Float32Array[], sampleRate: number): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  void sampleRate;
  return out;
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const samples = concatFloat32(chunks, sampleRate);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let o = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    o += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function encodeMp3(
  chunks: Float32Array[],
  sampleRate: number,
  kbps = 128,
): Promise<Blob> {
  const samples = concatFloat32(chunks, sampleRate);
  const { Mp3Encoder } = await import('lamejs');
  // lamejs requires a whole number of samples per channel and rejects rates
  // outside its supported set, so resample rather than emit a corrupt file.
  const target = sampleRate >= 44100 ? 44100 : sampleRate >= 22050 ? 22050 : 16000;
  const scaled = target === sampleRate ? samples : resample(samples, sampleRate, target);

  const enc = new Mp3Encoder(1, target, kbps);
  const block = 1152;
  const parts: Int8Array[] = [];
  for (let i = 0; i < scaled.length; i += block) {
    const buf = enc.encodeBuffer(scaled.subarray(i, i + block));
    if (buf.length > 0) parts.push(new Int8Array(buf));
  }
  const tail = enc.flush();
  if (tail.length > 0) parts.push(new Int8Array(tail));
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' });
}

function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = to / from;
  const length = Math.floor(input.length * ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/* ---------------------------------------------------------------- player ---- */

export interface PlayerEvents {
  onTime?: (time: number, duration: number) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

type Source = { node: AudioBufferSourceNode; sentenceIndex: number };

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sources: Source[] = [];
  /** Public so the scheduler can read back a sentence's scheduled start time. */
  segments: Segment[] = [];
  /** Document seconds at which playback started, for the current run. */
  private originDocTime = 0;
  private originCtxTime = 0;
  private running = false;
  private raf = 0;
  private events: PlayerEvents = {};
  /** Sentence indices already handed to the scheduler, so nothing renders twice. */
  private rendered = new Set<number>();
  private playbackVersion = 0;

  get context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 24000;
  }

  /** Replace the timeline. Safe to call before playback starts. */
  setTimeline(segments: Segment[]): void {
    this.pause();
    this.originDocTime = 0;
    this.segments = segments.map((segment) => ({ ...segment }));
    this.recomputeStarts();
    this.rendered = new Set(this.segments.map((segment) => segment.sentenceIndex));
    this.events.onTime?.(0, this.duration);
  }

  get duration(): number {
    if (this.segments.length === 0) return 0;
    return (
      totalDuration(
        this.segments.map((s) => ({ duration: s.duration })),
        SENTENCE_GAP,
      )
    );
  }

  segmentDurationSum(): number {
    return this.segments.reduce((a, s) => a + s.duration, 0);
  }

  attach(events: PlayerEvents): void {
    this.events = events;
  }

  /**
   * Add or replace one sentence's audio. In streaming mode this is called as
   * each sentence finishes rendering, before the playhead reaches it.
   */
  putSentence(
    sentenceIndex: number,
    samples: Float32Array,
    sampleRate: number,
  ): void {
    const duration = samples.length / sampleRate;
    const existing = this.segments.findIndex((s) => s.sentenceIndex === sentenceIndex);
    const isAppend = existing < 0 && this.segments.every((segment) => segment.sentenceIndex < sentenceIndex);
    if (existing >= 0) this.segments[existing] = { sentenceIndex, start: 0, duration, samples, sampleRate };
    else this.segments.push({ sentenceIndex, start: 0, duration, samples, sampleRate });
    this.recomputeStarts();
    this.rendered.add(sentenceIndex);
    if (this.running) {
      // Appends leave the currently playing source alone. Replacing an earlier
      // sentence changes future start times, so rebuild that schedule instead.
      if (!isAppend) this.stopSources();
      this.scheduleFrom(this.time());
    }
    this.events.onTime?.(this.time(), this.duration);
  }

  hasSentence(i: number): boolean {
    return this.segments.some((s) => s.sentenceIndex === i);
  }

  get renderedCount(): number {
    return this.rendered.size;
  }

  private recomputeStarts(): void {
    this.segments.sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    let t = EDGE_PAD;
    for (const s of this.segments) {
      s.start = t;
      t += s.duration + SENTENCE_GAP;
    }
  }

  /** Current position on the document timeline, seconds. */
  time(): number {
    if (!this.running || !this.ctx) return this.originDocTime;
    return Math.min(this.duration, this.originDocTime + (this.ctx.currentTime - this.originCtxTime));
  }

  async play(from?: number): Promise<void> {
    if (this.segments.length === 0) return;
    const version = ++this.playbackVersion;
    cancelAnimationFrame(this.raf);
    this.stopSources();
    this.running = false;
    const ctx = this.context;
    if (ctx.state === 'suspended') await ctx.resume();
    if (version !== this.playbackVersion) return;

    const requested = from ?? (this.originDocTime >= this.duration ? 0 : this.originDocTime);
    const target = Number.isFinite(requested) ? Math.max(0, Math.min(requested, this.duration)) : 0;
    this.running = true;
    this.originDocTime = target;
    this.originCtxTime = ctx.currentTime;
    this.scheduleFrom(target);
    this.tick();
  }

  pause(): void {
    this.playbackVersion++;
    if (this.running) this.originDocTime = this.time();
    this.running = false;
    this.stopSources();
    cancelAnimationFrame(this.raf);
    this.events.onTime?.(this.originDocTime, this.duration);
  }

  async toggle(from?: number): Promise<void> {
    if (this.running) this.pause();
    else await this.play(from);
  }

  seek(t: number): void {
    const target = Number.isFinite(t) ? Math.max(0, Math.min(t, this.duration)) : 0;
    if (this.running) void this.play(target);
    else this.originDocTime = target;
    this.events.onTime?.(target, this.duration);
  }

  /** The sentence whose audio contains `t`, or null in a gap. */
  segmentAt(t: number): Segment | null {
    for (const s of this.segments) {
      if (t >= s.start && t < s.start + s.duration) return s;
    }
    return null;
  }

  private scheduleFrom(t: number): void {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    const base = this.originCtxTime;
    for (const s of this.segments) {
      if (s.start + s.duration <= t) continue;
      if (this.sources.some((source) => source.sentenceIndex === s.sentenceIndex)) continue;
      const buffer = ctx.createBuffer(1, s.samples.length, s.sampleRate);
      buffer.getChannelData(0).set(s.samples);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.master);
      const when = base + (s.start - this.originDocTime);
      const at = Math.max(ctx.currentTime, when);
      // Seeking inside a sentence must skip the preceding PCM, not merely move
      // its start time. Account for scheduling work that elapsed on the clock.
      const offset = Math.max(0, this.originDocTime + (at - base) - s.start);
      if (offset >= s.duration) { node.disconnect(); continue; }
      node.start(at, offset);
      this.sources.push({ node, sentenceIndex: s.sentenceIndex });
      node.onended = () => {
        this.sources = this.sources.filter((source) => source.node !== node);
        node.disconnect();
      };
    }
  }

  private stopSources(): void {
    for (const s of this.sources) {
      try {
        s.node.stop();
        s.node.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
  }

  private tick = (): void => {
    if (!this.running) return;
    const t = this.time();
    const d = this.duration;
    this.events.onTime?.(t, d);
    if (d > 0 && t >= d - 0.01) {
      this.originDocTime = d;
      this.running = false;
      this.pause();
      this.events.onEnd?.();
      return;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Flatten every rendered sentence into one buffer, for export. */
  toExportChunks(): { chunks: Float32Array[]; sampleRate: number } {
    const sorted = [...this.segments].sort((a, b) => a.sentenceIndex - b.sentenceIndex);
    const rate = sorted[0]?.sampleRate ?? 24000;
    if (!sorted.length) return { chunks: [], sampleRate: rate };
    const silence = (seconds: number) => new Float32Array(Math.round(seconds * rate));
    const chunks: Float32Array[] = [silence(EDGE_PAD)];
    sorted.forEach((segment, index) => {
      if (index > 0) chunks.push(silence(SENTENCE_GAP));
      chunks.push(segment.sampleRate === rate ? segment.samples : resample(segment.samples, segment.sampleRate, rate));
    });
    chunks.push(silence(EDGE_PAD));
    return { chunks, sampleRate: rate };
  }
}
