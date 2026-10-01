import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { get, set } from 'idb-keyval';
const device = await import('../src/core/tts/device').catch(() => ({}));
assert.equal(typeof device.recommendModel, 'function', 'device-aware recommendations exist');
const { recommendModel } = device;
const low = recommendModel({ mobile: true, memoryGB: 2, cores: 4 }, {});
assert.equal(low.modelId, 'kokoro-q8', 'small phone starts with the smallest actual file');
assert.match(low.reason, /memory|small/i);
assert.equal(low.mode, 'stream');
const unknown = recommendModel({ mobile: true, memoryGB: null, cores: null }, {});
assert.equal(unknown.modelId, 'kokoro-q8');
assert.match(unknown.reason, /unknown|unavailable|report/i);
const slow = recommendModel({ mobile: true, memoryGB: 4, cores: 8 }, {
  'kokoro-q8': { audioSeconds: 40, elapsedMs: 80000, count: 5 },
});
assert.equal(slow.mode, 'full', 'slower-than-playback devices are advised to render first');
assert.equal(slow.realtimeFactor, 2);
const measured = recommendModel({ mobile: false, memoryGB: 16, cores: 16 }, {
  'kokoro-q8': { audioSeconds: 100, elapsedMs: 120000, count: 5 },
  'kokoro-fp32': { audioSeconds: 100, elapsedMs: 60000, count: 5 },
});
assert.equal(measured.modelId, 'kokoro-fp32', 'real measurements can override the default on a capable device');
const notEnoughMemory = recommendModel({ mobile: true, memoryGB: 2, cores: 8 }, {
  'kokoro-q8': { audioSeconds: 100, elapsedMs: 120000, count: 5 },
  'kokoro-fp32': { audioSeconds: 100, elapsedMs: 60000, count: 5 },
});
assert.equal(notEnoughMemory.modelId, 'kokoro-q8', 'memory headroom outweighs faster measured high-memory model');
assert.equal(recommendModel({ mobile: true, memoryGB: 4, cores: 4 }, {
  'kokoro-q8': { audioSeconds: NaN, elapsedMs: 1, count: 1 },
}).modelId, 'kokoro-q8', 'invalid measurements do not produce invalid recommendation');
console.log('Device recommendation checks passed: small phones, missing hints, real measured speed, slow-stream advice and memory headroom.');

const key = 'narrate:v2:device-performance';
await set(key, { 'kokoro-q8': { audioSeconds: 30, elapsedMs: 30000, count: 3 } });
await device.loadDeviceMeasurements();
await Promise.all([device.loadDeviceMeasurements(), device.recordGenerationMeasurement('kokoro-q8', 10, 10000)]);
assert.equal(device.deviceMeasurements()['kokoro-q8'].count, 4, 'reload and recording retain the new in-memory observation');
await device.recordGenerationMeasurement('kokoro-q8', 10, 10000);
assert.equal((await get(key))['kokoro-q8'].count, 5, 'later recordings retain every sample');
await set(key, { 'kokoro-q8': { audioSeconds: NaN, elapsedMs: 30000, count: 3 } });
await device.loadDeviceMeasurements();
await device.recordGenerationMeasurement('kokoro-q8', 10, 10000);
assert.deepEqual(device.deviceMeasurements()['kokoro-q8'], { audioSeconds: 10, elapsedMs: 10000, count: 1 }, 'invalid saved data recovers with a valid observation');
const before = device.deviceMeasurements()['kokoro-q8'];
await device.recordGenerationMeasurement('kokoro-q8', 10, 10000, 2);
assert.deepEqual(device.deviceMeasurements()['kokoro-q8'], before, 'different playback speeds do not skew normal-pace comparisons');
assert.doesNotMatch(recommendModel({ mobile: false, memoryGB: 2, cores: 4 }, {}).reason, /phone/);
assert.doesNotMatch(recommendModel({ mobile: false, memoryGB: null, cores: 4 }, { 'kokoro-q8': { audioSeconds: 30, elapsedMs: 30000, count: 3 } }).reason, /estimated memory headroom/);
console.log('Device persistence checks passed: serialized reloads, invalid-data recovery and comparable normal-pace observations.');

assert.equal(typeof device.modelDownloadWarning, 'function', 'downloads can explain device-specific risks before starting');
const smallPhone = { mobile: true, memoryGB: 2, cores: 4 };
assert.equal(device.modelDownloadWarning('kokoro-q8', smallPhone, {}), null, 'recommended small edition needs no warning');
assert.match(device.modelDownloadWarning('kokoro-fp32', smallPhone, {})!.reason, /memory/i);
assert.match(device.modelDownloadWarning('kokoro-q4', smallPhone, {})!.reason, /memory/i);
assert.match(device.modelDownloadWarning('kokoro-fp32', { mobile: true, memoryGB: null, cores: 8 }, {})!.reason, /unavailable|report/i);
const flagship = { mobile: true, memoryGB: 8, cores: 8 };
assert.match(device.modelDownloadWarning('kokoro-fp32', flagship, {})!.reason, /larger|more memory/i);
assert.equal(device.modelDownloadWarning('kokoro-fp32', flagship, {
  'kokoro-fp32': { audioSeconds: 100, elapsedMs: 60000, count: 5 },
}), null, 'a measured fast edition with memory headroom is not discouraged');
assert.match(device.modelDownloadWarning('kokoro-q8', flagship, {
  'kokoro-q8': { audioSeconds: 40, elapsedMs: 80000, count: 5 },
})!.reason, /slower|20 minutes/i);
console.log('Download advice checks passed: small phones, unknown memory, flagships, measured fast and slow models.');
