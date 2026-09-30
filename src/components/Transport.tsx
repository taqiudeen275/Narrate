import { Icon, type IconName } from '../design/Icon';
import { ScrubTrack } from '../design/Waveform';
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
 * A floating glass pill: paragraph jumps outermost, sentence jumps inside them,
 * the filled green play disc in the middle over a scrub track, and the cast
 * narrator on the right. Word seeking is not here on purpose — it happens by
 * touching the word in the reader.
 */
export function Transport() {
  const {
    doc, playing, time, duration, voiceId, targetSentence,
    toggle, stepSentence, stepParagraph, seekWord, setView,
    busy, engineLoading, renderedCount,
  } = useNarrate();

  const voice = voiceById(voiceId);
  const total = doc?.sentences.length ?? 0;
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  return (
    <div className="n-transport glass-strong" role="region" aria-label="Playback">
      <div className="n-transport-jumps">
        <RoundButton name="prevParagraph" label="Previous paragraph" small
          onClick={() => void stepParagraph(-1)} disabled={!total} />
        <RoundButton name="prevSentence" label="Previous sentence" small
          onClick={() => void stepSentence(-1)} disabled={!total} />
      </div>

      <RoundButton
        name={playing ? 'pause' : 'play'}
        label={playing ? 'Pause' : 'Play'}
        primary
        onClick={() => void toggle()}
        disabled={!doc || busy}
      />

      <div className="n-transport-track">
        <ScrubTrack
          bars={104}
          progress={progress}
          seed={(doc?.charCount ?? 7) % 9973}
          label="Position in document"
          onSeek={(f) => {
            const s = doc?.sentences[Math.floor(f * Math.max(total - 1, 0))];
            if (s) void seekWord(s.wordStart);
          }}
        />
        <div className="n-transport-meta">
          <span className="mono">{clock(time)}</span>
          <span className="n-transport-sep">/</span>
          <span className="mono n-transport-total">{duration > 0 ? clock(duration) : '--:--'}</span>
          <span className="n-transport-spacer" />
          <span className={`live-dot${playing ? ' live-dot-on' : ''}`}>
            {engineLoading ? 'loading model' : playing ? 'speaking' : engineLoading ? 'ready' : 'ready'}
          </span>
        </div>
      </div>

      <div className="n-transport-jumps">
        <RoundButton name="nextSentence" label="Next sentence" small
          onClick={() => void stepSentence(1)} disabled={!total} />
        <RoundButton name="nextParagraph" label="Next paragraph" small
          onClick={() => void stepParagraph(1)} disabled={!total} />
      </div>

      <button
        type="button"
        className="n-transport-voice"
        onClick={() => setView('voices')}
        aria-label={`Narrator: ${voice?.name ?? voiceId}. Change narrator`}
      >
        {voice ? <VoiceAvatar voice={voice} size={38} active={playing} /> : null}
        <span className="n-transport-voice-text">
          <span className="label">Narrator</span>
          <span className="n-transport-voice-name">{voice?.name ?? '—'}</span>
        </span>
      </button>

      <span className="sr-only">
        Sentence {targetSentence + 1} of {total}. {renderedCount} sentences rendered.
      </span>
    </div>
  );
}
