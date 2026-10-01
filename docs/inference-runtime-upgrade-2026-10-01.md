# Inference runtime upgrade

This report records the initial 0.1.0 runtime-upgrade artifact. The subsequent 0.1.1 model-selection fix and current artifact are recorded in [model-selection-2026-10-01.md](model-selection-2026-10-01.md).

The authorized upgrade is in `D:\ATS Tech\Narrate3`, before adding other generation engines. Kokoro.js remains 1.2.1, but its scoped dependency override resolves the same Transformers.js **4.3.0** instance used by the app. ONNX Runtime Web is **1.31.0-dev.20260914-8d85527a0**, the exact version specified by the [Transformers release](https://github.com/huggingface/transformers.js/blob/4.3.0/packages/transformers/package.json). The lockfile records these versions; npm reports zero known dependency vulnerabilities.

## Runtime behavior

- Full precision probes WebGPU on desktop and mobile. API presence, a trustworthy context, adapter creation and device creation must succeed. A 10-second capability deadline chooses CPU when a probe stalls; late devices are destroyed.
- CPU uses the local `ort-wasm-simd-threaded.{mjs,wasm}` pair. GPU uses the local `ort-wasm-simd-threaded.asyncify.{mjs,wasm}` pair from the [native WebGPU migration](https://github.com/microsoft/onnxruntime/blob/8d85527a0/docs/design/onnxruntime_web_jsep_to_webgpu_ep_migration.md). Both ship inside the build; runtime initialization does not depend on a CDN. GPU asyncify remains single-threaded. Isolated CPU hosts can request up to four threads when shared memory is available.
- GPU initialization reports its backend before loading, so a crash or deadline during model startup can restart the same edition on CPU. Synthesis errors and invalid PCM use the same fresh-worker recovery. Pending requests share one replacement worker, preserving voice and pace; cancellation and stale callbacks remain protected.
- The worker rejects empty, untyped or nonfinite PCM and invalid sample rates before transfer, playback or persistence. CPU inference errors remain errors rather than repeating a failed GPU attempt.
- Quantized q8 and q4 remain on CPU. The native provider's [core](https://github.com/microsoft/onnxruntime/blob/8d85527a0/onnxruntime/core/providers/webgpu/webgpu_execution_provider.cc) and [contrib](https://github.com/microsoft/onnxruntime/blob/8d85527a0/onnxruntime/contrib_ops/webgpu/webgpu_contrib_kernels.cc) registries do not establish whole-model support for the quantized graphs. No larger edition is automatically selected or downloaded.
- Settings → Models describes the full-precision GPU opportunity. Generation performance reports the actual initialized backend and final thread setting. A GPU-selected session can still execute unsupported operations on CPU.

## Offline data and Android

Model revision `1939ad2a8e416c0acfeecc08a694d14ef25f2231`, file URLs, IndexedDB stores, saved-audio keys, application ID and Android `http://tauri.localhost` origin are preserved. Transformers' extra WASM cache is disabled because its binaries already ship in the app; model and narrator cache integration remains in place.

The localhost origin is eligible for trustworthy-context treatment; an origin migration is unnecessary and would hide origin-bound offline data. Actual WebGPU availability depends on the installed WebView and GPU driver. COOP/COEP headers alone do not enable shared memory in Android WebView; this upgrade does not introduce experimental AndroidX isolation APIs.

## Verification

- The focused runtime suite loads through the actual Transformers cache loader and packaged eSpeak with all fetches blocked, checks both local runtime asset pairs, and executes a real ONNX Add graph on the CPU WASM runtime.
- Worker and acceleration suites exercise the production worker's selection/protocol, deadlines, late-device cleanup, invalid PCM, shared CPU recovery and cancellation. Hardware and heavyweight synthesis are substituted in these suites. The probe-stall and empty-PCM regressions were reproduced before their fixes.
- `scripts/smoke-kokoro.ts` uses the exact **92,361,116-byte** pinned q8 export with supplied tokenizer files and the packaged `af_heart` narrator. A real sentence generated **111,600 finite samples at 24 kHz**, lasting **4.65 seconds**, with **zero network requests**. This uses native Node CPU inference to verify the actual Kokoro tokenizer/phonemizer/model/Tensor ABI, rather than a model substitute. It is an optional check outside the regular suites; the weights are kept in a temporary validation directory.
- Independent read-only review checked dependency deduplication, cache compatibility, runtime assets, PCM validation and fallback lifecycle. It found the pre-announcement probe deadline issue; that issue is fixed and the follow-up review is clear.
- Final `npm run check` passed: TypeScript, all **19 regression suites**, and the production web build. `git diff --check` passed. The ARM64 Android debug build and forced fresh packaging passed. The delivered APK contains the current worker, main bundle and both runtime asset pairs; its embedded native library exactly matches the newly compiled library. The NativeSafeArea bridge remains present. APK signature verification passed using the existing debug certificate, SHA-256 `446c9ad123dad3ab29e858bf3f227b36a7dc99d759a6596cbd1c5f1bbf2d87e5`.

## Android artifact

- APK: `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`
- Size: **151,181,910 bytes / 144.2 MiB**
- APK SHA-256: `af5d414175d99d07b1ea80284ef66e2d9e3f0f4df818fffafc856e82b19a53bd`
- Embedded native library SHA-256: `bfc89b5f855343cc8af851ef062863044336d5bd609ab38c35e6f659278b2fb8`

The first artifact check found an older worker bundle after overlapping web and native builds. The final build ran from finalized assets and passed all current asset and library identity checks. Fresh packaging also removed the obsolete incremental ZIP allocation.

No S22 Ultra GPU speed or acoustic-quality result is claimed. No phone is connected for device validation. Test the new APK with Full precision selected, inspect Generation performance, listen to generated audio, and reopen offline to check saved playback. Other engine families remain subsequent implementation work.
