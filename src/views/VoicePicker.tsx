import { useMemo, useState } from 'react';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { Icon } from '../design/Icon';
import { KOKORO_VOICES, voicesByAccent, type Voice } from '../core/tts/voices';

/**
 * Casting.
 *
 * Every voice is presented with a name, a character note, an accent, and a
 * generated avatar — because the user is choosing a narrator, not a format.
 * A "Play sample" control on each card is the only honest way to compare:
 * automatic quality scores systematically over-rate small models, so the app
 * never ranks or scores voices for you.
 */
export function VoicePicker() {
  const { voiceId, setVoice, setView, engine, engineReady, ensureEngine, busy } = useNarrate();
  const [accent, setAccent] = useState<string>('All');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => voicesByAccent(), []);
  const accents = useMemo(() => ['All', ...Array.from(groups.keys()).sort()], [groups]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return KOKORO_VOICES.filter(
      (v: Voice) =>
        (accent === 'All' || v.accent === accent) &&
        (!q || v.name.toLowerCase().includes(q) || v.persona.toLowerCase().includes(q)),
    );
  }, [accent, query]);

  const sample = async (v: Voice) => {
    await ensureEngine();
    if (!engine.ready) return;
    try {
      const chunk = await engine.synthesize(v.sample, v.id, { speed: 1 });
      const ctx = new AudioContext();
      const buf = ctx.createBuffer(1, chunk.samples.length, chunk.sampleRate);
      buf.getChannelData(0).set(chunk.samples);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start();
    } catch (e) {
      useNarrate.setState({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="n-panel-view">
      <header className="n-panel-head">
        <div>
          <div className="label">Casting</div>
          <h1 className="heading n-panel-title">Narrators</h1>
          <p className="n-panel-sub">
            {KOKORO_VOICES.length} voices, all running locally. Listen before you commit —
            no automatic score can tell you which narrator suits a book.
          </p>
        </div>
        <button type="button" className="pill" onClick={() => setView('player')}>Done</button>
      </header>

      <div className="n-filters">
        <div className="n-searchwrap">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Search by name or character"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search voices"
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

      <div className="n-voicegrid">
        {list.map((v) => {
          const on = v.id === voiceId;
          return (
            <article key={v.id} className={`n-vcard${on ? ' n-vcard-on' : ''}`}>
              <button
                type="button"
                className="n-vcard-main"
                onClick={() => setVoice(v.id)}
                aria-pressed={on}
              >
                <VoiceAvatar voice={v} size={48} active={on} />
                <div className="n-vcard-text">
                  <div className="n-vcard-name">
                    {v.name}
                    {on ? <span className="n-vcard-check" aria-label="Selected" /> : null}
                  </div>
                  <div className="n-vcard-persona">{v.persona}</div>
                  <div className="n-vcard-accent label">{v.accent}</div>
                </div>
              </button>
              <div className="n-vcard-foot">
                <button
                  type="button"
                  className="pill pill-quiet"
                  disabled={busy}
                  onClick={() => void sample(v)}
                >
                  <Icon name="play" size={14} />
                  {engineReady ? 'Play sample' : 'Load model to sample'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
