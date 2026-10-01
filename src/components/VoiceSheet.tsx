import { useEffect, useState } from 'react';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { Icon } from '../design/Icon';
import { availableVoices } from '../core/tts/voices';
import { useAudition } from './useAudition';

/**
 * Narrator picker, as a sheet over the current screen.
 *
 * Reached from the Listen and Read views so the narrator can be changed without
 * leaving the thing you were listening to. Voices come from
 * `availableVoices()`, which is the engine's own list — narrators are speakers
 * inside one model's weights, so the catalogue is model-bound, not global.
 */
export function VoiceSheet({ onClose }: { onClose: () => void }) {
  const { voiceId, setVoice, engine, engineReady, ensureEngine, busy } = useNarrate();
  const [query, setQuery] = useState('');
  const { audition, error } = useAudition(engine, ensureEngine);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const voices = availableVoices();
  const q = query.trim().toLowerCase();
  const list = voices.filter(
    (v) => !q || v.name.toLowerCase().includes(q) || v.persona.toLowerCase().includes(q),
  );

  return (
    <div className="n-sheet-scrim" onClick={onClose} role="presentation">
      <div
        className="n-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a narrator"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="n-sheet-head">
          <div>
            <div className="label">Casting</div>
            <h2 className="n-sheet-title">Choose a narrator</h2>
            <p className="n-sheet-sub">
              {voices.length} in this model. Narrators belong to the model that
              carries them, so this list changes when the engine does.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" size={17} />
          </button>
        </header>

        <div className="n-sheet-search n-searchwrap">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Search narrators"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search narrators"
          />
        </div>

        {error ? <p className="n-error" role="alert">{error}</p> : null}

        <div className="n-sheet-list scroll">
          {list.map((v) => {
            const on = v.id === voiceId;
            return (
              <div key={v.id} className={`n-sheet-row${on ? ' n-sheet-row-on' : ''}`}>
                <button
                  type="button"
                  className="n-sheet-pick"
                  onClick={() => { setVoice(v.id); onClose(); }}
                  aria-pressed={on}
                >
                  <VoiceAvatar voice={v} size={40} active={on} />
                  <span className="n-sheet-text">
                    <span className="n-sheet-name">{v.name}</span>
                    <span className="n-sheet-persona">{v.persona}</span>
                  </span>
                  <span className="label">{v.accent}</span>
                  {on ? <span className="n-sheet-check"><Icon name="check" size={15} /></span> : null}
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => void audition(v.sample, v.id)}
                  disabled={busy}
                  aria-label={`Audition ${v.name}`}
                  title={engineReady ? 'Audition' : 'Load the model to audition'}
                >
                  <Icon name="play" size={13} />
                </button>
              </div>
            );
          })}
          {list.length === 0 ? <p className="n-empty-body">No narrator matches “{query}”.</p> : null}
        </div>

        <footer className="n-sheet-foot">
          <span className="n-sheet-note">
            Automatic scores do not pick a narrator. They over-rate small models with
            cheap vocoders — listen and decide for yourself.
          </span>
        </footer>
      </div>
    </div>
  );
}
