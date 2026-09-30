/**
 * Waveform.
 *
 * The reference's signature mark, and the thing that was reading worst when it
 * was a row of equal-weight bars. Three things fix it:
 *
 * 1. **Mirrored around a centre axis.** Real waveforms are symmetric; a row of
 *    bars hanging from the top reads as a barcode, not as sound.
 * 2. **A smooth multi-octave envelope**, not per-bar noise. Per-bar randomness
 *    has no shape, so the eye finds no rhythm. Layering a few sines of different
 *    frequency gives the swells and dips that read as a voice.
 * 3. **Fewer, rounder, tapered bars**, with the amplitude fading toward the
 *    edges so the row has a soft silhouette instead of a hard rectangle.
 */

function noise(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Amplitude at bar `i` of `n`. Deterministic for a given seed so a document
 * always produces the same silhouette.
 */
function amplitude(i: number, n: number, seed: number): number {
  const t = n > 1 ? i / (n - 1) : 0; // 0..1 across the row
  const x = t * Math.PI * 2;

  // Three sines at incommensurate frequencies: the slow swell, the phrase
  // rhythm, and the fast syllable flutter.
  const slow = Math.sin(x * 0.9 + seed * 0.7) * 0.5 + 0.5;
  const mid = Math.sin(x * 2.7 + seed * 1.9) * 0.5 + 0.5;
  const fast = Math.sin(x * 6.1 + seed * 3.3) * 0.5 + 0.5;
  // A little grain so it is not mechanically smooth.
  const grain = noise(i, seed) * 0.22;

  let a = slow * 0.44 + mid * 0.3 + fast * 0.18 + grain;

  // Taper both ends: a waveform does not start and stop at full height, and
  // this is what stops the row reading as a filled rectangle.
  const edge = Math.min(1, Math.min(t, 1 - t) * 6.5);
  a *= 0.35 + edge * 0.65;

  return Math.max(0.08, Math.min(1, a));
}

export function Waveform({
  bars = 72,
  progress = 0,
  seed = 1,
  height = 72,
  live = false,
  className,
}: {
  bars?: number;
  /** 0–1 through the track. */
  progress?: number;
  seed?: number;
  height?: number;
  /** Swells a band around the playhead while audio is running. */
  live?: boolean;
  className?: string;
}) {
  const head = progress * (bars - 1);

  return (
    <div
      className={`n-wave${className ? ` ${className}` : ''}`}
      style={{ blockSize: height }}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, i) => {
        let a = amplitude(i, bars, seed);
        if (live) {
          // A local swell around the playhead, so the field reacts to position
          // without the whole row moving.
          const d = i - head;
          a = Math.min(1, a * (1 + Math.exp(-(d * d) / (bars * 0.5)) * 0.55));
        }
        const state = i < head - 0.5 ? 'played' : Math.abs(i - head) < 0.5 ? 'head' : 'ahead';
        return (
          <span
            key={i}
            className={`n-wave-bar n-wave-${state}`}
            style={{ blockSize: `${(a * 100).toFixed(1)}%` }}
          />
        );
      })}
    </div>
  );
}

/** The compact track inside the transport, with a playhead rule. */
export function ScrubTrack({
  bars,
  progress,
  seed = 3,
  onSeek,
  label,
}: {
  bars: number;
  progress: number;
  seed?: number;
  onSeek?: (fraction: number) => void;
  label: string;
}) {
  return (
    <div
      className="n-scrub"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onKeyDown={(e) => {
        if (!onSeek) return;
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(1, progress + step)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, progress - step)); }
      }}
      onClick={(e) => {
        if (!onSeek) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    >
      <Waveform bars={bars} progress={progress} seed={seed} height={30} />
      <span className="n-scrub-head" style={{ insetInlineStart: `${progress * 100}%` }} />
    </div>
  );
}
