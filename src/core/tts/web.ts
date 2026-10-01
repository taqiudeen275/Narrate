/** Kokoro inference lives in a worker so large sentences do not freeze the UI. */
import type { EngineChunk, ModelLoadProgress, SynthesisOptions, TtsEngine, VoiceInfo } from './engine';
import { availableVoices } from './voices';
import { DEFAULT_MODEL_ID, installModel, modelVariant } from './downloads';
import type { KokoroReply, KokoroRequest } from './worker-types';

export class WebKokoroEngine implements TtsEngine {
  readonly id: string;
  readonly name: string;
  private worker: Worker | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private nextRequest = 0;
  private epoch = 0;
  private requests = new Map<number, { resolve: (reply: KokoroReply) => void; reject: (error: Error) => void }>();

  constructor(readonly cacheId = DEFAULT_MODEL_ID) {
    const model = modelVariant(cacheId);
    this.id = model.cacheId;
    this.name = model.name;
  }

  get ready(): boolean { return this.loaded; }

  async load(onProgress?: (progress: ModelLoadProgress) => void): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.loading = this.doLoad(epoch, onProgress).catch((error) => {
      if (this.epoch === epoch) {
        this.loading = null;
        this.worker?.terminate();
        this.worker = null;
      }
      throw error;
    });
    return this.loading;
  }

  private async doLoad(epoch: number, onProgress?: (progress: ModelLoadProgress) => void) {
    await installModel(this.cacheId, onProgress);
    if (epoch !== this.epoch) throw new DOMException('Model load cancelled', 'AbortError');
    const worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    worker.onmessage = ({ data }: MessageEvent<KokoroReply>) => {
      if (this.worker !== worker || epoch !== this.epoch) return;
      const pending = this.requests.get(data.id);
      if (!pending) return;
      this.requests.delete(data.id);
      if (data.type === 'error') pending.reject(new Error(data.error));
      else pending.resolve(data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker || epoch !== this.epoch) return;
      const error = new Error(event.message || 'The voice engine stopped. Reload the model to continue.');
      this.loaded = false;
      this.loading = null;
      worker.terminate();
      this.worker = null;
      for (const request of this.requests.values()) request.reject(error);
      this.requests.clear();
    };
    await this.request({ type: 'load', cacheId: this.cacheId });
    if (epoch !== this.epoch) throw new DOMException('Model load cancelled', 'AbortError');
    this.loaded = true;
  }

  private request(payload: Omit<KokoroRequest, 'id'>): Promise<KokoroReply> {
    if (!this.worker) return Promise.reject(new Error('The voice engine is not loaded.'));
    const id = ++this.nextRequest;
    return new Promise((resolve, reject) => {
      this.requests.set(id, { resolve, reject });
      this.worker!.postMessage({ ...payload, id });
    });
  }

  voices(): VoiceInfo[] { return availableVoices().map((voice) => ({ ...voice, engine: this.id })); }

  async synthesize(text: string, voiceId: string, options: SynthesisOptions = {}): Promise<EngineChunk> {
    await this.load();
    if (!availableVoices().some((voice) => voice.id === voiceId)) throw new Error(`"${voiceId}" is not a voice in ${this.name}.`);
    const reply = await this.request({ type: 'synthesize', text, voiceId, speed: options.speed ?? 1 });
    if (reply.type !== 'chunk') throw new Error('The voice engine returned no audio.');
    return { samples: reply.samples, sampleRate: reply.sampleRate, duration: reply.samples.length / reply.sampleRate };
  }

  dispose(): void {
    this.epoch++;
    this.loaded = false;
    this.loading = null;
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.requests.values()) request.reject(new DOMException('Voice engine cancelled', 'AbortError'));
    this.requests.clear();
  }
}
