# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

One cohesive design language across Windows/macOS/Linux desktop (Tauri shell), Android (Tauri mobile), and the browser extension. The user explicitly chose a consistent brand over per-OS native adaptation, so the design language is web on every surface. Recorded as `web` because a native wrapper around a web UI does not make the design language native, and per-OS divergence was declined.

## Stack

- **Frontend:** React 19 + TypeScript + Vite (user-selected).
- **Desktop/mobile shell:** Tauri 2 (user-selected). Targets Windows/macOS/Linux desktop and Android.
- **Browser extension:** separate build target sharing the frontend and document-parsing layer.
- **Inference core:** native library invoked from the Tauri Rust backend. NOT decided — see Capabilities and Constraints.

## Users

One primary user: the owner, using this personally. They load their own documents and listen to them. Not a product for other people, not a team tool.

Consequences confirmed by this choice: privacy-first is acceptable as the default posture (everything local, no accounts, no telemetry, no network calls for synthesis), and the build can go deep on output quality rather than breadth of onboarding, licensing clearance for third-party distribution, or multi-role UX.

## Product Purpose

Turn any document the user has into audio they can listen to, with the text kept in exact sync to the narration.

Success means: drop in a `.md`, `.pdf`, or `.docx`; pick a voice; press play; and the text highlights the exact word being spoken, in time, in a way that lets you read along, follow along, or jump straight to the part you want. Audio can be exported as a finished file, or streamed as it is generated.

Success is explicitly *not* "a TTS demo." It is a listening and reading tool that treats the document, the narration, and the text as one synchronized object.

## Positioning

**Fully local document-to-audible-document with word-accurate playback sync and user-cast voices.**

A neighboring product could copy "TTS with highlighting" by calling a cloud API. What it could not truthfully copy:

- **Nothing leaves the machine.** Synthesis, voice cloning, and model downloads are all local. The user's documents are never uploaded. This is a mechanism, not a slogan — there is no server component to fall back to.
- **Word-accurate sync is a first-class output, not a feature.** The app owns the full text → phoneme → audio pipeline, so it derives word timings from the same duration data that produced the audio, rather than guessing or running a separate aligner.
- **The voice library is cast, not browsed.** Voices carry a name and an avatar because the user chooses a narrator, not a sample rate.

## Operating Context

- The user's own documents are the entire input domain: Markdown, PDF, DOCX, and "other word documents."
- Long-form is the expected shape, not an edge case. Documents are books, notes, reports, articles — paragraphs and chapters, not one-line strings.
- Listening happens in long sessions, often alongside reading. Fatigue over hours matters more than peak quality in the first thirty seconds.
- Export is a real workflow: the user wants a finished `.wav` or `.mp3` they can keep.
- Two distinct listening postures exist and both are first-class: **hands-free** (music-player-like, eyes elsewhere) and **following along** (text visible, word highlighted).

## Capabilities and Constraints

### Confirmed capabilities

- Load documents: `.md`, `.pdf`, `.docx`, and other word documents.
- Generate a **full** audio rendering of the document.
- Export as **WAV** or **MP3**.
- **Stream generation** as an alternative to full generation.
- Two views:
  - a **music-player** view (no text emphasis; the artifact is the audio)
  - a **text + highlight** view showing the text with **sentence-level and word-level** highlighting as it narrates
- The text view has two modes: **page mode** and **focused view**.
- Regardless of mode: **word seeking** (click any word to play from there) and **jump buttons for sentence and paragraph seeking**.
- **Kokoro preinstalled** with the app.
- A **Models page** to download, install, and remove other models. Named in the brief: Kokoro, Pocket TTS, Piper. Additional models are the assistant's call.
- A **Voice Create page** for voice cloning, to produce new voices.
- **Voices have avatars and proper names**, and voice selection surfaces them.
- A **browser extension** build of the same product.

### Verified technical constraints

- **CPU/mobile and voice-actor quality are in tension.** Models measured fast enough to run on a phone are all ≤100M parameters. Models reaching independently-verified human-parity naturalness need 0.5B–4.4B parameters and 8–24GB VRAM, or a cloud API. No model currently satisfies both. This is the central design tension of the product and it is a hardware fact, not a tuning problem.
- **"Human level" is unverified marketing for essentially all open models.** The only independent deception-style evaluation put the best open-weight model at a 50% Human Fooling Rate against 70% for a real human recording. The user should expect "clean, warm, unrobotic" as the achievable bar, not "indistinguishable from an actor."
- **Automatic quality metrics must not be used to choose voices.** UTMOS and DNSMOS are unreliable for ranking clean audio; on small models with cheap vocoders they actively over-rate. Voice selection must be by listening.
- **Kokoro cannot clone voices.** It ships 54 fixed voices. Cloning requires a different model.
- **Long-form degrades without a real pipeline.** Most open models break down past ~1,000 characters. The app must do structural parsing, sentence-boundary chunking, and state carry-over itself.
- **The browser extension cannot use the native inference core.** It needs a WASM/web path, which restricts it to a smaller model set than desktop and Android.
- **Model licenses differ materially and one common engine is copyleft.** Piper and eSpeak-NG are GPL-3.0. Kokoro, MeloTTS, Pocket TTS, and Matcha are permissive. Voice Create and the Models page must surface license per model.

