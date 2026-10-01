# Offline and background operation

Narrate runs Kokoro in a dedicated WASM worker. Model weights, tokenizers,
supported voice data and the matching ONNX WASM binary are local after install.
The Tauri package carries the interface assets. Documents, audio sentences,
generation attempts and preferences are saved in IndexedDB. A completed render
plays without inference. Incomplete renders resume from saved sentences when the
document is opened and generation is requested again.

Android user-initiated generation and downloads start a native foreground
service with an ongoing notification and a partial wake lock. The Tauri plugin
keeps the WebView resumed during those tasks. Overlapping installs and generation
share a counted lifecycle; completing one does not stop another. The service
stops when all work finishes, or the owning Activity is destroyed.

This supports ordinary app switching and screen idle, but the inference and
transfer loop still execute in a WebView worker. Android or a device vendor may
destroy that process. Force-stop, shutdown and aggressive battery management
cannot be guaranteed. A fully independent native inference/download worker is
required to continue after WebView destruction. Partial model bytes and generated
sentences are saved for recovery instead of being discarded. Browser tabs have
their own suspension policy and do not receive the Android foreground service.

The foreground implementation follows [Tauri mobile plugins](https://v2.tauri.app/develop/plugins/develop-mobile/)
and Android's [foreground service type requirements](https://developer.android.com/develop/background-work/services/fgs/service-types).
Physical device validation should cover switching apps and locking the screen
during generation and two simultaneous installs, then opening saved audio with
network connectivity disabled. Do not claim these scenarios are verified until
they have been exercised on a device.

Word timestamps currently distribute measured sentence duration across words by
duration weights. Seeking honors those stored timestamps, but acoustic word
alignment remains approximate until an engine supplies per-word durations.
