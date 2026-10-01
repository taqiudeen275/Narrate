/** Kokoro inference lives in a worker so large sentences do not freeze the UI. */
import type { EngineChunk, ModelLoadProgress, SynthesisOptions, TtsEngine, VoiceInfo } from './engine';
import { availableVoices } from './voices';
import { DEFAULT_MODEL_ID, installModel, modelVariant } from './downloads';
import type { KokoroBackend, KokoroReply, KokoroRequest, KokoroRuntimeInfo } from './worker-types';
import { isKokoroMobileHost } from './runtime-capabilities';

class WorkerBackendError extends Error {
  constructor(message: string, readonly backend?: KokoroBackend) { super(message); }
}

export interface WebKokoroOptions {
  backendPreference?: 'auto' | 'wasm';
  /** Deadlines cover worker execution, after the resumable download finishes. */
  loadTimeoutMs?: number;
  synthesisTimeoutMs?: number;
}

export class WebKokoroEngine implements TtsEngine {
  readonly id: string;
  readonly name: string;
  private worker: Worker | null = null;
  private loaded = false;
  private loading: Promise<void> | null = null;
  private nextRequest = 0;
  private epoch = 0;
  private runtimeState: KokoroRuntimeInfo | null = null;
  private workerBackend: KokoroBackend | null = null;
  private gpuDisabled = false;
  private readonly backendPreference: 'auto' | 'wasm';
  private readonly loadTimeoutMs: number;
  private readonly synthesisTimeoutMs: number;
  private requests = new Map<number, {
    resolve: (reply: KokoroReply) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(readonly cacheId = DEFAULT_MODEL_ID, options: WebKokoroOptions = {}) {
    const model = modelVariant(cacheId);
    this.id = model.cacheId;
    this.name = model.name;
    this.backendPreference = options.backendPreference ?? 'auto';
    // Allow slower phones ample time for WASM initialization and each sentence,
    // while keeping a living but wedged worker from holding a job forever.
    this.loadTimeoutMs = options.loadTimeoutMs ?? 5 * 60_000;
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? 5 * 60_000;
    if (![this.loadTimeoutMs, this.synthesisTimeoutMs].every((timeout) => Number.isFinite(timeout) && timeout > 0 && timeout <= 2_147_483_647)) {
      throw new RangeError('Voice worker deadlines must be positive, finite timer durations.');
    }
  }

  get ready(): boolean { return this.loaded; }
  get runtime(): KokoroRuntimeInfo | null { return this.runtimeState; }

  async load(onProgress?: (progress: ModelLoadProgress) => void): Promise<void> {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.loading = this.doLoad(epoch, onProgress).catch((error) => {
      if (this.epoch === epoch) {
        this.stopWorker(error instanceof Error ? error : new Error(String(error)));
      }
      // Transformers keeps rejected initialization promises inside its runtime.
      // Retry in a fresh worker, while still respecting user cancellation.
      if (error instanceof WorkerBackendError && error.backend === 'webgpu' && this.epoch === epoch + 1) {
        return this.load(onProgress);
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
      if (data.type === 'backend') {
        this.workerBackend = data.backend;
        return;
      }
      this.requests.delete(data.id);
      clearTimeout(pending.timer);
      if (data.type === 'error' && data.backend === 'webgpu') {
        // Reject every pending GPU request with the same reason; their retries
        // share load() and therefore one replacement CPU worker.
        this.gpuDisabled = true;
        const error = new WorkerBackendError(data.error, data.backend);
        pending.reject(error);
        this.stopWorker(error);
      } else if (data.type === 'error') pending.reject(new WorkerBackendError(data.error, data.backend));
      else pending.resolve(data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker || epoch !== this.epoch) return;
      const error = new WorkerBackendError(event.message || 'The voice engine stopped. Reload the model to continue.', this.workerBackend ?? this.runtimeState?.backend);
      if (error.backend === 'webgpu') this.gpuDisabled = true;
      this.stopWorker(error);
    };
    const reply = await this.request({ type: 'load', cacheId: this.cacheId, device: this.gpuDisabled ? 'wasm' : this.backendPreference,
      mobile: isKokoroMobileHost(typeof navigator === 'undefined' ? undefined : navigator) });
    if (epoch !== this.epoch) throw new DOMException('Model load cancelled', 'AbortError');
    if (reply.type !== 'ready') throw new Error('The voice engine did not finish initialization.');
    this.runtimeState = reply.runtime ? { ...reply.runtime,
      ...(this.gpuDisabled && reply.runtime.backend === 'wasm' ? { reason: 'GPU execution failed; using CPU inference.' } : {}) } : null;
    this.workerBackend = reply.runtime?.backend ?? this.workerBackend;
    this.loaded = true;
  }

  private request(payload: Omit<KokoroRequest, 'id'>): Promise<KokoroReply> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('The voice engine is not loaded.'));
    const id = ++this.nextRequest;
    const timeout = payload.type === 'load' ? this.loadTimeoutMs : this.synthesisTimeoutMs;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.worker !== worker) return;
        const error = new WorkerBackendError(payload.type === 'load'
          ? 'Loading the voice engine timed out. Try loading the model again.'
          : 'Generating audio timed out. Try narration again.', this.workerBackend ?? this.runtimeState?.backend);
        if (error.backend === 'webgpu') this.gpuDisabled = true;
        this.stopWorker(error);
      }, timeout);
      this.requests.set(id, { resolve, reject, timer });
      try { worker.postMessage({ ...payload, id }); }
      catch (error) { this.stopWorker(error instanceof Error ? error : new Error(String(error))); }
    });
  }

  private stopWorker(error: Error): void {
    // Advance before rejecting: an old load's catch must never terminate a
    // replacement worker created by a retry.
    this.epoch++;
    this.loaded = false;
    this.runtimeState = null;
    this.workerBackend = null;
    this.loading = null;
    this.worker?.terminate();
    this.worker = null;
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
  }

  voices(): VoiceInfo[] { return availableVoices().map((voice) => ({ ...voice, engine: this.id })); }

  async synthesize(text: string, voiceId: string, options: SynthesisOptions = {}): Promise<EngineChunk> {
    await this.load();
    if (!availableVoices().some((voice) => voice.id === voiceId)) throw new Error(`"${voiceId}" is not a voice in ${this.name}.`);
    const epoch = this.epoch;
    let reply: KokoroReply;
    try { reply = await this.request({ type: 'synthesize', text, voiceId, speed: options.speed ?? 1 }); }
    catch (error) {
      if (!(error instanceof WorkerBackendError && error.backend === 'webgpu' && this.epoch === epoch + 1)) throw error;
      await this.load();
      reply = await this.request({ type: 'synthesize', text, voiceId, speed: options.speed ?? 1 });
    }
    if (reply.type !== 'chunk') throw new Error('The voice engine returned no audio.');
    return { samples: reply.samples, sampleRate: reply.sampleRate, duration: reply.samples.length / reply.sampleRate };
  }

  dispose(): void {
    this.stopWorker(new DOMException('Voice engine cancelled', 'AbortError'));
  }
}
