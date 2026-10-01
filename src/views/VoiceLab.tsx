import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { KOKORO_VOICES, voiceById } from '../core/tts/voices';
import { useAudition } from '../components/useAudition';

/**
 * The Voice Lab.
 *
 * Two things live here, and they are not the same thing.
 *
 * Naming and casting is finished and works now: every voice has a name and a
 * generated avatar, and you can hear any of them before choosing.
 *
 * Cloning is not finished. This Kokoro build has fixed preset voices and no
 * cloning adapter. Pocket TTS is a possible additional engine, not an installed
 * capability. The cloning controls below explain exactly
 * what is missing, rather than being hidden or — worse — wired to something
 * that quietly does not clone. A voice that pretends to be a person is a worse
 * bug than a missing feature.
 */
export function VoiceLab() {
  const { setView, voiceId, setVoice, ensureEngine, engineReady, engine, busy } = useNarrate(useShallow(state => ({
    setView: state.setView, voiceId: state.voiceId, setVoice: state.setVoice, ensureEngine: state.ensureEngine,
    engineReady: state.engineReady, engine: state.engine, busy: state.busy,
  })));
  const [name, setName] = useState('');
  const [reference, setReference] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { audition, error: auditionError } = useAudition(engine, ensureEngine);

  const submit = async () => {
    setError(null);
    if (!reference) {
      setError('Choose a reference recording first.');
      return;
    }
    setError(
      'Voice cloning needs an additional model engine that is not implemented in this build. The built-in narrators below are available now.',
    );
  };

  const preview = (id: string) => audition('The quiet room held its breath, and every word arrived exactly on time.', id);

  return (
    <div className="n-panel-view">
      <header className="n-panel-head">
        <div>
          <div className="label">Voice lab</div>
          <h1 className="heading n-panel-title">Create a voice</h1>
          <p className="n-panel-sub">
            Hear and choose the built-in narrators. Voice cloning needs an additional
            model engine and is not available in this build.
          </p>
        </div>
        <button type="button" className="pill" onClick={() => setView('player')}>Done</button>
      </header>

      <section className="n-lab-section">
        <div className="label">New voice from a recording</div>
        <div className="n-clone">
          <label className="n-drop">
            <input
              type="file"
              accept="audio/*"
              className="sr-only"
              onChange={(e) => {
                setReference(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <Icon name="mic" size={26} />
            <span className="n-drop-title">
              {reference ? reference.name : 'Choose a reference recording'}
            </span>
            <span className="n-drop-sub">
              5 to 15 seconds of clean speech works best. Use a voice you have the right to clone.
            </span>
          </label>

          <div className="n-clone-fields">
            <label className="n-field">
              <span className="label">Name this voice</span>
              <input
                className="input"
                value={name}
                placeholder="e.g. Narrator, Second Voice, Ada"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="pill pill-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              Create voice
            </button>
          </div>

          {error || auditionError ? <p className="n-error" role="alert">{auditionError ?? error}</p> : null}

          <div className="n-notice">
            <strong>Voice cloning is planned.</strong> This Kokoro build supports {KOKORO_VOICES.length} preset
            narrators. Engines such as Pocket TTS can create a voice from a reference recording,
            but Narrate still needs an adapter and compatible model files to support that.
          </div>
        </div>
      </section>

      <section className="n-lab-section">
        <div className="label">Built-in narrators</div>
        <p className="n-lab-sub">
          All {KOKORO_VOICES.length} have names and avatars already. Auditioning a voice is the
          only reliable way to judge it.
        </p>
        <div className="n-laboutline">
          {KOKORO_VOICES.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`n-labout${v.id === voiceId ? ' n-labout-on' : ''}`}
              onClick={() => setVoice(v.id)}
              title={v.persona}
            >
              <VoiceAvatar voice={v} size={40} active={v.id === voiceId} />
              <span className="n-labout-text">
                <span className="n-labout-name">{v.name}</span>
                {v.gender ? <span className="n-voice-gender">{v.gender}</span> : null}
              </span>
              <span
                className="n-labout-play"
                role="button"
                tabIndex={0}
                aria-label={`Audition ${v.name}`}
                onClick={(e) => { e.stopPropagation(); if (!busy) void preview(v.id); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); if (!busy) void preview(v.id); }
                }}
              >
                ▸
              </span>
            </button>
          ))}
        </div>
      </section>

      {voiceById(voiceId) ? (
        <section className="n-lab-section">
          <div className="label">Currently cast</div>
          <div className="n-castcard">
            <VoiceAvatar voice={voiceById(voiceId)!} size={64} active />
            <div>
              <div className="n-cast-name">{voiceById(voiceId)!.name}</div>
              {voiceById(voiceId)!.gender ? <div className="n-voice-gender">{voiceById(voiceId)!.gender}</div> : null}
              <div className="n-cast-persona">{voiceById(voiceId)!.persona}</div>
              <div className="n-cast-id mono">{voiceById(voiceId)!.id}</div>
            </div>
          </div>
        </section>
      ) : null}

      <p className="n-lab-foot">
        {engineReady
          ? 'Kokoro is loaded and auditioning is live.'
          : 'Load the model on the Models page to audition voices here.'}
      </p>
    </div>
  );
}
