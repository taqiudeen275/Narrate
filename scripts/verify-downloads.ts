/** Run with npx tsx scripts/verify-downloads.ts. Uses real HTTP range transfers. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// Before implementation, this assertion reports the missing feature deliberately.
const downloads = await import('../src/core/tts/downloads').catch(() => ({}));
assert.equal(typeof downloads.ResumableDownloader, 'function', 'resumable model downloader exists');
const { ResumableDownloader, MODEL_VARIANTS, modelFiles, modelFileUrl, DEFAULT_MODEL_ID } = downloads;

class MemoryStore {
  files = new Map<string, any>();
  chunks = new Map<string, Blob[]>();
  async get(url: string) { return structuredClone(this.files.get(url)); }
  async reset(url: string) { this.files.delete(url); this.chunks.delete(url); }
  async append(url: string, chunk: Blob, meta: any) {
    this.chunks.set(url, [...this.chunks.get(url) ?? [], chunk]);
    this.files.set(url, structuredClone(meta));
  }
  async complete(url: string, meta: any) { this.files.set(url, structuredClone(meta)); }
  async read(url: string) { return this.files.get(url)?.complete ? new Blob(this.chunks.get(url)) : undefined; }
}

assert.equal(DEFAULT_MODEL_ID, 'kokoro-q8');
for (const variant of MODEL_VARIANTS) {
  const files = modelFiles(variant.cacheId);
  assert(files.some((file: any) => file.url === modelFileUrl(variant.file)), 'runtime and installer use the same weights URL');
  assert(files.some((file: any) => file.file === 'tokenizer.json'), 'offline install includes tokenizer');
  assert(files.some((file: any) => file.file === 'voices/af_bella.bin'), 'offline install includes narrator data');
  assert.equal(new Set(files.map((file: any) => file.url)).size, files.length);
}
assert.throws(() => modelFiles('piper'), /unknown|supported/i, 'unsupported engines cannot silently use Kokoro');
const { WebKokoroEngine } = await import('../src/core/tts/web');
assert.equal(new WebKokoroEngine('kokoro-q4').id, 'kokoro-q4', 'selected model identity survives the engine boundary');
const { availableVoices } = await import('../src/core/tts/voices');
assert(availableVoices().every((voice: any) => downloads.SUPPORTED_VOICE_IDS.includes(voice.id)), 'every selectable narrator is supported by the installed Kokoro JS engine');

const payload = new Uint8Array(96 * 1024).map((_, i) => i % 251);
const ranges: string[] = [];
let parallelActive = 0;
let parallelPeak = 0;
let requests = 0;
const server = createServer((req, res) => {
  requests++;
  const parallel = req.url?.startsWith('/parallel-');
  let sending = true;
  const finishBody = () => {
    if (!sending) return;
    sending = false;
    if (parallel) parallelActive--;
  };
  if (parallel) {
    parallelActive++;
    parallelPeak = Math.max(parallelPeak, parallelActive);
  }
  res.on('close', finishBody);
  const range = String(req.headers.range ?? '');
  ranges.push(range);
  const offset = Number(/bytes=(\d+)-/.exec(range)?.[1] ?? 0);
  const ignoreRange = req.url?.includes('ignore-range');
  const start = ignoreRange ? 0 : offset;
  const body = payload.subarray(start);
  res.writeHead(start ? 206 : 200, {
    'Content-Length': body.byteLength,
    'Content-Type': 'application/octet-stream',
    'ETag': '"test-version"',
    ...(start ? { 'Content-Range': `bytes ${start}-${payload.length - 1}/${payload.length}` } : {}),
  });
  let position = 0;
  const tick = () => {
    if (res.destroyed) { finishBody(); return; }
    if (position >= body.length) { finishBody(); res.end(); return; }
    res.write(body.subarray(position, position + 8192));
    position = Math.min(position + 8192, body.length);
    // Content-Length lets the client finish on the last byte. Finish the
    // fixture at that same boundary, before another transfer takes its slot.
    if (position === body.length) { finishBody(); res.end(); return; }
    setTimeout(tick, 3);
  };
  tick();
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
try {
  // Browsers that validate fetch's Window receiver must not receive the
  // downloader instance. Node's permissive fetch hid this mobile failure.
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = function (this: unknown, input, init) {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    return nativeFetch.call(globalThis, input, init);
  };
  try {
    const receiverStore = new MemoryStore();
    const receiverDownloader = new ResumableDownloader({ store: receiverStore, retryCount: 0 });
    await receiverDownloader.download({ url: `${base}/window-fetch`, file: 'window-fetch', sizeBytes: payload.length });
    assert.deepEqual(new Uint8Array(await (await receiverStore.read(`${base}/window-fetch`))!.arrayBuffer()), payload,
      'default fetch downloads successfully with a receiver-sensitive browser host');

    const customClient = {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        assert.equal(this, customClient, 'injected bound fetch retains its own receiver');
        return nativeFetch.call(globalThis, input, init);
      },
    };
    const injectedStore = new MemoryStore();
    const injected = new ResumableDownloader({ store: injectedStore, fetcher: customClient.fetch.bind(customClient), retryCount: 0 });
    await injected.download({ url: `${base}/custom-fetch`, file: 'custom-fetch', sizeBytes: payload.length });
    assert.deepEqual(new Uint8Array(await (await injectedStore.read(`${base}/custom-fetch`))!.arrayBuffer()), payload,
      'injected fetch still transfers and persists the original bytes');
  } finally { globalThis.fetch = nativeFetch; }

  const store = new MemoryStore();
  const downloader = new ResumableDownloader({ store, concurrency: 3, checkpointBytes: 8192, retryCount: 0 });
  const controller = new AbortController();
  await assert.rejects(downloader.download({ url: `${base}/resume`, file: 'resume', sizeBytes: payload.length }, {
    signal: controller.signal,
    onProgress: (progress: any) => { if (progress.loaded >= 24576) controller.abort(); },
  }), /abort/i);
  const partial = await store.get(`${base}/resume`);
  assert(partial.bytes > 0 && partial.bytes < payload.length, 'interrupted transfer commits useful partial bytes');
  assert.equal(partial.complete, false, 'partial cache never reports installed');
  const next = new ResumableDownloader({ store, concurrency: 3, checkpointBytes: 8192, retryCount: 0 });
  await next.download({ url: `${base}/resume`, file: 'resume', sizeBytes: payload.length });
  assert(ranges.includes(`bytes=${partial.bytes}-`), 'new downloader resumes durable checkpoint');
  assert.deepEqual(new Uint8Array(await (await store.read(`${base}/resume`))!.arrayBuffer()), payload);
  const before = requests;
  await next.download({ url: `${base}/resume`, file: 'resume', sizeBytes: payload.length });
  assert.equal(requests, before, 'offline reuse makes no network request');

  const duplicated = { url: `${base}/shared`, file: 'shared', sizeBytes: payload.length };
  const sharedBefore = requests;
  await Promise.all([next.download(duplicated), next.download(duplicated)]);
  assert.equal(requests, sharedBefore + 1, 'concurrent models share common file transfers');
  const rejoinStore = new MemoryStore();
  let releaseCheckpoint!: () => void;
  const checkpointHeld = new Promise<void>((resolve) => { releaseCheckpoint = resolve; });
  let checkpointEntered!: () => void;
  const checkpointStarted = new Promise<void>((resolve) => { checkpointEntered = resolve; });
  const appendCheckpoint = rejoinStore.append.bind(rejoinStore);
  let holdFirstCheckpoint = true;
  rejoinStore.append = async (url, chunk, meta) => {
    await appendCheckpoint(url, chunk, meta);
    if (holdFirstCheckpoint) {
      holdFirstCheckpoint = false;
      checkpointEntered();
      await checkpointHeld;
    }
  };
  const rejoinDownloader = new ResumableDownloader({ store: rejoinStore, checkpointBytes: 8192, retryCount: 0 });
  const rejoinFile = { url: `${base}/cancel-rejoin`, file: 'cancel-rejoin', sizeBytes: payload.length };
  const rejoinController = new AbortController();
  const cancelled = rejoinDownloader.download(rejoinFile, { signal: rejoinController.signal });
  const cancellation = assert.rejects(cancelled, { name: 'AbortError' });
  await checkpointStarted;
  rejoinController.abort();
  const resumed = rejoinDownloader.download(rejoinFile);
  releaseCheckpoint();
  await assert.doesNotReject(resumed, 'a fresh consumer waits for the aborted writer and resumes its checkpoint');
  await cancellation;
  assert.deepEqual(new Uint8Array(await (await rejoinStore.read(rejoinFile.url))!.arrayBuffer()), payload);

  await Promise.all(Array.from({ length: 7 }, (_, i) => next.download({ url: `${base}/parallel-${i}`, file: `${i}`, sizeBytes: payload.length })));
  assert(parallelPeak >= 2 && parallelPeak <= 3, `controlled parallel transfers: peak ${parallelPeak}`);

  const ignored = { url: `${base}/ignore-range`, file: 'ignored', sizeBytes: payload.length };
  await store.append(ignored.url, new Blob([payload.subarray(0, 8192)]), {
    url: ignored.url, bytes: 8192, total: payload.length, complete: false, etag: '"test-version"', headers: {},
  });
  await next.download(ignored);
  assert.deepEqual(new Uint8Array(await (await store.read(ignored.url))!.arrayBuffer()), payload, 'server ignoring Range restarts cleanly without duplicate bytes');
  await assert.rejects(next.download({ url: `${base}/wrong-size`, file: 'bad', sizeBytes: payload.length + 1 }), /size|length|incomplete/i);
  assert.equal((await store.get(`${base}/wrong-size`))?.complete, false, 'truncated weights never become ready');
  const allBytes = { url: `${base}/all-bytes`, file: 'all-bytes', sizeBytes: payload.length };
  await store.append(allBytes.url, new Blob([payload]), { url: allBytes.url, bytes: payload.length, total: payload.length, complete: false, headers: {} });
  const beforeComplete = requests;
  await next.download(allBytes);
  assert.equal(requests, beforeComplete, 'checkpointed full-size file completes locally, avoiding invalid EOF Range');
  assert.equal((await store.get(allBytes.url))?.complete, true);
  console.log('Model download checks passed: browser fetch receiver, injected fetch, resume, offline reuse, deduplication, parallel limit, range fallback, size validation, catalogue paths.');
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
