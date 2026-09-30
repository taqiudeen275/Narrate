# Design system

<!-- impeccable:design-schema 1 -->

## The world

**Pinned to the supplied reference.** Not derived from it, not reinterpreted.

A calm, light, air-frosted surface. A soft green wash rises from the bottom of
the viewport and stops well short of the top, so most of the surface stays light
and the gradient reads as daylight falling into foliage rather than as a green
page. One deep forest green carries commitment — the play control, the active
nav item, the current word, the playhead. Everything else is glass, shadow, and
ink.

An earlier pass built a braille-cell world from this reference on the reasoning
that the reference was a "costume, not a raise". The user rejected that and
asked for the reference to be followed closely. The cell system is gone:
`src/design/Cell.tsx` and `cell.css` were deleted, along with every glyph-free
icon they supported. Icons are now ordinary stroke-based line glyphs sitting
inside the reference's circular buttons.

### The one rule that outranks taste

**No borders.** The user named this specifically. A `1px solid` anywhere reads as
technical and immediately makes the surface look like a dashboard instead of
something calm. Every edge in this product comes from backdrop blur, a soft
wide shadow, or a tonal step in the ground.

## Colour

Strategy: **restrained neutrals plus one committed accent**, with a single
multi-stop gradient as the only expressive surface treatment.

| Token | Value | Role |
|---|---|---|
| `--ground` / `--ground-2` / `--ground-3` | `#f1f1ef` → `#dfe3df` | The light surface. Warm off-white, never pure white. |
| `--wash-1` … `--wash-5` | `#cfe0d4` → `#1d3b2d` | The green wash. Three stops, bottom-anchored, soft-edged, stopping around two-thirds up. |
| `--ink` … `--ink-4` | `#1b1d1c` → `#b3bab6` | Text and marks, near-black down to light grey. |
| `--glass` / `--glass-strong` / `--glass-thin` | white at 62% / 82% / 42% | The card material, always paired with `backdrop-filter: blur() saturate()`. |
| `--sh-sm` / `--sh-md` / `--sh-lg` | green-tinted, low contrast | Three shadow depths. Soft, wide, never a hard edge. |
| `--accent` | `--wash-5` `#1d3b2d` | **The single committed colour.** The filled play disc, the active nav item, the current word, the playhead, the primary pill. Nothing else. |
| `--live` | `#e2703a` | The one live-signal colour, used only by the small status dot, never in area. |

The wash is a single fixed layer behind the whole app (`#root::before`): two
radial pools in `--wash-3` and `--wash-4` over a `linear-gradient` that only
starts at 34% down. That stopping point is deliberate — take it higher and the
app becomes a green page.

## Type

| Token | Face | Why |
|---|---|---|
| `--font-ui` | **Archivo** 300/400/500/600 | The reference's voice is light and geometric; 300 is the weight that carries the large headlines. |
| `--font-read` | **Literata** | Long-form reading on the page. A body face, not a display serif. |
| `--font-mono` | **Azeret Mono** | Timecodes, word counts, model ids, specs. |

Headlines are `font-weight: 300` with `-0.03em` tracking — thin, large, and
generous in line-height, which is the reference's typographic signature. Body
UI sits at 400. Scale `--t-3xs` … `--t-5xl`. One spacing rhythm `--s-1` … `--s-8`.

## Components

| Component | File | Notes |
|---|---|---|
| `Icon` | `src/design/Icon.tsx` | Stroke-based line glyphs on a 24-unit grid, round caps and joins, sized to the control. Replaces the cell system. |
| `Waveform` / `ScrubTrack` | `src/design/Waveform.tsx` | The reference's signature mark: thin vertical bars, quiet ahead of the playhead and dark behind it, swelling around the head while audio runs. Heights come from a seeded noise function so a document always looks the same. **The flex gap is `clamp(1px, 0.3vw, 3px)`** — with 150 bars, a fixed 3px gap is 447px of hard minimum width that will push a phone layout sideways. |
| `VoiceAvatar` | `src/design/VoiceAvatar.tsx` | A tinted disc carrying the narrator's initial, with a soft ring that lights when speaking. Generated, not photographed. |
| `Transport` | `src/components/Transport.tsx` | A floating glass pill. Paragraph jumps outermost, sentence jumps inside, the filled green play disc over the scrub track, the cast narrator on the right. Word seeking is absent here on purpose — it happens by touching the word. |
| Word states | `src/views/ReaderView.tsx` | `n-w-ahead` / `n-w-spent` / `n-w-sentence` / `n-w-now`. The current word takes the accent fill **and** a weight change, so it never depends on colour alone. |

## Rules that are not negotiable here

1. **No borders.** Blur, shadow, or a tonal step. No exceptions.
2. **The accent is only ever commitment.** If a second thing is deep green, one
   of them is wrong.
3. **Glass always blurs.** A glass surface without `backdrop-filter` is just a
   grey box.
4. **Depth is soft.** Shadows are wide and low-contrast. A hard shadow reads as
   "technical" and breaks the calm.
5. **Controls are circular.** Icon buttons are discs; the primary one is the
   filled green disc with a soft outer glow.
6. **Automatic quality scores never pick a voice.** UTMOS and DNSMOS over-rate
   small models with cheap vocoders; on clean audio they do not reliably
   identify the preferred sample. Casting is by ear.
7. **A control that cannot do its job does not get shipped as if it could.** The
   Models page and the Voice Lab state their real status.

## Known limits

- The reading plane is a light sheet on a light ground. On a low-contrast
  display in daylight it will need the shadow to do more work than it does here.
- The listening field's waveform responds to *position*, not to real amplitude.
  It is a visual echo of the playhead, not a meter.
- The waveform is DOM bars, not canvas. At 150 bars that is 150 elements
  re-rendered on every playhead tick; it is comfortable now, and canvas is the
  answer if bar count grows much further.
