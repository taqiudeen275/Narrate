/**
 * The Web adapter — the live TTS path today.
 *
 * Runs Kokoro-82M through ONNX Runtime Web via kokoro-js. The model is fetched
 * once and cached by the browser, after which synthesis is entirely local: no
 * request leaves the machine, which is the product's first principle.
 *
 * This adapter exists because the sherpa-onnx native path is blocked on a C++
 * toolchain that is not installed on this machine. Both adapters implement the
 * same interface, so swapping in the native one is a change to which engine is
 * constructed, not to anything above this layer.
 */

import type {
  EngineChunk,
  ModelLoadProgress,
  SynthesisOptions,
  TtsEngine,
  VoiceInfo,
} from './engine';
import { KOKORO_VOICES, type Voice } from './voices';

type KokoroInstance = {
  generate: (
    text: string,
    opts: { voice: string; speed?: number },
  ) => Promise<{ audio: Float32Array; sampling_rate: number }>;
};

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

/**
 * q8 is the shipping choice. The model is unusually well-behaved under
 * quantization — 4-bit per-channel costs it almost nothing — so there is no
 * quality reason to ship the 310 MB fp32 build.
 */
const DTYPE = 'q8';

export class WebKokoroEngine implements TtsEngine {
  readonly id = 'kokoro';
  readonly name = 'Kokoro 82M';
  private tts: KokoroInstance | null = null;
  private loading: Promise<void> | null = null;
  private onProgress: ((p: ModelLoadProgress) => void) | undefined;

  get ready(): boolean {
    return this.tts !== null;
  }

  async load(onProgress?: (p: ModelLoadProgress) => void): Promise<void> {
    if (this.tts) return;
    if (this.loading) return this.loading;
    this.onProgress = onProgress;
    this.loading = this.doLoad().catch((err) => {
      this.loading = null;
      throw err;
    });
    return this.loading;
  }

  private async doLoad(): Promise<void> {
    const progress = (r: { status?: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
      if (r.status !== 'progress' || !r.file) return;
      this.onProgress?.({
        file: r.file,
        loaded: r.loaded ?? 0,
        total: r.total ?? 0,
        fraction: r.total ? (r.loaded ?? 0) / r.total : null,
      });
    };
    const { KokoroTTS } = await import('kokoro-js');
    const tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      progress_callback: progress,
    });
    this.tts = tts as unknown as KokoroInstance;
  }

  voices(): VoiceInfo[] {
    return KOKORO_VOICES.map((v: Voice) => ({
      id: v.id,
      name: v.name,
      persona: v.persona,
      accent: v.accent,
      engine: this.id,
      clonable: v.clonable,
    }));
  }

  async synthesize(
    text: string,
    voiceId: string,
    opts: SynthesisOptions = {},
  ): Promise<EngineChunk> {
    await this.load(this.onProgress);
    if (!this.tts) throw new Error('Kokoro is not loaded');
    if (!KOKORO_VOICES.some((v) => v.id === voiceId)) {
      throw new Error(`Voice "${voiceId}" is not available in ${this.name}.`);
    }

    const out = await this.tts.generate(text, {
      voice: voiceId,
      speed: opts.speed ?? 1,
    });

    const samples = out.audio;
    return {
      samples,
      sampleRate: out.sampling_rate,
      duration: samples.length / out.sampling_rate,
    };
  }

  dispose(): void {
    this.tts = null;
    this.loading = null;
  }
}
