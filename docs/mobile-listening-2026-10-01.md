# Mobile listening and generation follow-up

Work is in `D:\ATS Tech\Narrate3`. The latest three phone screenshots are evidence for layout failures, and the phone was identified as a Samsung S22 Ultra. Its processor variant, installed WebView version and whether this test used the APK or browser were not confirmed.

## Interface changes

- The central Listen navigation disc is positioned independently of label layout and raised into the bar's existing curved opening. Labels retain their alignment and the transport has clearance above the disc.
- Listen has a compact document header, visible narrator name, waveform and current sentence grouped together, separate generation progress with a Stop action, and saved-audio exports when complete. The current sentence remains visible during streaming.
- The waveform's gradient now uses the SVG's coordinate system. A gradient defined against each zero-width vertical line previously painted no bars; the plain playhead was still visible. An actual SVG raster regression reproduced **2** painted columns before the fix and **288** afterward at a 360-pixel mobile width. Invalid amplitudes cannot produce NaN geometry. Audio heights still come from saved PCM, not an invented waveform.
- The narrator picker portals to the body, with a static 14-pixel blurred backdrop separate from the moving sheet. Its nearly opaque surface keeps text legible, with an opaque fallback where backdrop filters are unsupported. It rises on entry, exits before unmounting, preserves focus and background protection, and respects reduced motion.
- Page and Focus remain accessible in both modes. The reader has a zero intrinsic-width floor, list prose wraps inside one flex child, and phone page width accounts for both margins. Long words and code can wrap. Following scrolls only the active reading pane, without moving the horizontal viewport. It advances at word boundaries within a long sentence and works in Focus too. Manual scrolling pauses follow; **Resume follow** restores it.
- Playback frames no longer rebuild the whole app shell, reader, Library, narrator lists or voice picker. The reader updates at word boundaries, the Listen wave receives the clock separately, and waveform marks are memoized. Profiler regressions cover the reader and static lists. The scrubber still responds continuously to playback.

## Generation path and limits

This interface follow-up originally used Kokoro 1.2.1, Transformers.js 3.8.1 and its matching ONNX JSEP runtime, keeping mobile on CPU because of the reported [Android Kokoro audio corruption problem](https://github.com/huggingface/transformers.js/issues/1320). The subsequent authorized [inference runtime upgrade](inference-runtime-upgrade-2026-10-01.md) now uses Transformers.js 4.3.0 and the native ONNX WebGPU backend. Full precision can probe capable mobile GPUs, with bounded probing and fresh-worker CPU fallback; quantized editions remain on CPU. That report supersedes the runtime versions and APK hashes recorded here.

Desktop full precision can probe a usable WebGPU adapter/device. Quantized editions retain CPU inference. A GPU execution failure retries the same model in one fresh WASM worker, preserving its download and voice selection; stale requests and cancellation cannot revive the retired worker. Some graph operations can remain on CPU even when WebGPU is selected. Mobile classification is carried from Window into the worker and includes Android desktop mode and iPad desktop-mode user agents.

Vite development/preview and Tauri asset responses now carry COOP/COEP isolation headers. The WASM thread setting is capped at four and requires cross-origin isolation and shared memory; after model initialization the app reads back ONNX's final setting. **Generation performance** under Settings → Models reports that provider and CPU thread setting. Headers alone do not establish that the APK's `http://tauri.localhost` WebView origin permits shared memory: see the [Wry secure-context issue](https://github.com/tauri-apps/wry/issues/1709). Existing origin and offline data are preserved.

Balanced remains the sensible starting edition on this phone. Actual generation measurements can change the recommendation. There is no measured S22 speedup in this report. UI work reduces main-thread overhead; multiple WASM threads are available only if the host allows them. A native Android engine with controlled CPU threading is the next substantial performance route. [ONNX threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html) and [XNNPACK](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html) need model/operator profiling, rather than assuming every mobile GPU or accelerator supports the graph.

## Other model families

The original repository listed Piper, Pocket TTS, Kitten, Matcha, Supertonic and Melo as planned/native integrations. Repository history contains no working inference adapter for those cards. The installed catalog therefore exposes the three actual Kokoro editions. Models and Voice Lab now explain this; the obsolete claim that Pocket TTS was waiting for a local C++ compiler was removed.

[Sherpa-ONNX provides prebuilt Android libraries](https://k2-fsa.github.io/sherpa/onnx/android/build-sherpa-onnx.html) and TTS APIs for several of these families. Integrating one requires model-specific manifests, voices, native-accessible downloads, cancellation, and PCM delivery into the existing saved-audio timeline. [Pocket TTS](https://github.com/kyutai-labs/pocket-tts) is a possible cloning engine, not a cloning capability shipped by this pass.

## Validation

`npm run check` passed after the final changes: TypeScript, all **19 regression suites**, and the production web build. The UI suite exercises **23** real component scenarios; six additional modal scenarios cover opening, exit, interruption, focus, reduced motion and older WebViews. `git diff --check` passed.

The ARM64 Android debug build passed. Forced nonincremental packaging removed the obsolete ZIP allocation and produced a **146,031,686-byte / 139.3 MiB** APK. Its embedded native library exactly matches the newly compiled ARM64 library containing the web assets, and the NativeSafeArea class is present in DEX. Android APK signature verification passed with the existing debug certificate, SHA-256 `446c9ad123dad3ab29e858bf3f227b36a7dc99d759a6596cbd1c5f1bbf2d87e5`.

- APK: `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`
- APK SHA-256: `111223feef87109faa0f7c35f0d2256b0732cf0cfa2a07ea52112d20b7ca351c`
- Embedded native library SHA-256: `9adb1691da309e825de0168904537a47beefe0e7ee6815e6448fa014a5f54d42`

Tests substitute hardware capability boundaries; they do not measure a real mobile GPU or acoustic quality. `adb devices` confirmed no connected phone. No emulator was available. The local DOM verifies actual controls and modal lifecycle, and the SVG test actually renders waveform pixels. Phone blur composition, large-font layout, inference speed, background continuation and offline playback still need handset validation. Word timing remains estimated from sentence duration.

This follow-up preserves the earlier durable PCM cache, stream/full generation semantics, parallel downloads, native background service and safe-area bridge. Android process destruction still interrupts WebView inference, with saved checkpoints supporting recovery; see [background behavior](mobile-background.md).
