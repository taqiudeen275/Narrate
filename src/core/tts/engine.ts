/**
 * The TTS engine interface.
 *
 * There is exactly one method that matters: synthesize a single sentence and
 * return real audio for it. Everything above this layer — sequencing,
 * streaming, timing, export — is engine-agnostic, which is what lets the
 * desktop app, the browser extension, and a future native adapter all share
 * one implementation of the parts that actually define the product.
 *
 * Per-sentence synthesis is a deliberate choice, not a simplification. Long-form
 * TTS degrades badly past a few thousand characters, and sentence granularity is
 * the only chunking boundary that is simultaneously safe for the model and
 * natural for the prosody. The player stitches sentences with an explicit,
 * measured pause between them.
 */

import type { KokoroRuntimeInfo } from './worker-types';

export interface VoiceInfo {
  id: string;
  name: string;
  /** Short character description, for the casting UI. */
  persona: string;
  accent: string;
  engine: string;
  /** Can this voice produce a cloned speaker rather than a preset? */
  clonable: boolean;
}

export interface SynthesisOptions {
  /** Speaking rate multiplier. 1 is the engine's natural rate. */
  speed?: number;
}

export interface EngineChunk {
  /** Mono PCM. */
  samples: Float32Array;
  sampleRate: number;
  /** Seconds of audio produced. */
  duration: number;
}

export interface ModelLoadProgress {
  file: string;
  loaded: number;
  total: number;
  /** 0-1, or null when the total is unknown. */
  fraction: number | null;
}

export interface TtsEngine {
  readonly id: string;
  readonly name: string;
  /** True once weights are resident and synthesis will not re-download. */
  readonly ready: boolean;
  /** Available after initialization, if the engine reports its execution path. */
  readonly runtime?: KokoroRuntimeInfo | null;

  load(onProgress?: (p: ModelLoadProgress) => void): Promise<void>;
  synthesize(text: string, voiceId: string, opts?: SynthesisOptions): Promise<EngineChunk>;
  voices(): VoiceInfo[];
  dispose(): void;
}

/* ------------------------------------------------------------------ timing ---- */

/**
 * The pause between sentences. Long enough to sound like a reader breathing
 * rather than a buffer flushing, short enough that a long document does not
 * drift out of sync with its own text.
 */
export const SENTENCE_GAP = 0.22;

/** Leading and trailing silence, so playback never starts or ends on a cliff. */
export const EDGE_PAD = 0.15;

export function totalDuration(
  chunks: { duration: number }[],
  gap = SENTENCE_GAP,
): number {
  if (chunks.length === 0) return 0;
  const audio = chunks.reduce((a, c) => a + c.duration, 0);
  return audio + gap * (chunks.length - 1) + EDGE_PAD * 2;
}
