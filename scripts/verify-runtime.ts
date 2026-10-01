import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureKokoroRuntime, LOCAL_WASM_URL, LOCAL_WASM_MODULE_URL,
  LOCAL_GPU_WASM_URL, LOCAL_GPU_WASM_MODULE_URL } from '../src/core/tts/runtime';
import { modelFileUrl, runtimeModelCache } from '../src/core/tts/downloads';
import { getModelFile } from '../node_modules/@huggingface/transformers/src/utils/hub.js';
import { env as sourceEnv } from '../node_modules/@huggingface/transformers/src/env.js';
import { env } from '@huggingface/transformers';
import { env as kokoroEnv } from 'kokoro-js';
import { InferenceSession, Tensor, env as webOnnxEnv } from 'onnxruntime-web/wasm';

const url = modelFileUrl('tokenizer_config.json');
await runtimeModelCache.put(url, new Response('{"offline":true}'));
configureKokoroRuntime('webgpu');
assert.match(new URL(LOCAL_GPU_WASM_URL).pathname, /ort-wasm-simd-threaded\.asyncify\.wasm$/,
  'offline GPU inference uses the native runtime binary rather than the old JSEP runtime');
assert.match(new URL(LOCAL_GPU_WASM_MODULE_URL).pathname, /ort-wasm-simd-threaded\.asyncify\.mjs$/,
  'the bundled GPU module matches its native runtime binary');
assert.deepEqual(env.backends.onnx.wasm?.wasmPaths, { wasm: LOCAL_GPU_WASM_URL, mjs: LOCAL_GPU_WASM_MODULE_URL },
  'GPU initialization receives both local native runtime assets');
assert.deepEqual(kokoroEnv.wasmPaths, { wasm: LOCAL_GPU_WASM_URL, mjs: LOCAL_GPU_WASM_MODULE_URL },
  'Kokoro receives the same configured Transformers instance rather than a nested older dependency');
assert.equal(env.backends.onnx.wasm?.numThreads, 1, 'the single-thread native GPU build is not configured for CPU threads');
configureKokoroRuntime();
assert.match(new URL(LOCAL_WASM_URL).pathname, /ort-wasm-simd-threaded\.wasm$/,
  'CPU fallback keeps its matching threaded runtime binary');
assert.match(new URL(LOCAL_WASM_MODULE_URL).pathname, /ort-wasm-simd-threaded\.mjs$/,
  'CPU fallback keeps its matching threaded runtime module');
assert.deepEqual(env.backends.onnx.wasm?.wasmPaths, { wasm: LOCAL_WASM_URL, mjs: LOCAL_WASM_MODULE_URL },
  'the package instance receives both local runtime assets');
assert.deepEqual(kokoroEnv.wasmPaths, { wasm: LOCAL_WASM_URL, mjs: LOCAL_WASM_MODULE_URL },
  'Kokoro sees the configured CPU asset pair for offline fallback');
assert.equal(env.useWasmCache, false, 'bundled runtime assets avoid an external WASM cache fetch');
for (const [binary, module] of [[LOCAL_WASM_URL, LOCAL_WASM_MODULE_URL], [LOCAL_GPU_WASM_URL, LOCAL_GPU_WASM_MODULE_URL]]) {
  const wasm = await readFile(new URL(binary));
  assert.deepEqual([...wasm.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0], 'each packaged runtime asset is a WASM binary');
  assert((await readFile(new URL(module))).length > 0, 'each matching runtime module exists locally');
}
// The exported package bundles its own copy. Exercise the upstream loader
// using exactly the configuration passed to the worker's package instance.
Object.assign(sourceEnv, env);
let requests = 0;
globalThis.fetch = async () => { requests++; throw new Error('Network is disabled for offline verification'); };
const result = await getModelFile('onnx-community/Kokoro-82M-v1.0-ONNX', 'tokenizer_config.json', true);
assert.equal(new TextDecoder().decode(result), '{"offline":true}');
assert.equal(requests, 0, 'real Transformers cache load never needs a network request');
const { phonemize } = await import('phonemizer');
const phones = await phonemize('Offline speech is ready.', 'en-us');
assert(phones.join('').length > 0, 'the packaged eSpeak phonemizer works with network blocked');
assert.equal(requests, 0, 'phonemizer data and WASM do not fetch external assets');

// The separately bundled threaded CPU build must run fallback. This tiny, hand-checked
// opset-13 Add graph needs no Kokoro model download and tests the actual ABI.
const addModel = Uint8Array.from(Buffer.from(
  '08083a540a100a01780a0179120373756d2203416464120b6f66666c696e652d6164645a0f0a0178120a0a08080112040a0208025a0f0a0179120a0a08080112040a02080262110a0373756d120a0a08080112040a0208024202100d', 'hex'));
Object.assign(webOnnxEnv.wasm, env.backends.onnx.wasm);
const session = await InferenceSession.create(addModel, { executionProviders: ['wasm'] });
try {
  const output = await session.run({
    x: new Tensor('float32', new Float32Array([0.5, -0.5]), [2]),
    y: new Tensor('float32', new Float32Array([0.25, -0.25]), [2]),
  });
  assert.deepEqual([...output.sum.data], [0.75, -0.75], 'matching local CPU runtime assets execute fallback inference');
  assert.equal(requests, 0, 'local runtime initialization and CPU inference never fetch external assets');
} finally { await session.release(); }
console.log('Runtime offline regression passed: real Transformers cache loader, packaged eSpeak, local CPU/GPU asset pairs and actual ONNX CPU inference work with network disabled. No real GPU inference is measured.');
