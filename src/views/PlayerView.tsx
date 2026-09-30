import { useMemo } from 'react';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { Waveform } from '../design/Waveform';
import { Icon } from '../design/Icon';
import { voiceById } from '../core/tts/voices';

const BARS = 150;

/**
 * The music-player view.
 *
 * For listening without reading: the text reduces to a single centred line and
 * the screen becomes one big waveform in a soft well, the way the reference
 * puts its microphone in a glowing recess. The waveform is generated from a
 * deterministic noise function, so a document always looks the same and the
 * view never shimmers on re-render.
 */
export function PlayerView({ onPickVoice }: { onPickVoice?: () => void }) {
  const { doc, time, duration, playing, currentSentence, voiceId, setView, view } = useNarrate();
  const voice = voiceById(voiceId);

  const seed = useMemo(() => {
    if (!doc) return 1;
    let h = 0;
    const n = Math.min(doc.charCount, 400);
    for (let i = 0; i < n; i++) h = (h * 31 + doc.plain.charCodeAt(i)) % 9973;
    return h;
  }, [doc]);

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;

  if (!doc) {
    return (
      <div className="n-player n-player-empty">
        <div className="n-empty">
          <p className="n-empty-title">Turn a document into audio</p>
          <p className="n-empty-body">
            Open a Markdown, PDF, DOCX, EPUB or RTF file and Narrate will read it to you,
            with the text following along word by word. Everything runs on this machine.
          </p>
          <label className="pill pill-primary n-filebtn">
            <Icon name="download" size={17} />
            Open a document
            <input
              type="file"
              className="sr-only"
              accept=".md,.markdown,.txt,.pdf,.docx,.epub,.rtf,.html,.htm,.xhtml"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) f.arrayBuffer().then((b) => void useNarrate.getState().openBuffer(f.name, b));
                e.target.value = '';
              }}
            />
          </label>
          <button type="button" className="pill" onClick={() => useNarrate.getState().openSample()}>
            <Icon name="page" size={17} />
            Open the sample
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="n-player">
      <header className="n-player-head">
        <div className="n-player-meta">
          <div className="label">Now reading</div>
          <h1 className="n-player-title heading">{doc.title}</h1>
          <div className="n-player-stats mono">
            {doc.words.length.toLocaleString()} words · about {Math.round(doc.words.length / 150)} min
            {doc.sourceName ? ` · ${doc.sourceName}` : ''}
          </div>
        </div>
        <button
          type="button"
          className="n-player-voice"
          onClick={() => onPickVoice?.()}
          aria-label="Change narrator"
        >
          {voice ? <VoiceAvatar voice={voice} size={44} active={playing} /> : null}
          <div>
            <div className="label">Narrator</div>
            <div className="n-player-voice-name">{voice?.name}</div>
          </div>
        </button>
      </header>

      <div className="n-stage-well">
        <Waveform bars={BARS} progress={progress} seed={seed} live={playing} height={168} />
      </div>

      <div className="n-caption">
        {currentSentence ? (
          <p className="n-caption-line">{currentSentence.text}</p>
        ) : (
          <p className="n-caption-line n-caption-idle">Press play. The text will follow the voice.</p>
        )}
      </div>

      <div className="n-player-actions">
        <button
          type="button"
          className={`pill${view === 'reader' ? ' pill-primary' : ''}`}
          onClick={() => setView('reader')}
        >
          <Icon name="page" size={17} />
          Follow the text
        </button>
        <label className="pill">
          <Icon name="download" size={17} />
          Open another
          <input
            type="file"
            className="sr-only"
            accept=".md,.markdown,.txt,.pdf,.docx,.epub,.rtf,.html,.htm,.xhtml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) f.arrayBuffer().then((b) => void useNarrate.getState().openBuffer(f.name, b));
              e.target.value = '';
            }}
          />
        </label>
      </div>
    </div>
  );
}