### Open decisions — not yet settled

- **Inference core — RESOLVED: `sherpa-onnx` as a native library.** It is the only TTS runtime with proven desktop and Android support that already wraps Kokoro, Piper/VITS, Kitten, Matcha, Supertonic and ZipVoice. ONNX Runtime used directly would mean re-implementing phonemization, text normalization and graph orchestration per model. Note that sherpa-onnx statically links eSpeak-NG (GPL-3.0) for the Piper and MMS engines; acceptable for a personal tool, but it constrains redistribution.
- **Word-timing derivation — RESOLVED: derive from the acoustic model's own phoneme duration predictor.** Kokoro and VITS both have one. A word's timing is the sum of its phonemes' durations, mapped back to character offsets. Costs no extra model and no extra pass, and cannot disagree with the audio because it is the same data that produced the audio. Proportional distribution by phoneme count is the fallback for models that do not expose durations.
- **Document parsing — RESOLVED: in TypeScript, not Rust.** So the browser extension inherits md/pdf/docx/epub/rtf parsing from one shared layer instead of reimplementing it.
- **Voice cloning runtime — RESOLVED but deferred.** The Voice Create page ships in the core pass with real UX and honest per-model capability reporting; the actual synthesis engine lands last, targeting Pocket TTS via llama.cpp/GGUF. Confirmed by the user. A control that cannot yet synthesize must never be presented as if it can.
- **Legacy binary formats — UNRESOLVED.** `.doc` (Word 97-2003) and Apple `.pages` have no good client-side parsers. `.docx`, `.odt`, `.rtf`, `.epub`, `.txt`, `.md`, `.html`, and `.pdf` are all tractable and in scope.
- **Models-page catalog — UNRESOLVED.** The brief named Kokoro, Pocket TTS and Piper. Additional candidates: KittenTTS, Supertonic 3, Matcha, MeloTTS, Soprano.
- **Build sequence — CONFIRMED by the user: core app first, then breadth.** Core pass = parsing + Kokoro + WAV/stream + word sync + both views. Then the Models page. Then the cloning engine. Then Android and the browser extension.

## Brand Commitments

- **Name: Narrate.** Confirmed by the user. The repository directory remains `Narrate3`.
- **Avatar and naming for voices is a hard requirement, not decoration.** Every voice the user can select is presented with a proper human-style name and a visual identity. This follows from the positioning: the user is casting a narrator, so voices are cast as characters, not enumerated as model outputs.
- **Visual world: PINNED to the supplied reference image.** The user supplied a
  reference — a calm, light, air-frosted surface with a soft green wash rising
  from the bottom, deep forest green for commitment, circular icon controls,
  thin waveform marks, large light typography, and a floating bottom pill — and
  asked for the UI to follow it closely. This is now binding, not
  inspiration. An earlier pass deliberately reinterpreted it as a braille-cell
  world; the user rejected that and the visual identity is now the reference's.
- **No borders.** The user called this out explicitly. Depth comes from
  backdrop blur and soft shadow, never from a 1px rule.
- **Motion and interactivity are explicitly requested.** "Fully interactive and
  animated UX."
- **Voice avatars** are generated tinted discs carrying the narrator's initial,
  not stock photography — a product whose first principle is that nothing
  leaves the machine has no business loading third-party faces.

## Evidence on Hand

- A single supplied reference image for a mobile audio-recording app, used as visual inspiration (see Brand Commitments).
- No product copy, logo, brand system, testimonials, usage data, or performance claims exist yet. None may be fabricated.
- The repository is empty: git, branch `master`, no commits.

## Product Principles

1. **Local is the architecture, not a setting.** If a feature cannot work offline, it does not get built. There is no server to degrade to, and no path where a document leaves the device.
2. **The document and the audio are one object.** Any design that treats highlighting, seeking, or export as a layer bolted onto a finished audio file is wrong. They are views of the same synchronized structure.
3. **The reader's eyes and the speaker's ears are both first-class.** The music-player view is not a lesser fallback for "when you're not reading." Following along is not a debug view. Both are finished experiences.
4. **Quality is judged by listening, never by a metric.** No automatic score picks a voice, ranks a model, or reports success.
5. **Long-form is the default case.** A 40,000-word document is the normal input. Every pipeline decision — chunking, state carry-over, fatigue, export — is judged against that, not against a demo sentence.

## Accessibility & Inclusion

Inferred from the product's nature, not stated by the user: this is a reading and listening tool, so it serves users who read text more comfortably than they hear it, users who consume long documents by ear, and users with visual or attention differences that make a wall of text hard to track.

Requirements that follow: word-level seeking and sentence/paragraph jumping are accessibility affordances, not conveniences. Highlighting must not rely on color alone. Any continuous motion (waveform animation, progress) needs a reduced-motion path. The product's own purpose makes accessibility a core surface concern rather than a compliance checkbox.
