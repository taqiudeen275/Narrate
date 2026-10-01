import { env } from '@huggingface/transformers';
import { MODEL_REVISION, runtimeModelCache } from './downloads';
import type { KokoroBackend, KokoroRuntimeInfo } from './worker-types';
import { isKokoroMobileHost } from './runtime-capabilities';

/** Vite packages the matching runtime binary into the APK/web assets. */
export const LOCAL_WASM_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', import.meta.url).href;
export const LOCAL_WASM_MODULE_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href;
export const LOCAL_GPU_WASM_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm', import.meta.url).href;
export const LOCAL_GPU_WASM_MODULE_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', import.meta.url).href;

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
  // The library recommends fp32 for GPU. Quantization is model-specific; q8's
  // integer graphs have not been validated on this app's mobile GPU path.
  if (dtype !== 'fp32') return { backend: 'wasm', reason: 'This quantized edition uses CPU inference; GPU is enabled only for full precision in this version.' };
  const gpu = (client as (Navigator & { gpu?: GpuProbe }) | undefined)?.gpu;
  if (!globalThis.isSecureContext || !gpu) return { backend: 'wasm', reason: 'WebGPU is unavailable in this app or browser.' };
  let probing = true;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<{ backend: KokoroBackend; reason: string }> => {
        const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter || !probing) return { backend: 'wasm', reason: 'No supported WebGPU adapter is available.' };
        const device = await adapter.requestDevice();
        // A late probe must release its device even after CPU loading begins.
        device.destroy();
        return { backend: 'webgpu', reason: `WebGPU inference selected${mobile || isKokoroMobileHost(client) ? ' on this mobile device' : ''}; unsupported operations may still use CPU.` };
      })(),
      new Promise<{ backend: KokoroBackend; reason: string }>((resolve) => {
        deadline = setTimeout(() => resolve({ backend: 'wasm', reason: 'WebGPU capability check timed out; using CPU inference.' }), 10_000);
      }),
    ]);
  } catch {
    return { backend: 'wasm', reason: 'WebGPU device creation failed; CPU inference remains available.' };
  } finally { probing = false; clearTimeout(deadline); }
}

export function kokoroRuntimeInfo(backend: KokoroBackend, reason: string): KokoroRuntimeInfo {
  // ONNX can reduce this setting to one if its shared-memory capability check
  // fails. Read it after session initialization rather than reporting cores.
  const threads = env.backends.onnx.wasm?.numThreads;
  return { backend, wasmThreads: Number.isInteger(threads) && threads! > 0 ? threads! : 1,
    crossOriginIsolated: globalThis.crossOriginIsolated === true, reason };
}

export function configureKokoroRuntime(backend: KokoroBackend = 'wasm'): void {
  env.useCustomCache = true;
  env.customCache = runtimeModelCache;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  // The APK/web build already contains the matching binaries. Transformers v4
  // otherwise caches and blob-loads them alongside model data.
  env.useWasmCache = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    // Native WebGPU uses asyncify; that build is single-threaded. A separate
    // CPU pair retains WASM threading when shared memory is supported.
    wasm.wasmPaths = backend === 'webgpu'
      ? { wasm: LOCAL_GPU_WASM_URL, mjs: LOCAL_GPU_WASM_MODULE_URL }
      : { wasm: LOCAL_WASM_URL, mjs: LOCAL_WASM_MODULE_URL };
    // Leave CPU headroom on mobile big/little cores. Shared memory also needs
    // isolation; API presence alone does not enable parallel WASM execution.
    const cores = typeof navigator === 'undefined' ? 2 : navigator.hardwareConcurrency;
    wasm.numThreads = backend === 'wasm' && globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
      ? Math.min(4, Math.max(1, Math.ceil((cores || 2) / 2))) : 1;
    wasm.proxy = false;
  }
}
