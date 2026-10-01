# Mobile follow-up — 1 October 2026

Changes are in `D:\ATS Tech\Narrate3`. The attached phone screenshot and animation clip were inspected as references. Three agents investigated downloads/workers, state recovery/streaming, and Android insets; an additional integration review checked the combined UI and native changes.

## Mobile interface

- Android publishes actual status-bar, navigation-bar and display-cutout insets in CSS pixels. The shell applies them once, with browser safe-area fallback. Fixed sheets and error messages also avoid those areas. The keyboard remains handled by the viewport instead of being counted twice. System icons use the dark appearance appropriate for the light app surface.
- The bottom bar is translucent, with a curved opening around a raised Listen control. Its selection highlight moves between destinations. All five destinations remain available; Listen requires an open document.
- Page navigation follows section direction with a short, cancellable shared-axis entrance. Settings tabs animate too. Audio ticks do not replay transitions. Browser reduced motion and Android Remove Animations disable movement, including playback pulses and Reader smooth scrolling.
- Navigation waits for startup hydration, preventing an early Settings selection from being overwritten as Library loads.
- Library offers **Try the sample** when empty. It opens only after the sample is saved successfully. Launch still opens Library.

## Models

The full catalog of three real Kokoro editions remains visible on every device. Balanced is the initial recommendation; memory reports and normal-pace generation measurements can refine it. Larger editions are available on capable phones as well as slower phones.

Before downloading an edition with limited estimated memory headroom, slower measured generation, or a larger unmeasured footprint, the app explains the concern. **Cancel** starts no transfer; **Download anyway** permits the transfer. Accepted warnings are not repeated during the same Models session. Downloading still supports parallel transfers and durable resume checkpoints.

Hardware reports are approximate. A measured fast edition with estimated memory headroom can become recommended without a warning. The UI does not claim that a phone's model name or CPU thread count proves a particular inference speed.

## Confirmed failures and fixes

| Report | Result and evidence |
| --- | --- |
| Mobile `fetch` Illegal invocation | Default fetch is bound to its browser global receiver. A receiver-sensitive HTTP regression catches the original failure; injected fetch remains supported. |
| Unknown saved model hides Library | Hydration validates model, voice, pace and mode before engine creation; corrupt fields recover independently. IndexedDB regression preserves saved books. |
| Unreachable, flattened sample | Visible Library entry point; structured headings, quotes and list items are saved directly and retain their source name. Reopening reuses the saved sample. |
| Wedged worker hangs forever | Five-minute worker load and synthesis deadlines, excluding download time. Timeout terminates the worker, rejects pending requests, clears timers and isolates retries. Success and stale callback paths are covered. |
| Play during a stream wait flickers | Playback intent stays active while waiting, with Pause available. Resuming waits for new PCM and preserves a pending word seek. A real Player/state fixture drains and refills the buffer. |
| Unused hash reader | Removed dead `readHash`; no callers or implemented extension deep-link contract exist. Startup remains Library. Hash URLs describe local navigation and do not restore documents on launch. |

## Validation

`npm run check` covers TypeScript, all 16 regression suites and the production web build. The new mobile suite exercises actual React controls, optional model downloads, startup ordering, transitions, interruption and reduced motion. The native inset suite executes the actual packaged bridge script against a local DOM; it is not a physical device test.

Final Android APK verification is recorded in [the reliability audit](bug-audit-2026-10-01.md). Use the newly built ARM64 debug APK for this pass.

Android compilation and packaging passed. The final APK contains only the current ARM64 native library, its SHA-256 matches the compiled library containing the web assets, and the new NativeSafeArea class is in the packaged DEX. Android's APK signature verification passed. A fresh packaging task removed an obsolete native-library-sized ZIP allocation left by incremental packaging, bringing the test APK back to about 139 MiB.

No connected Android device or emulator was available. Status/navigation bars in both navigation modes, landscape cutouts, keyboard, large fonts, animation smoothness, real inference, offline replay and screen-off background work still need handset checks. The foreground service and saved checkpoints retain the limitations described in [mobile background behavior](mobile-background.md): Android can destroy the WebView process, so uninterrupted work after process destruction is not promised. Word times remain estimated from sentence duration.

The native bridge supplements WebView safe-area behavior, which varies by engine version. See Android's [WebView inset documentation](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets) and [edge-to-edge guidance](https://developer.android.com/develop/ui/views/layout/edge-to-edge).
