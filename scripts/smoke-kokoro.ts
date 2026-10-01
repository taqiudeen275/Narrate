// Optional full-model check: node --import tsx scripts/smoke-kokoro.ts <model-directory>
// Supply the exact pinned q8 ONNX file and its three JSON files. No downloads
// occur here; the regular verification suites do not require model weights.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { KokoroTTS } from 'kokoro-js';
import { env } from '@huggingface/transformers';
import { MODEL_REPO, MODEL_REVISION, modelFileUrl, modelVariant } from '../src/core/tts/downloads';

const directory = process.argv[2];
if (!directory) throw new Error('Supply the directory containing the pinned q8 model and tokenizer files.');
const variant = modelVariant('kokoro-q8');
const files = new Map<string, Uint8Array>();
for (const file of [variant.file, 'config.json', 'tokenizer.json', 'tokenizer_config.json']) {
  const bytes = await readFile(path.join(directory, file));
  if (file === variant.file) assert.equal(bytes.length, variant.sizeBytes, 'the pinned q8 export has the expected size');
  files.set(modelFileUrl(file), new Uint8Array(bytes));
}
let networkRequests = 0;
globalThis.fetch = async () => { networkRequests++; throw new Error('Network is blocked during real Kokoro synthesis.'); };
env.useCustomCache = true;
env.customCache = {
  async match(request: string | Request | URL) {
    const bytes = files.get(request instanceof Request ? request.url : String(request));
    return bytes ? new Response(bytes.slice().buffer) : undefined;
  },
  async put() { throw new Error('The smoke test must use already supplied model files.'); },
};
env.useBrowserCache = false;
env.useFSCache = false;
env.useWasmCache = false;
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
const started = performance.now();
const engine = await KokoroTTS.from_pretrained(MODEL_REPO, { dtype: variant.dtype, device: 'cpu' });
try {
  const loaded = performance.now();
  const output = await engine.generate('Offline speech is ready. Your saved audio stays on this device.', { voice: 'af_heart', speed: 1 });
  assert(output.audio instanceof Float32Array);
  assert.equal(output.sampling_rate, 24000);
  const duration = output.audio.length / output.sampling_rate;
  assert(duration > 1 && duration < 30, 'real synthesis has a sensible duration');
  let energy = 0;
  for (const sample of output.audio) {
    assert(Number.isFinite(sample), 'real PCM remains finite');
    energy += sample * sample;
  }
  assert(energy / output.audio.length > 0.000001, 'real speech has a nonzero signal');
  assert.equal(networkRequests, 0, 'tokenizer, phonemizer, model and packaged narrator work offline');
  console.log(JSON.stringify({ check: 'real-offline-kokoro', transformers: env.version, model: variant.cacheId,
    backend: 'native-node-cpu', sampleRate: output.sampling_rate, samples: output.audio.length,
    durationSeconds: duration, loadSeconds: (loaded - started) / 1000,
    generationSeconds: (performance.now() - loaded) / 1000, networkRequests }));
  console.log('This checks the actual Kokoro model/API with native CPU inference; mobile GPU quality and speed are unmeasured.');
} finally { await engine.model.dispose(); }
