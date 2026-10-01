import { env } from '@huggingface/transformers';
import { MODEL_REVISION, runtimeModelCache } from './downloads';
import type { KokoroBackend, KokoroRuntimeInfo } from './worker-types';
import { isKokoroMobileHost } from './runtime-capabilities';

/** Vite packages the matching runtime binary into the APK/web assets. */
export const LOCAL_WASM_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href;
export const LOCAL_WASM_MODULE_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs', import.meta.url).href;

/** The probe device is disposable; ONNX creates its own device with its limits. */
interface GpuProbe {
  requestAdapter(options: { powerPreference: 'high-performance' }): Promise<{
    requestDevice(): Promise<{ destroy(): void }>;
  } | null>;
}

export async function selectKokoroBackend(dtype: string, preferred: 'auto' | 'wasm' = 'auto', mobile = false):
  Promise<{ backend: KokoroBackend; reason: string }> {
  if (preferred === 'wasm') return { backend: 'wasm', reason: 'CPU inference requested.' };
  const client = typeof navigator === 'undefined' ? undefined : navigator;
  // Transformers 3.x/JSEP can return corrupt Kokoro audio on Android without
  // throwing (#1320). Keep mobile off until a tested runtime migration.
  if (mobile || isKokoroMobileHost(client)) {
    return { backend: 'wasm', reason: 'Mobile GPU inference is disabled because this runtime can produce corrupted audio.' };
  }
  // The library recommends fp32 for GPU. Quantization is model-specific; q8's
  // integer operators are not supported by this pinned WebGPU implementation.
  if (dtype !== 'fp32') return { backend: 'wasm', reason: 'This quantized edition uses CPU inference; GPU is enabled only for full precision in this version.' };
  const gpu = (client as (Navigator & { gpu?: GpuProbe }) | undefined)?.gpu;
  if (!globalThis.isSecureContext || !gpu) return { backend: 'wasm', reason: 'WebGPU is unavailable in this app or browser.' };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { backend: 'wasm', reason: 'No supported WebGPU adapter is available.' };
    const device = await adapter.requestDevice();
    device.destroy();
    return { backend: 'webgpu', reason: 'WebGPU inference selected; unsupported operations may still use CPU.' };
  } catch {
    return { backend: 'wasm', reason: 'WebGPU device creation failed; CPU inference remains available.' };
  }
}

export function kokoroRuntimeInfo(backend: KokoroBackend, reason: string): KokoroRuntimeInfo {
  // ONNX can reduce this setting to one if its shared-memory capability check
  // fails. Read it after session initialization rather than reporting cores.
  const threads = env.backends.onnx.wasm?.numThreads;
  return { backend, wasmThreads: Number.isInteger(threads) && threads! > 0 ? threads! : 1,
    crossOriginIsolated: globalThis.crossOriginIsolated === true, reason };
}

export function configureKokoroRuntime(): void {
  env.useCustomCache = true;
  env.customCache = runtimeModelCache;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = { wasm: LOCAL_WASM_URL, mjs: LOCAL_WASM_MODULE_URL };
    // Leave CPU headroom on mobile big/little cores. Shared memory also needs
    // isolation; API presence alone does not enable parallel WASM execution.
    const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency;
    wasm.numThreads = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      ? Math.min(4, Math.max(1, Math.ceil((cores || 2) / 2))) : 1;
    wasm.proxy = false;
  }
}
