import { useMemo } from 'react';
import { Icon, type IconName } from '../design/Icon';
import { ScrubTrack, audioPeaks } from '../design/Waveform';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { voiceById } from '../core/tts/voices';

function clock(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function RoundButton({
  name, onClick, label, disabled, primary, small,
}: {
  name: IconName; onClick: () => void; label: string;
  disabled?: boolean; primary?: boolean; small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-btn${primary ? ' icon-btn-primary' : ''}${small ? ' icon-btn-sm' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      <Icon name={name} size={primary ? 24 : small ? 17 : 19} />
    </button>
  );
}

/**
 * The transport.
 *
 * No fill and no shadow of its own: it sits directly on the green wash, and
 * separation comes from the circular controls. Sentence jumps are a bare
 * chevron; paragraph jumps add a bar on the outside edge, following the
 * skip-to-start convention.
 *
 * While rendering, the track becomes indeterminate and a travelling wave runs
 * through it, so waiting is visibly different from stalled.
 */
export function Transport({ onPickVoice }: { onPickVoice?: () => void }) {
  const {
    doc, playing, time, duration, voiceId, targetSentence,
    toggle, stepSentence, stepParagraph, seekTime,
    busy, engineLoading, modelProgress, renderedCount, engine, player, generateMode,
  } = useNarrate();

  const voice = voiceById(voiceId);
  const total = doc?.sentences.length ?? 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const working = busy || engineLoading;
  const peaks = useMemo(() => audioPeaks(player.segments.map((segment) => segment.samples), 72), [player, doc, renderedCount]);

  const statusText = engineLoading
    ? modelProgress?.fraction != null
      ? `loading model ${Math.round(modelProgress.fraction * 100)}%`
      : 'loading model'
    : busy
      ? `rendering ${renderedCount} of ${total}`
      : playing
        ? 'speaking'
        : 'ready';

  return (
    <div
      className={`n-transport${working ? ' n-transport-busy' : ''}`}
      role="region"
      aria-label="Playback"
    >
      <div className="n-transport-jumps">
        <RoundButton
          name="prevParagraph"
          label="Previous paragraph"
          small
          onClick={() => void stepParagraph(-1)}
          disabled={!total || working}
        />
        <RoundButton
          name="prevSentence"
          label="Previous sentence"
          small
          onClick={() => void stepSentence(-1)}
          disabled={!total || working}
        />
      </div>

      <RoundButton
        name={playing ? 'pause' : 'play'}
        label={playing ? 'Pause' : 'Play'}
        primary
        onClick={() => void toggle()}
        disabled={!doc || (working && !playing && (engineLoading || !renderedCount || generateMode === 'full'))}
      />

      <div className="n-transport-track">
        <ScrubTrack
          progress={progress}
          peaks={peaks}
          label="Position in document"
          busy={working && !duration}
          disabled={!duration}
          onSeek={(fraction) => seekTime(fraction * duration)}
        />
        <div className="n-transport-meta">
          <span className="mono">{clock(time)}</span>
          <span className="n-transport-sep">/</span>
          <span className="mono n-transport-total">
            {duration > 0 ? clock(duration) : '--:--'}
          </span>
          <span className="n-transport-spacer" />
          <span
            className={`live-dot${working ? ' live-dot-busy' : ''}${playing ? ' live-dot-on' : ''}`}
            role="status"
            aria-live="polite"
          >
            {statusText}
          </span>
        </div>
      </div>

      <div className="n-transport-jumps">
        <RoundButton
          name="nextSentence"
          label="Next sentence"
          small
          onClick={() => void stepSentence(1)}
          disabled={!total || working}
        />
        <RoundButton
          name="nextParagraph"
          label="Next paragraph"
          small
          onClick={() => void stepParagraph(1)}
          disabled={!total || working}
        />
      </div>

      <button
        type="button"
        className="n-transport-voice"
        onClick={() => onPickVoice?.()}
        aria-label={`Narrator: ${voice?.name ?? voiceId}, from ${engine.name}. Change narrator`}
        title={`${voice?.name ?? voiceId} — ${engine.name}`}
      >
        {voice ? <VoiceAvatar voice={voice} size={38} active={playing} /> : null}
        <span className="n-transport-voice-text">
          <span className="label">Narrator</span>
          <span className="n-transport-voice-name">{voice?.name ?? '—'}</span>
          <span className="n-transport-voice-model">{engine.name}</span>
        </span>
      </button>

      <span className="sr-only">
        Sentence {targetSentence + 1} of {total}. {renderedCount} sentences rendered.
      </span>
    </div>
  );
}
