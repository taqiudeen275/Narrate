import { get, set } from 'idb-keyval';
import { DEFAULT_MODEL_ID, MODEL_VARIANTS } from './downloads';

export interface DeviceHints { mobile: boolean; memoryGB: number | null; cores: number | null }
export interface Measurement { audioSeconds: number; elapsedMs: number; count: number }
export type Measurements = Record<string, Measurement>;
const observers = new Set<() => void>();
let measurements: Measurements = {};
let pending: Promise<unknown> = Promise.resolve();
const KEY = 'narrate:v2:device-performance';

function validMeasurement(sample: unknown): sample is Measurement {
  if (!sample || typeof sample !== 'object') return false;
  const value = sample as Measurement;
  return Number.isFinite(value.audioSeconds) && value.audioSeconds > 0 &&
    Number.isFinite(value.elapsedMs) && value.elapsedMs > 0 &&
    Number.isSafeInteger(value.count) && value.count > 0;
}

function cleanMeasurements(saved: unknown): Measurements {
  if (!saved || typeof saved !== 'object') return {};
  return Object.fromEntries(Object.entries(saved).filter(([id, sample]) =>
    MODEL_VARIANTS.some(model => model.cacheId === id) && validMeasurement(sample)));
}

/** Browser memory/CPU values are coarse hints, never an exact hardware inventory. */
export function deviceHints(): DeviceHints {
  if (typeof navigator === 'undefined') return { mobile: false, memoryGB: null, cores: null };
  const client = navigator as Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean } };
  return { mobile: client.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(client.userAgent),
    memoryGB: Number.isFinite(client.deviceMemory) && client.deviceMemory! > 0 ? client.deviceMemory! : null,
    cores: Number.isFinite(client.hardwareConcurrency) && client.hardwareConcurrency > 0 ? client.hardwareConcurrency : null };
}
export function recommendModel(hints: DeviceHints, observed: Measurements) {
  // Conservative headroom estimate, explicitly presented as guidance. Actual
  // ONNX allocations vary, so a hint alone never promises that a model fits.
  const fits = MODEL_VARIANTS.filter(model => hints.memoryGB === null ||
    model.sizeBytes * 4 / 1024 ** 3 + 0.5 <= hints.memoryGB * 0.5);
  const timed = fits.map(model => {
    const sample = observed[model.cacheId];
    const factor = validMeasurement(sample) && sample.count >= 3 && sample.audioSeconds >= 3
      ? sample.elapsedMs / 1000 / sample.audioSeconds : null;
    return { model, factor };
  }).filter(item => item.factor !== null).sort((a, b) => a.factor! - b.factor!);
  const fastest = timed[0];
  const modelId = fastest?.model.cacheId ?? DEFAULT_MODEL_ID;
  const realtimeFactor = fastest?.factor ?? null;
  const mode = realtimeFactor !== null && realtimeFactor > 1 ? 'full' as const : 'stream' as const;
  const reason = fastest ? `Based on ${observed[modelId].count} sentences generated at normal pace on this device, this is the fastest measured edition${hints.memoryGB === null ? '. Memory reporting is unavailable, so available memory still needs to be considered.' : ' with estimated memory headroom.'}`
    : hints.memoryGB === null ? 'Memory reporting is unavailable here. Start with the smallest supported edition; recommendations learn from your generation speed.'
    : hints.memoryGB <= 4 || hints.cores !== null && hints.cores <= 4
      ? `The smallest supported edition leaves more memory for your ${hints.mobile ? 'phone' : 'device'} and document. Larger editions can take longer on this device.`
      : 'Start with the smallest supported edition for efficient rendering. Measured generation speed will refine this recommendation.';
  return { modelId, realtimeFactor, mode, reason, measured: !!fastest };
}

/** Advice is optional: hardware reports never hide or block a supported model. */
export function modelDownloadWarning(modelId: string, hints: DeviceHints, observed: Measurements): { title: string; reason: string } | null {
  const model = MODEL_VARIANTS.find(edition => edition.cacheId === modelId);
  if (!model) return null;
  const workingMemoryGB = model.sizeBytes * 4 / 1024 ** 3 + 0.5;
  if (hints.memoryGB !== null && workingMemoryGB > hints.memoryGB * 0.5) {
    return { title: 'This edition may need too much memory',
      reason: `The reported ${hints.memoryGB} GB of memory leaves limited headroom for this edition and your document. Generation may be slow or stop if memory runs out. This is an estimate; you can still try it.` };
  }
  const sample = observed[modelId];
  const factor = validMeasurement(sample) && sample.count >= 3 && sample.audioSeconds >= 3
    ? sample.elapsedMs / 1000 / sample.audioSeconds : null;
  if (factor !== null && factor > 1) {
    return { title: 'This edition generates slower than playback',
      reason: `On this device, 10 minutes of audio took about ${Math.max(1, Math.round(factor * 10))} minutes to generate at normal pace, excluding model loading. Use Render all before listening to avoid pauses. Speed can change with temperature and other apps.` };
  }
  if (modelId !== DEFAULT_MODEL_ID && modelId !== recommendModel(hints, observed).modelId) {
    return { title: 'Try a larger edition?',
      reason: hints.memoryGB === null
        ? 'Memory reporting is unavailable on this device. This edition has a larger download and needs more memory than Balanced; rendering may take longer or run out of memory. You can still download and compare it.'
        : 'This edition has a larger download and needs more memory than Balanced. Rendering may take longer even on a powerful phone; generate a few sentences to measure it on your device. You can still download and compare it.' };
  }
  return null;
}
export function deviceMeasurements() { return measurements; }
export function subscribeDeviceMeasurements(listener: () => void) {
  observers.add(listener);
  return () => { observers.delete(listener); };
}
export function loadDeviceMeasurements() {
  pending = pending.catch(() => undefined).then(async () => {
    measurements = cleanMeasurements(await get(KEY));
    for (const observer of observers) observer();
  });
  return pending;
}
/** Compare normal-pace generation only; changing speed changes inference work. */
export function recordGenerationMeasurement(modelId: string, audioSeconds: number, elapsedMs: number, speed = 1) {
  if (speed !== 1 || !MODEL_VARIANTS.some(model => model.cacheId === modelId) ||
    !Number.isFinite(audioSeconds) || audioSeconds <= 0 || !Number.isFinite(elapsedMs) || elapsedMs <= 0) return Promise.resolve();
  pending = pending.catch(() => undefined).then(async () => {
    const previous = validMeasurement(measurements[modelId]) ? measurements[modelId] : undefined;
    const weight = previous && previous.count >= 12 ? 0.9 : 1;
    measurements = { ...measurements, [modelId]: {
      audioSeconds: (previous?.audioSeconds ?? 0) * weight + audioSeconds,
      elapsedMs: (previous?.elapsedMs ?? 0) * weight + elapsedMs,
      count: (previous?.count ?? 0) + 1,
    } };
    await set(KEY, measurements);
    for (const observer of observers) observer();
  });
  return pending;
}
