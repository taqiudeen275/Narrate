# Offline and background operation

Narrate runs Kokoro in a dedicated WASM worker. Model weights, tokenizers,
supported voice data and the matching ONNX WASM binary are local after install.
The Tauri package carries the interface assets. Documents, audio sentences,
generation attempts and preferences are saved in IndexedDB. A completed render
plays without inference. Incomplete renders resume from saved sentences when the
document is opened and generation is requested again.
Each document remembers the model, narrator and speed used for its saved audio,
so changing narration settings for another document does not force regeneration.
Android audio export uses the system save picker and sequential bounded writes;
the file is reported saved only after its expected bytes are flushed and closed.
Export cancellation keeps the stored narration intact.

Android user-initiated generation and downloads start a native foreground
service with an ongoing notification and a partial wake lock. The Tauri plugin
keeps the WebView resumed during those tasks. Overlapping installs and generation
share a counted lifecycle; completing one does not stop another. The service
stops when all work finishes, or the owning Activity is destroyed.
The service renews its timed wake lock during long tasks and removes the renewal
callback on destruction, so slow book renders do not silently lose the lock
after a single timeout.
Streaming completion uses Web Audio source callbacks as well as animation
frames, so an idle screen cannot make a late refill skip newly generated PCM.

This supports ordinary app switching and screen idle, but the inference and
transfer loop still execute in a WebView worker. Android or a device vendor may
destroy that process. Force-stop, shutdown and aggressive battery management
cannot be guaranteed. A fully independent native inference/download worker is
required to continue after WebView destruction. Partial model bytes and generated
sentences are saved for recovery instead of being discarded. Browser tabs have
their own suspension policy and do not receive the Android foreground service.

The foreground implementation follows [Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/)
and Android's [foreground service type requirements](https://developer.android.com/develop/background-work/services/fgs/service-types)
and [wake-lock lifecycle](https://developer.android.com/reference/android/os/PowerManager.WakeLock).
Physical device validation should cover switching apps and locking the screen
during generation and two simultaneous installs, then opening saved audio with
network connectivity disabled. Do not claim these scenarios are verified until
they have been exercised on a device.

Word timestamps currently distribute measured sentence duration across words by
duration weights. Seeking honors those stored timestamps, but acoustic word
alignment remains approximate until an engine supplies per-word durations.
