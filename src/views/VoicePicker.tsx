import { useMemo, useState } from 'react';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { Icon } from '../design/Icon';
import { availableVoices } from '../core/tts/voices';
import { useAudition } from '../components/useAudition';

/**
 * The full cast.
 *
 * Cards carry a translucent tonal wash derived from the voice's own hue, so the
 * grid reads as a set of people rather than a list of rows. Every card names
 * the model its narrator belongs to, because narrators are model-bound and a
 * name without its model is a name that will silently stop working the day the
 * engine changes.
 */
export function VoicePicker({ onPickVoice }: { onPickVoice?: () => void }) {
  const {
    voiceId, setVoice, engine, engineReady, ensureEngine, busy,
  } = useNarrate();
  const [accent, setAccent] = useState('All');
  const [query, setQuery] = useState('');
  const { audition, error } = useAudition(engine, ensureEngine);

  const voices = useMemo(() => availableVoices(), []);
  const accents = useMemo(
    () => ['All', ...Array.from(new Set(voices.map((v) => v.accent))).sort()],
    [voices],
  );

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter(
      (v) =>
        (accent === 'All' || v.accent === accent) &&
        (!q || v.name.toLowerCase().includes(q) || v.persona.toLowerCase().includes(q)),
    );
  }, [voices, accent, query]);

  return (
    <div className="n-panel-view">
      <header className="n-panel-head">
        <div>
          <div className="label">Casting</div>
          <h1 className="n-panel-title">Narrators</h1>
          <p className="n-panel-sub">
            {voices.length} voices, all running locally in {engine.name}. A narrator is a
            speaker inside one model's weights, so this list belongs to {engine.name} and
            changes when the engine does. Listen before you commit — no automatic score
            can tell you which narrator suits a book.
          </p>
        </div>
        {onPickVoice ? (
          <button type="button" className="pill" onClick={onPickVoice}>
            <Icon name="voice" size={16} />
            Quick pick
          </button>
        ) : null}
      </header>

      <div className="n-filters">
        <div className="n-searchwrap">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Search by name or character"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search narrators"
          />
        </div>
        <div className="n-chips" role="group" aria-label="Filter by accent">
          {accents.map((a) => (
            <button
              key={a}
              type="button"
              className={`n-chip${accent === a ? ' n-chip-on' : ''}`}
              onClick={() => setAccent(a)}
              aria-pressed={accent === a}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="n-error" role="alert">{error}</p> : null}

      <div className="n-voicegrid">
        {list.map((v) => {
          const on = v.id === voiceId;
          return (
            <article
              key={v.id}
              className={`n-vcard${on ? ' n-vcard-on' : ''}`}
              style={{ '--av-h': String(v.tone) } as React.CSSProperties}
            >
              <button
                type="button"
                className="n-vcard-main"
                onClick={() => setVoice(v.id)}
                aria-pressed={on}
              >
                <VoiceAvatar voice={v} size={46} active={on} />
                <span className="n-vcard-text">
                  <span className="n-vcard-name">
                    {v.name}
                    {on ? <span className="n-vcard-check" aria-label="Selected" /> : null}
                  </span>
                  <span className="n-vcard-persona">{v.persona}</span>
                  <span className="n-vcard-tags">
                    <span className="n-sheet-model">{engine.name}</span>
                    <span className="n-vcard-accent">{v.accent}</span>
                    {v.clonable ? (
                      <span className="n-sheet-model n-sheet-model-clone">clonable</span>
                    ) : null}
                  </span>
                </span>
              </button>
              <div className="n-vcard-foot">
                <button
                  type="button"
                  className="pill pill-quiet"
                  disabled={busy}
                  onClick={() => void audition(v.sample, v.id)}
                >
                  <Icon name="play" size={13} />
                  {engineReady ? 'Audition' : 'Load model to audition'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
