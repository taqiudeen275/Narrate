/** Installer cancellation must drain its checkpoint writer before allowing resume. */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

const checkpointStarted = deferred();
const releaseCheckpoint = deferred();
const sharedStarted = deferred();
const otherWeightStarted = deferred();
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
globalThis.fetch = async (input, options) => {
  const url = String(input);
  if (url.endsWith('/model_quantized.onnx')) {
    // The transfer writes a real 1 MB durable checkpoint before cancellation.
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
    }));
  }
  if (url.endsWith('/tokenizer_config.json')) sharedStarted.resolve();
  if (url.endsWith('/model_q4.onnx')) otherWeightStarted.resolve();
  const signal = options?.signal;
  return new Promise<Response>((_resolve, reject) => {
    const abort = () => reject(new DOMException('Controlled request cancelled', 'AbortError'));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
};
// These narrators are already cached; no cache copy is needed in this scenario.
globalThis.caches = { open: async () => ({ match: async () => new Response('cached narrator') }) } as unknown as CacheStorage;
const { modelFiles, modelStore, installModel, pauseModelDownload, modelInstall } = await import('../src/core/tts/downloads');
const append = modelStore.append.bind(modelStore);
modelStore.append = async (url, chunk, record) => {
  await append(url, chunk, record);
  if (url.endsWith('/model_quantized.onnx')) {
    checkpointStarted.resolve();
    await releaseCheckpoint.promise;
  }
};

let first: Promise<void> | undefined;
let other: Promise<void> | undefined;
try {
  // Only each model's weights and one shared tokenizer remain to be downloaded.
  for (const id of ['kokoro-q8', 'kokoro-q4']) {
    for (const file of modelFiles(id)) {
      if (file.file.endsWith('.onnx') || file.file === 'tokenizer_config.json') continue;
      await modelStore.complete(file.url, {
        url: file.url, bytes: file.sizeBytes, total: file.sizeBytes, complete: true, headers: {},
      });
    }
  }
  let ended = false;
  first = installModel('kokoro-q8');
  void first.then(() => { ended = true; }, () => { ended = true; });
  other = installModel('kokoro-q4');
  void other.catch(() => undefined);
  await Promise.all([checkpointStarted.promise, sharedStarted.promise, otherWeightStarted.promise]);
  pauseModelDownload('kokoro-q8');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ended, false, 'pause retains its session until the private checkpoint writer drains');
  assert.equal(installModel('kokoro-q8'), first, 'resume waits for the draining session rather than joining an aborted file job');
  releaseCheckpoint.resolve();
  await assert.rejects(first, { name: 'AbortError' });
  assert.equal(modelInstall('kokoro-q8').status, 'paused');
  const weights = modelFiles('kokoro-q8').find((file) => file.file.endsWith('.onnx'))!;
  assert.equal((await modelStore.get(weights.url))?.bytes, 1024 * 1024, 'cancelled writer preserves its durable checkpoint');
  console.log('Installer cancellation regression passed: shared transfer cancellation drains the private writer before the session ends.');
} finally {
  releaseCheckpoint.resolve();
  pauseModelDownload('kokoro-q8');
  pauseModelDownload('kokoro-q4');
  await Promise.allSettled([first, other]);
  modelStore.append = append;
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}
