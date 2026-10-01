# Mobile follow-up implementation plan

**Goal:** Make Narrate usable around phone system bars, fix the reported mobile download and playback failures, and add clear navigation motion and optional model warnings.

**Architecture:** Keep the React/Tauri app and existing offline audio cache. Android publishes measured insets; the shell applies them once. Model advice uses approximate memory reports and local generation measurements while keeping every supported edition available.

**Design:** Preserve the light forest-green surface. The supplied clip informs a raised center Listen control, a lighter transparent navigation surface and a moving selection indicator. Page motion follows navigation direction, lasts 260 ms, cancels when interrupted and respects reduced motion. No animation delays user actions or inference.

- [x] Fix the browser fetch receiver and cover it with a receiver-sensitive HTTP fixture.
- [x] Bound worker load/synthesis requests; reject and recover after a stalled worker.
- [x] Validate stored preferences, preserve structured sample content and stabilize playback intent while streaming waits.
- [x] Add Android system-bar/cutout inset and reduced-motion bridge; apply safe area to the shell and fixed overlays.
- [x] Add page/tab/nav transitions and a transparent bottom bar; restore the sample entry point in Library.
- [x] Show the full model catalog and optional warnings, with Cancel and Download anyway actions.
- [x] Run regression suites, typecheck, web build and a fresh ARM64 Android debug build.

Physical phone checks remain necessary for status/navigation bars, large fonts, keyboard, orientation, animation smoothness, real model speed and background idle behavior. This workspace has no connected device; tests must not be presented as those physical checks.
