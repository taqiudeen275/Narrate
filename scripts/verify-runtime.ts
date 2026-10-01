import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { configureKokoroRuntime } from '../src/core/tts/runtime';
import { modelFileUrl, runtimeModelCache } from '../src/core/tts/downloads';
import { getModelFile } from '../node_modules/@huggingface/transformers/src/utils/hub.js';
import { env as sourceEnv } from '../node_modules/@huggingface/transformers/src/env.js';
import { env } from '@huggingface/transformers';

const url = modelFileUrl('tokenizer_config.json');
await runtimeModelCache.put(url, new Response('{"offline":true}'));
configureKokoroRuntime();
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
console.log('Runtime offline regression passed: real Transformers cache loader and packaged eSpeak phonemizer work with network disabled.');
