# Narrate offline reliability and organization

The app opens in Library. A document is selected deliberately; Listen, Read,
streaming and full rendering are contextual actions. Settings contains model
management and Work, a persistent audit of generation attempts. Preserve the
existing forest green, frosted visual language while simplifying the library
and using a prominent central listening control on mobile.

## Implementation and verification

- [ ] Repair awaited file reads, document parsing fidelity and word seeking.
  Verify parser source content and Web Audio offsets, appended chunks and reset.
- [ ] Persist documents, narration chunks, settings and generation audit in
  IndexedDB. A narration is identified by document, engine, voice and speed.
  Reopening restores audio without loading the inference engine. Persist each
  sentence before marking it saved; preserve interrupted work for resumption.
  Verify reopen, reuse, cancellation, export completeness and input failures.
- [ ] Replace the streaming early exit with one cancellable producer that
  saves all chunks and schedules them as they arrive. Pause controls playback
  independently of synthesis. Full rendering finishes ready for playback and
  export without automatically playing. Prevent old asynchronous work from
  mutating a newly selected document.
- [ ] Reorganize Library and Settings; show import/model/render progress and
  reduced-motion loading feedback. Verify desktop and narrow-screen layouts,
  empty states, stored document opening and contextual controls.
- [ ] Make model downloads genuinely concurrent and cached for offline use;
  add the supported Android background execution lifecycle. Verify actual
  download/cache contracts and Android compilation if a toolchain is available.
  Record platform limitations rather than promise browser background guarantees.
- [ ] Run the full parser, player, state and download regression suite, TypeScript
  checking and production build. Review integration, then fix material issues.

The original working tree already contains icon, manifest and package changes.
Preserve them. No deployment, push or release is part of this request.
