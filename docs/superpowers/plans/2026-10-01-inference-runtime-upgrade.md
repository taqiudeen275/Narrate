# Inference runtime upgrade

The user authorized upgrading the app's Kokoro inference stack before adding other generation engines. Work continues in `D:\ATS Tech\Narrate3`, preserving the prior uncommitted fixes.

## Outcome and boundaries

Use stable Transformers.js 4.3.0 with its matching ONNX Web 1.31.0-dev.20260914-8d85527a0. Keep Kokoro.js 1.2.1 through a scoped dependency override because its published dependency still targets Transformers 3. Preserve the existing model revision, URLs, IndexedDB databases, audio cache keys, application ID and Android origin. Other model families remain separate work.

## Implementation

1. Resolve one shared Transformers instance for Kokoro and the runtime adapter. Pin direct dependencies and the compatible Kokoro override in package.json; regenerate the lockfile.
2. Select the backend before configuring ONNX. Bundle the threaded CPU WASM/module pair and the single-thread asyncify native WebGPU pair; disable the library's duplicate WASM cache because these files already ship inside the app.
3. Permit full-precision GPU probing on capable mobile hosts. Preserve quantized CPU inference, shared-memory capability checks, selected model and fresh-worker CPU fallback. Report the backend before initialization so errors and deadlines during GPU startup can also recover.
4. Validate output shape, finite PCM and sample rate at the worker boundary before audio is persisted or played. Preserve cancellation and stale-callback protection.
5. Update performance explanations for the new runtime and model compatibility. Keep the full-precision model's GPU opportunity visible without selecting or downloading another edition automatically.
6. Verify real offline Transformers cache loading, packaged phonemizer, matching local CPU/GPU assets and a real small ONNX WASM graph. Verify a real Kokoro sentence with the exact pinned q8 weights if available locally or through a bounded validation download. Hardware capability substitutes must be identified; no handset speed claim without a device.
7. Run the complete regression/type/build check; request independent review of runtime and fallback changes. Build and signature-check a current ARM64 Android test APK, matching its embedded native library to the compiled web assets. Record versions, results and remaining device validation.

## Android decision

Keep `http://tauri.localhost`. Chromium treats `.localhost` as a potentially trustworthy origin and supports WebGPU in Android WebView; the installed provider/driver must still pass actual capability checks. A scheme change would hide existing origin-bound IndexedDB data. Shared-memory isolation in Android WebView is a separate host limitation; this pass does not introduce alpha AndroidX isolation APIs.

## Agent ownership

- Root: dependency changes, runtime/worker integration, model wording, real Kokoro smoke test, build and delivery.
- Compatibility review: read-only upstream/API/model/cache investigation.
- Android context review: read-only secure-origin, provider and data preservation investigation.
- Runtime verification: scripts/verify-runtime.ts, verify-acceleration.ts, verify-worker.ts and narrowly necessary runtime regression scripts.

No commits, staging, reset, push or release publication is required. Browser preview remains outside the authorized verification path; use local DOM, native builds and primary-source documentation.
