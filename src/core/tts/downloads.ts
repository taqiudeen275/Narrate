import { beginBackgroundWork, endBackgroundWork } from '../background';
import type { ModelLoadProgress } from './engine';

export const MODEL_REPO = 'onnx-community/Kokoro-82M-v1.0-ONNX';
/** Immutable revision prevents joining partial bytes from different releases. */
export const MODEL_REVISION = '1939ad2a8e416c0acfeecc08a694d14ef25f2231';
export const DEFAULT_MODEL_ID = 'kokoro-q8';

export const SUPPORTED_VOICE_IDS = [
  'af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore',
  'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam',
  'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx',
  'am_puck', 'am_santa', 'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis',
  'bf_alice', 'bf_lily', 'bm_daniel', 'bm_fable',
] as const;

export interface ModelVariant {
  cacheId: string;
  name: string;
  dtype: 'q8' | 'q4' | 'fp32';
  file: string;
  sizeBytes: number;
  description: string;
}

/** Sizes are the actual ONNX files in the pinned repository, not estimates. */
export const MODEL_VARIANTS: readonly ModelVariant[] = [
  { cacheId: 'kokoro-q8', name: 'Kokoro · Balanced', dtype: 'q8', file: 'onnx/model_quantized.onnx', sizeBytes: 92361116,
    description: 'The default. 8-bit weights with the smallest download of these editions.' },
  { cacheId: 'kokoro-fp32', name: 'Kokoro · Full precision', dtype: 'fp32', file: 'onnx/model.onnx', sizeBytes: 325532232,
    description: 'Original 32-bit weights. Needs more storage and memory; useful for comparing the same voice.' },
  { cacheId: 'kokoro-q4', name: 'Kokoro · 4-bit edition', dtype: 'q4', file: 'onnx/model_q4.onnx', sizeBytes: 305215966,
    description: 'An alternative quantization for comparison. This export is 305 MB, so it is larger than Balanced.' },
];

export function modelVariant(cacheId: string): ModelVariant {
  const variant = MODEL_VARIANTS.find((model) => model.cacheId === cacheId);
  if (!variant) throw new Error(`Unknown or unsupported model: ${cacheId}`);
  return variant;
}

export function modelFileUrl(file: string): string {
  // kokoro-js loads voice files from this exact main URL and CacheStorage name.
  const revision = file.startsWith('voices/') ? 'main' : MODEL_REVISION;
  return `https://huggingface.co/${MODEL_REPO}/resolve/${revision}/${file}`;
}

export interface DownloadFile { url: string; file: string; sizeBytes: number }

export function modelFiles(cacheId: string): DownloadFile[] {
  const variant = modelVariant(cacheId);
  return [
    { file: variant.file, sizeBytes: variant.sizeBytes },
    { file: 'config.json', sizeBytes: 44 },
    { file: 'tokenizer.json', sizeBytes: 3497 },
    { file: 'tokenizer_config.json', sizeBytes: 113 },
    ...SUPPORTED_VOICE_IDS.map((id) => ({ file: `voices/${id}.bin`, sizeBytes: 522240 })),
  ].map((file) => ({ ...file, url: modelFileUrl(file.file) }));
}

export interface DownloadRecord {
  url: string;
  bytes: number;
  total: number;
  complete: boolean;
  etag?: string;
  headers: Record<string, string>;
}

export interface DownloadStore {
  get(url: string): Promise<DownloadRecord | undefined>;
  reset(url: string): Promise<void>;
  append(url: string, chunk: Blob, metadata: DownloadRecord): Promise<void>;
  complete(url: string, metadata: DownloadRecord): Promise<void>;
  read(url: string): Promise<Blob | undefined>;
}

const abortError = () => new DOMException('Download aborted', 'AbortError');
const isAborted = (error: unknown) => error instanceof Error && error.name === 'AbortError';

interface DownloadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: ModelLoadProgress) => void;
}

interface Job {
  file: DownloadFile;
  controller: AbortController;
  listeners: Set<(progress: ModelLoadProgress) => void>;
  consumers: number;
  promise: Promise<DownloadRecord>;
}

