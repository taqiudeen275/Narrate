/**
 * Waveform — a line.
 *
 * Bars read as decoration; a line reads as a signal, which is what this is.
 * Two mirrored traces of the same envelope, joined across the middle, so the
 * shape reads the way a waveform drawn on graph paper does.
 *
 * Drawn as one SVG with a stretched viewBox rather than DOM bars, so the
 * rendered output is a handful of elements instead of a hundred, and the line
 * stays crisp at any width without measuring anything.
 *
 * The played portion is coloured with a hard stop in a linear gradient: one
 * path, two colours, no clip path and no duplicate geometry.
 */

import { useId } from 'react';

function noise(i: number, seed: number): number {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Envelope at `t` (0..1 across the width). Three sines at incommensurate
 * frequencies give the swells and dips of a voice; a little grain keeps it from
 * looking mechanically smooth.
 *
 * The ends are floored, not tapered. Tapering to zero closes the mirrored trace
 * into a lozenge that reads as a blob rather than a signal — the amplitude has
 * to stay alive right up to the edge for it to look like a chart.
 */
function envelope(t: number, seed: number): number {
  const x = t * Math.PI * 2;
  const slow = Math.sin(x * 0.9 + seed * 0.7) * 0.5 + 0.5;
  const mid = Math.sin(x * 2.7 + seed * 1.9) * 0.5 + 0.5;
  const fast = Math.sin(x * 6.1 + seed * 3.3) * 0.5 + 0.5;
  const grain = noise(Math.round(t * 400), seed) * 0.2;
  // An overall swell across the whole row, so the shape has a direction.
  const arc = 0.55 + 0.45 * Math.sin(t * Math.PI);
  const a = (slow * 0.42 + mid * 0.32 + fast * 0.18 + grain) * arc;
  return Math.max(0.22, Math.min(1, a));
}

const SAMPLES = 220;
const VB_W = 1000;
const VB_H = 100;

export function LineWave({
  seed = 1,
  height = 72,
  progress = 0,
  live = false,
  busy = false,
  className,
  label,
}: {
  seed?: number;
  height?: number;
  /** 0–1 through the track. */
  progress?: number;
  /** Slightly fuller trace while audio is running. */
  live?: boolean;
  /** Work in flight: the trace breathes to show the system is alive. */
  busy?: boolean;
  className?: string;
  /** Accessible name; omit for a decorative trace. */
  label?: string;
}) {
  const id = useId();
  const p = Math.max(0, Math.min(1, progress));

  // Two representations of the same envelope, because they want different
  // closure. The area fill is a closed shape; the stroke is two OPEN subpaths,
  // so the trace never draws a vertical wall down each end and reads as a
  // chart rather than a lozenge.
  const topEdge: string[] = [];
  const bottomEdge: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    let a = envelope(t, seed);
    if (live) a = Math.min(1, a * 1.08);
    const half = a * (VB_H / 2 - 3);
    const x = t * VB_W;
    topEdge.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${(VB_H / 2 - half).toFixed(2)}`);
    bottomEdge.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${(VB_H / 2 + half).toFixed(2)}`);
  }
  const fillPath =
    `${topEdge.join(' ')} ${bottomEdge
      .slice()
      .reverse()
      .map((d) => d.replace('M', 'L'))
      .join(' ')} Z`;
  const strokePath = `${topEdge.join(' ')} ${bottomEdge.join(' ')}`;

  return (
    <svg
      className={[
        'n-line',
        busy ? 'n-line-busy' : '',
        live ? 'n-line-live' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="none"
      style={{ blockSize: height }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        {/* A hard stop, not a fade: the line is one colour behind the playhead
            and another colour ahead of it. */}
        <linearGradient id={`${id}-g`} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${p * 100}%`} stopColor="var(--accent)" />
          <stop offset={`${p * 100}%`} stopColor="var(--wave-ahead)" />
          <stop offset="100%" stopColor="var(--wave-ahead)" />
        </linearGradient>
        <linearGradient id={`${id}-f`} x1="0" x2="1" y1="0" y2="0">
          <stop offset={`${p * 100}%`} stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset={`${p * 100}%`} stopColor="var(--wave-ahead)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--wave-ahead)" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      <path d={fillPath} fill={`url(#${id}-f)`} stroke="none" />
      <path
        d={strokePath}
        fill="none"
        stroke={`url(#${id}-g)`}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />

      {p > 0 && !busy ? (
        <line
          x1={p * VB_W}
          x2={p * VB_W}
          y1="4"
          y2={VB_H - 4}
          stroke="var(--accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}

/** The line trace as an interactive track. */
export function ScrubTrack({
  seed = 3,
  progress = 0,
  height = 34,
  onSeek,
  label,
  busy = false,
}: {
  seed?: number;
  progress: number;
  height?: number;
  onSeek?: (fraction: number) => void;
  label: string;
  busy?: boolean;
}) {
  return (
    <div
      className={`n-scrub${busy ? ' n-scrub-busy' : ''}`}
      role="slider"
      tabIndex={busy ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={busy ? undefined : Math.round(progress * 100)}
      aria-busy={busy || undefined}
      onKeyDown={(e) => {
        if (!onSeek || busy) return;
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowRight') { e.preventDefault(); onSeek(Math.min(1, progress + step)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek(Math.max(0, progress - step)); }
      }}
      onClick={(e) => {
        if (!onSeek || busy) return;
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    >
      <LineWave seed={seed} progress={progress} height={height} busy={busy} />
    </div>
  );
}
