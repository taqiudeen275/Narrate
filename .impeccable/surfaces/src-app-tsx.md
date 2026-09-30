---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Narrate — app shell, library, and the two listening views

## Scope and visitor mode

**Operate.** Narrate is a tool the user works inside: load a document, cast a narrator, play, follow along, export. The primary surface is the player (both its music-player and text views) plus the library, with the Models page and Voice Lab as secondary surfaces.

## Audience, job, task, constraints

- One user, alone, at night, in a dim room, with a long document they want to hear and keep.
- Task: get from "document on disk" to "listening, and able to follow the words" in as few steps as possible.
- Long-form is the default. A 40,000-word document is normal input.
- Local only. Nothing leaves the machine. No accounts, no telemetry.
- The document and the audio are one synchronized object. Highlighting, seeking, and export are views of that one structure.

## Direction contract

**THESIS.** The narrator is a finger moving across a page you can feel. This surface refuses the default dark audio-player arrangement — a big circular button, a scrub bar, a charcoal field, a neon accent — and refuses its opposite, the cozy cream-serif book reader. It inverts both: the chrome recedes into a dark room, and **the document is the light source**, a lamplit bone page carrying dark ink with braille dots raised and shadowed on it. The word being spoken is not a colored box. It is *lifted*.

**OWN-WORLD.** Braille, embossing, the reading finger, light through paper. The 2×3 dot cell is the atomic unit and the whole system: layout grid, state language (raised = spoken, debossed = unspoken, ringed = current), and the entire icon set — no icon is a glyph, every icon is cells. Everything physical is emboss, never glow: light from the upper-left, shadow to the lower-right, a raised dot catches both. Palette is a dark warm umber room, chrome lifted just off it, one lamplit bone plane for the reading surface, ink on that plane, and a single amber-lamp accent reserved exclusively for *the current position*. Type is Archivo for UI, Literata for the reading surface, Azeret Mono for the cell readout and timecodes — three faces each with a functional reason, none of them the training-data default.

**STORY.** The user believes three things in the first viewport, without reading a caption: their document is open, a voice is already chosen, and the words are under the narrator's finger right now. Then they prove the third thing by touching it — clicking a word plants a raised marker and the narration jumps there. The app's whole argument is that the text and the audio are the same object, and the interface is the proof.

**FIRST VIEWPORT.** The reading surface dominates and is the brightest thing on screen, centered, at a comfortable reading measure, sitting on the dark room. The document title and voice sit in a slim header above it with the voice's avatar. The transport is a single floating bar at the foot: the live 2×3 cell readout on the left, the raised word-marker track in the middle showing progress as filling cells, and the voice avatar + play control on the right. Nothing floats above the page. The page is the hero because the mechanism lives in it.

**FORM.** Chosen form: *The Embossed Cell* — braille and tactile reading. Position 3 of 7 grounded candidates, assigned by seed `9982ffb3` (mode `operate`). The roll ran degraded: the roll service was unreachable, so no challenger worlds and no quality-bar boards were dealt. The user's pinned reference (soft teal glass, rounded, waveforms) informed the commitment to luminous floating controls and to a device you want to touch, and was deliberately not adopted as identity — glass is a costume, not a raise.

**FINISH.** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Chosen direction and memorable moment

**The Embossed Cell.** Braille, embossing, the reading finger, light through paper.

**Memorable moment:** the transport bar carries a live 2×3 braille cell that mirrors the character currently being spoken, its dots rising as the phonemes land. You can feel where you are in the book without looking up from the page.

**Signature interaction:** clicking any word plants a raised marker there and plays from it. The word lifts under the pointer, the cell readout follows, and narration resumes mid-paragraph.

## Unresolved decisions

- The sherpa-onnx native adapter is blocked on a missing C++/MSVC toolchain. The Web/WASM adapter (kokoro-js) is the live path. Both sit behind one `TtsEngine` interface.
- Word-level timings come from the engine. The Web adapter derives them from per-sentence audio duration distributed across the sentence's words by phoneme weight; the native adapter will use the acoustic model's own phoneme duration predictions. The interface carries timings, not the derivation.
- Voice cloning engine deferred to last. The Voice Lab ships with real naming/avatar work and honest per-model capability reporting; it must never present a control that cannot synthesize as though it can.
- `.doc` (Word 97-2003) and Apple `.pages` are out of scope until a client-side path exists.