/** One global queue shares transfers across simultaneous model installs. */
export class ResumableDownloader {
  private readonly store: DownloadStore;
  private readonly fetcher: typeof fetch;
  private readonly concurrency: number;
  private readonly checkpointBytes: number;
  private readonly retryCount: number;
  private active = 0;
  private waiting: (() => void)[] = [];
  private jobs = new Map<string, Job>();

  constructor(options: {
    store: DownloadStore; fetcher?: typeof fetch; concurrency?: number;
    checkpointBytes?: number; retryCount?: number;
  }) {
    this.store = options.store;
    this.fetcher = options.fetcher ?? fetch;
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.checkpointBytes = options.checkpointBytes ?? 1024 * 1024;
    this.retryCount = options.retryCount ?? 2;
  }

  download(file: DownloadFile, options: DownloadOptions = {}): Promise<DownloadRecord> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    let job = this.jobs.get(file.url);
    if (!job) {
      const controller = new AbortController();
      job = { file, controller, listeners: new Set(), consumers: 0, promise: Promise.resolve(null as unknown as DownloadRecord) };
      const task = job;
      task.promise = this.schedule(async () => {
        for (let attempt = 0; ; attempt++) {
          try { return await this.transfer(task); }
          catch (error) {
            if (isAborted(error) || attempt >= this.retryCount || task.controller.signal.aborted) throw error;
            await new Promise<void>((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
          }
        }
      }).finally(() => { if (this.jobs.get(file.url) === task) this.jobs.delete(file.url); });
      this.jobs.set(file.url, task);
    }
    const task = job;
    task.consumers++;
    if (options.onProgress) task.listeners.add(options.onProgress);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return false;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        if (options.onProgress) task.listeners.delete(options.onProgress);
        task.consumers--;
        return true;
      };
      const onAbort = () => {
        if (!finish()) return;
        if (!task.consumers) {
          task.controller.abort();
          // Retry must wait for the old stream to release its checkpoint writer.
          task.promise.catch(() => undefined).then(() => reject(abortError()));
        } else reject(abortError());
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      task.promise.then((record) => { if (finish()) resolve(record); }, (error) => { if (finish()) reject(error); });
    });
  }

  private async schedule<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    else this.active++;
    try { return await task(); }
    finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }

  private progress(job: Job, bytes: number, total: number) {
    for (const listener of job.listeners) listener({ file: job.file.file, loaded: bytes, total, fraction: total ? bytes / total : null });
  }

  private async transfer(job: Job): Promise<DownloadRecord> {
    const { file, controller } = job;
    if (controller.signal.aborted) throw abortError();
    let record = await this.store.get(file.url);
    if (record?.complete && record.bytes === file.sizeBytes) {
      this.progress(job, record.bytes, record.total);
      return record;
    }
    let offset = record?.bytes ?? 0;
    if (offset > file.sizeBytes || record?.total !== file.sizeBytes) {
      await this.store.reset(file.url);
      offset = 0;
      record = undefined;
    }
    const headers: Record<string, string> = {};
    if (offset) {
      headers.Range = `bytes=${offset}-`;
      if (record?.etag) headers['If-Range'] = record.etag;
    }
    const response = await this.fetcher(file.url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${file.file}`);
    if (offset && response.status !== 206) {
      await this.store.reset(file.url);
      offset = 0;
    }
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
    if (response.status === 206 && (!range || Number(range[1]) !== offset || Number(range[3]) !== file.sizeBytes)) {
      await response.body?.cancel();
      await this.store.reset(file.url);
      throw new Error(`Invalid resumed download range: ${file.file}`);
    }
    const etag = response.headers.get('ETag') ?? undefined;
    if (offset && record?.etag && etag && record.etag !== etag) {
      await response.body?.cancel();
      await this.store.reset(file.url);
      throw new Error(`File changed during download: ${file.file}`);
    }
    record = { url: file.url, bytes: offset, total: file.sizeBytes, complete: false, etag, headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/octet-stream',
      'Content-Length': String(file.sizeBytes),
    } };
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`No download stream: ${file.file}`);
    let chunks: ArrayBuffer[] = [];
    let pending = 0;
    const checkpoint = async () => {
      if (!pending) return;
      record = { ...record!, bytes: record!.bytes + pending };
      await this.store.append(file.url, new Blob(chunks), record);
      chunks = [];
      pending = 0;
      this.progress(job, record.bytes, file.sizeBytes);
    };
    try {
      for (;;) {
        if (controller.signal.aborted) throw abortError();
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value.slice().buffer as ArrayBuffer);
        pending += value.byteLength;
        if (record.bytes + pending > file.sizeBytes) throw new Error(`Unexpected download size: ${file.file}`);
        if (pending >= this.checkpointBytes) await checkpoint();
        else this.progress(job, record.bytes + pending, file.sizeBytes);
      }
      await checkpoint();
      if (controller.signal.aborted) throw abortError();
      if (record.bytes !== file.sizeBytes) throw new Error(`Incomplete download size: ${file.file} (${record.bytes}/${file.sizeBytes})`);
      record.complete = true;
      await this.store.complete(file.url, record);
      this.progress(job, record.bytes, record.total);
      return record;
    } catch (error) {
      // Commit the final small block as well as full 1 MB checkpoints.
      if (record.bytes + pending <= file.sizeBytes) await checkpoint();
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally { reader.releaseLock(); }
  }
}

let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local model storage is unavailable in this browser.')); return; }
    const request = indexedDB.open('narrate-models-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('files', { keyPath: 'url' });
      request.result.createObjectStore('chunks', { keyPath: ['url', 'offset'] });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Local model storage failed.'));
  });
}
function chunkRange(url: string) { return IDBKeyRange.bound([url, 0], [url, Number.MAX_SAFE_INTEGER]); }

export const modelStore: DownloadStore = {
  async get(url) {
    const db = await openDatabase();
    return result<DownloadRecord | undefined>(db.transaction('files').objectStore('files').get(url));
  },
  async reset(url) {
    const db = await openDatabase();
    const tx = db.transaction(['files', 'chunks'], 'readwrite');
    const done = committed(tx);
    tx.objectStore('files').delete(url);
    tx.objectStore('chunks').delete(chunkRange(url));
    await done;
  },
  async append(url, chunk, metadata) {
    const db = await openDatabase();
    const tx = db.transaction(['files', 'chunks'], 'readwrite');
    const done = committed(tx);
    tx.objectStore('chunks').put({ url, offset: metadata.bytes - chunk.size, blob: chunk });
    tx.objectStore('files').put(metadata);
    await done;
  },
  async complete(_url, metadata) {
    const db = await openDatabase();
    const tx = db.transaction('files', 'readwrite');
    const done = committed(tx);
    tx.objectStore('files').put(metadata);
    await done;
  },
  async read(url) {
    const db = await openDatabase();
    const tx = db.transaction(['files', 'chunks']);
    const metadata = await result<DownloadRecord | undefined>(tx.objectStore('files').get(url));
    if (!metadata?.complete) return undefined;
    // Separate transaction because awaiting a request can close an idle transaction.
    const chunks = await result<{ blob: Blob }[]>(db.transaction('chunks').objectStore('chunks').getAll(chunkRange(url)));
    const blob = new Blob(chunks.map((chunk) => chunk.blob), { type: metadata.headers['Content-Type'] });
    if (blob.size !== metadata.bytes) throw new Error('Local model cache is incomplete. Download this model again.');
    return blob;
  },
};

/** Transformers.js reads this cache before attempting remote requests. */
export const runtimeModelCache = {
  async match(request: RequestInfo): Promise<Response | undefined> {
    const url = typeof request === 'string' ? request : request.url;
    const blob = await modelStore.read(url);
    if (!blob) return undefined;
    const metadata = await modelStore.get(url);
    return new Response(blob, { headers: metadata?.headers });
  },
  async put(request: RequestInfo, response: Response): Promise<void> {
    const url = typeof request === 'string' ? request : request.url;
    if ((await modelStore.get(url))?.complete) return;
    const blob = await response.blob();
    await modelStore.reset(url);
    const metadata: DownloadRecord = { url, bytes: blob.size, total: blob.size, complete: true, headers: Object.fromEntries(response.headers) };
    await modelStore.append(url, blob, metadata);
  },
};

export type InstallStatus = 'available' | 'queued' | 'downloading' | 'paused' | 'installed' | 'error';
export interface ModelInstall { cacheId: string; status: InstallStatus; loaded: number; total: number; file: string; error?: string }
const installs = new Map<string, ModelInstall>();
const observers = new Set<() => void>();
const sessions = new Map<string, { promise: Promise<void>; controller: AbortController }>();
const downloader = new ResumableDownloader({ store: modelStore });
function publish(state: ModelInstall) { installs.set(state.cacheId, state); for (const listener of observers) listener(); }

export function subscribeModelDownloads(listener: () => void): () => void {
  observers.add(listener);
  return () => { observers.delete(listener); };
}
export function modelInstall(cacheId: string): ModelInstall {
  return installs.get(cacheId) ?? { cacheId, status: 'available', loaded: 0, total: modelFiles(cacheId).reduce((sum, file) => sum + file.sizeBytes, 0), file: '' };
}

export async function refreshModelInstalls(): Promise<void> {
  for (const variant of MODEL_VARIANTS) {
    if (sessions.has(variant.cacheId)) continue;
    const files = modelFiles(variant.cacheId);
    const metadata = await Promise.all(files.map((file) => modelStore.get(file.url)));
    const installed = metadata.every((record, i) => record?.complete && record.bytes === files[i].sizeBytes);
    const loaded = metadata.reduce((sum, record) => sum + (record?.bytes ?? 0), 0);
    if (sessions.has(variant.cacheId)) continue;
    publish({ cacheId: variant.cacheId, status: installed ? 'installed' : loaded ? 'paused' : 'available', loaded, total: files.reduce((sum, file) => sum + file.sizeBytes, 0), file: '' });
  }
}

export function pauseModelDownload(cacheId: string): void { sessions.get(cacheId)?.controller.abort(); }

async function cacheOfflineVoices(files: DownloadFile[]) {
  if (typeof caches === 'undefined') throw new Error('Narrator storage is unavailable. Use a browser with local cache support.');
  const cache = await caches.open('kokoro-voices');
  for (const file of files.filter((file) => file.file.startsWith('voices/'))) {
    if (await cache.match(file.url)) continue;
    const response = await runtimeModelCache.match(file.url);
    if (!response) throw new Error(`Missing offline narrator: ${file.file}`);
    await cache.put(file.url, response);
  }
}

export function installModel(cacheId: string, onProgress?: (progress: ModelLoadProgress) => void): Promise<void> {
  const current = sessions.get(cacheId);
  if (current) return current.promise;
  const controller = new AbortController();
  const files = modelFiles(cacheId);
  const total = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  publish({ ...modelInstall(cacheId), status: 'queued', error: undefined });
  const promise = (async () => {
    let backgroundStarted = false;
    try {
      await beginBackgroundWork('Downloading voice models');
      backgroundStarted = true;
      await navigator.storage?.persist?.().catch(() => false);
      const loaded = new Map<string, number>();
      const stored = await Promise.all(files.map((file) => modelStore.get(file.url)));
      files.forEach((file, i) => loaded.set(file.url, stored[i]?.bytes ?? 0));
      await Promise.all(files.map((file) => downloader.download(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          loaded.set(file.url, progress.loaded);
          const count = [...loaded.values()].reduce((sum, bytes) => sum + bytes, 0);
          publish({ cacheId, status: 'downloading', loaded: count, total, file: progress.file });
          onProgress?.({ file: progress.file, loaded: count, total, fraction: count / total });
        },
      })));
      await cacheOfflineVoices(files);
      publish({ cacheId, status: 'installed', loaded: total, total, file: '' });
    } catch (error) {
      controller.abort();
      publish({ ...modelInstall(cacheId), status: isAborted(error) ? 'paused' : 'error', error: isAborted(error) ? undefined : error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      sessions.delete(cacheId);
      if (backgroundStarted) await endBackgroundWork();
    }
  })();
  sessions.set(cacheId, { promise, controller });
  return promise;
}
