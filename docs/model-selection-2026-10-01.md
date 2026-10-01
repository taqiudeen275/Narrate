# Model selection and saved audio

Balanced, Full precision and the 4-bit Kokoro edition share the same 28 narrators. Their weights, storage needs and generation performance differ. GPU recovery retains the chosen edition and changes only the execution backend.

## Confirmed defect and fix

Opening a document with saved narration previously replaced the engine and persisted model preference with that narration's edition. Opening an old Balanced book or the saved sample could therefore undo an explicit Full precision choice in Settings. The regression was reproduced before the fix.

The selected generation engine now remains independent of the saved playback profile. Reopening a document restores its original PCM, narrator and pace without replacing the selected engine. Listen identifies the saved audio's edition and offers an explicit **Generate with** action when the chosen edition differs. Audio cache keys and the library's saved narration metadata use the actual PCM profile.

Play also retains a partially saved narration from another edition without starting new inference or clearing its PCM. The explicit generation action uses the selected edition. Matching-edition partial narration retains its existing resume behavior.

New Work attempts store the requested edition, the engine's edition, the runtime backend and thread count, and the app version. The runtime snapshot is refreshed after generation so GPU recovery is reflected in the record. Existing attempts retain their original labels; removing a document deliberately does not erase its audit history.

Stopping an attempt during its final library write no longer allows late completion to replace its cancelled status. Immediately stopping generation with another edition now records zero progress until audio for the requested model/narrator/pace is loaded or generated; an older playback's sentence count is not attributed to the new attempt. The independent review reproduced these audit inconsistencies and the partial-audio case before their fixes.

## Updated Android installations

Updating over the previous APK is supported. The application ID, WebView origin, model cache revision and storage schema remain unchanged. No uninstall or data reset is required. Version **0.1.1** is shown in Settings and recorded in new Work attempts so that successive APKs can be distinguished.

## Mobile UI follow-up

The mobile bottom navigation now uses z-index 30 above the page and transport stacking context (1). Alerts (40) and the narrator modal (60) retain their higher layers. Navigation remains available with a document open in Listen or Read.

Narrators, the narrator sheet and Voice Lab display Female/Male labels from the installed Kokoro.js 1.2.1 voice catalogue. All 28 supported IDs have documented labels (15 Female, 13 Male); unknown IDs are left unlabelled. This metadata adds no heavyweight runtime import to the interface.

## Evidence and limits

The exact reported S22 Ultra sequence of selecting and loading Full precision, deleting a document, reimporting the same file, and generating did not reproduce locally: the worker received fp32 and the newest Work attempt recorded Full precision. The confirmed saved-document override is a separate, adjacent path. These results do not establish the cause of the exact phone report.

The new integration suite exercises the actual React model controls, store, player, engine, worker protocol and IndexedDB persistence. It checks fp32/q4 selection, reopening saved Balanced PCM, new imports, same-file deletion/reimport, restart preferences and Work diagnostics. Hardware, model bytes, heavyweight synthesis and worker isolation are substituted; no installed S22 Ultra build is exercised.

TypeScript, all 20 regression suites and the production web build passed with `npm run check` after the model, audit and UI fixes. The focused cancellation and partial-playback regressions also passed independently. Existing mobile UI, native inset, narrator UI and modal suites passed.

## Verified Android artifact

- APK: `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/Narrate-0.1.1-model-and-mobile-fixes-arm64.apk`
- Package: `com.atarq.narrate`, version name **0.1.1**, version code **1001**.
- Size: **151,179,958 bytes / 144.2 MiB**.
- APK SHA-256: `55f52feea2010c081653a25791310578c5094e80eb45a27d4c45fe532ad84fca`.
- Embedded native library SHA-256: `0ea3480f132a1a9cf12ea969e9c7c274c0118c4214a017145283abc07f29cb92`.
- Signing certificate SHA-256: `446c9ad123dad3ab29e858bf3f227b36a7dc99d759a6596cbd1c5f1bbf2d87e5`, matching the previous debug APK.

The ARM64 Android build and forced fresh packaging passed. Signature verification passed. The APK's only native library exactly matches the newly compiled library, which includes the current main JS/CSS, Kokoro worker and both CPU/GPU runtime asset pairs. The NativeSafeArea bridge remains present. The versioned delivery copy has the same hash as the verified build output. Web and Android builds ran sequentially to avoid mixing bundles.

No phone was connected for installed-app validation. On the updated phone, Settings should show 0.1.1; select the desired edition and inspect the newest Work attempt's Requested model, Model, Generation backend and App version if the reported mismatch persists. Older attempts deliberately keep their original model labels.
