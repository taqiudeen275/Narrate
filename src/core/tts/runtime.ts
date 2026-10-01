import { env } from '@huggingface/transformers';
import { MODEL_REVISION, runtimeModelCache } from './downloads';

/** Vite packages the matching runtime binary into the APK/web assets. */
export const LOCAL_WASM_URL = new URL('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm', import.meta.url).href;

export function configureKokoroRuntime(): void {
  env.useCustomCache = true;
  env.customCache = runtimeModelCache;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.allowLocalModels = false;
  env.allowRemoteModels = false;
  env.remotePathTemplate = `{model}/resolve/${MODEL_REVISION}/`;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = { wasm: LOCAL_WASM_URL };
    // A dedicated worker keeps the UI responsive without shared-memory threads.
    wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    wasm.proxy = false;
  }
}
