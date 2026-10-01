import { useId } from 'react';

/** Sample a bounded number of points per bin, so a book never scans millions of samples on a UI update. */
export function audioPeaks(chunks: readonly Float32Array[], bins = 96): number[] {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total) return [];
  const peaks = Array.from({ length: bins }, () => 0);
  let offset = 0;
  for (const chunk of chunks) {
    const stride = Math.max(1, Math.floor(total / (bins * 96)));
    for (let index = 0; index < chunk.length; index += stride) {
      const bin = Math.min(bins - 1, Math.floor((offset + index) / total * bins));
      peaks[bin] = Math.max(peaks[bin], Math.abs(chunk[index]));
    }
    offset += chunk.length;
  }
  const maximum = Math.max(...peaks, 0.001);
  return peaks.map((peak) => Math.max(0.035, Math.pow(peak / maximum, 0.65)));
}

/** Thin vertical marks, measured from saved audio. Before generation they remain a quiet baseline. */
export function LineWave({ height = 72, progress = 0, live = false, busy = false,
  peaks = [], className, label }: {
  height?: number;
  progress?: number;
  live?: boolean;
  busy?: boolean;
  peaks?: readonly number[];
  className?: string;
  label?: string;
}) {
  const id = useId();
  const fraction = Math.max(0, Math.min(1, progress));
  const count = peaks.length || 96;
  const width = 1000;
  return (
    <svg className={`n-line n-wave-bars${busy ? ' n-wave-bars-busy' : ''}${live ? ' n-wave-bars-live' : ''}${peaks.length ? '' : ' n-wave-bars-empty'}${className ? ` ${className}` : ''}`}
      viewBox={`0 0 ${width} 100`} preserveAspectRatio="none" style={{ blockSize: height }}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} focusable="false">
      <defs><linearGradient id={`${id}-g`} x1="0" x2="1" y1="0" y2="0"><stop offset={`${fraction * 100}%`} stopColor="var(--accent)" /><stop offset={`${fraction * 100}%`} stopColor="var(--wave-ahead)" /><stop offset="100%" stopColor="var(--wave-ahead)" /></linearGradient></defs>
      <g stroke={`url(#${id}-g)`} strokeWidth={2.8} strokeLinecap="round">
        {Array.from({ length: count }, (_, index) => {
          const half = (peaks[index] ?? 0.035) * 43;
          const x = (index + 0.5) / count * width;
          return <line key={index} className="n-wave-mark" x1={x} x2={x} y1={50 - half} y2={50 + half} vectorEffect="non-scaling-stroke" style={{ animationDelay: `${(index % 16) * -0.09}s` }} />;
        })}
      </g>
      {fraction > 0 && peaks.length ? <line x1={fraction * width} x2={fraction * width} y1="3" y2="97" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  );
}

export function ScrubTrack({ progress = 0, height = 34, peaks, onSeek, label, busy = false, disabled = false }: {
  progress: number; height?: number; peaks?: readonly number[];
  onSeek?: (fraction: number) => void; label: string; busy?: boolean; disabled?: boolean;
}) {
  const unavailable = busy || disabled || !onSeek;
  return (
    <div className={`n-scrub${unavailable ? ' n-scrub-busy' : ''}`} role="slider" tabIndex={unavailable ? -1 : 0}
      aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}
      aria-valuetext={`${Math.round(progress * 100)}% of available audio`} aria-disabled={unavailable || undefined}
      onKeyDown={(event) => {
        if (!onSeek || unavailable) return;
        const step = event.shiftKey ? 0.1 : 0.02;
        if (event.key === 'ArrowRight') { event.preventDefault(); onSeek(Math.min(1, progress + step)); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); onSeek(Math.max(0, progress - step)); }
        if (event.key === 'Home') { event.preventDefault(); onSeek(0); }
        if (event.key === 'End') { event.preventDefault(); onSeek(1); }
      }}
      onClick={(event) => {
        if (!onSeek || unavailable) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)));
      }}>
      <LineWave progress={progress} height={height} peaks={peaks} busy={busy} />
    </div>
  );
}
