import { useMemo } from 'react';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { LineWave, audioPeaks } from '../design/Waveform';
import { Icon } from '../design/Icon';
import { voiceById } from '../core/tts/voices';

export function PlayerView({ onPickVoice }: { onPickVoice?: () => void }) {
  const { doc, time, duration, playing, currentSentence, voiceId, setView,
    busy, engineLoading, modelProgress, renderedCount, player, status, cancel, exportAudio, generateMode } = useNarrate();
  const voice = voiceById(voiceId);
  const peaks = useMemo(() => audioPeaks(player.segments.map((segment) => segment.samples)), [player, doc, renderedCount]);
  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const working = busy || engineLoading;
  const total = doc?.sentences.length ?? 0;
  const complete = total > 0 && renderedCount === total;
  const fraction = engineLoading ? modelProgress?.fraction ?? null : total > 0 ? renderedCount / total : null;
  const percent = fraction === null ? null : Math.min(100, Math.round(fraction * 100));
  if (!doc) return null;

  return (
    <div className="n-player">
      <header className="n-player-head">
        <div className="n-player-meta">
          <h1 className="n-player-title heading">{doc.title}</h1>
          <div className="n-player-stats">{doc.words.length.toLocaleString()} words · about {Math.max(1, Math.round(doc.words.length / 150))} min{doc.sourceName ? ` · ${doc.sourceName}` : ''}</div>
        </div>
        <button type="button" className="n-player-voice" disabled={working} onClick={() => onPickVoice?.()} aria-label="Change narrator">
          {voice ? <VoiceAvatar voice={voice} size={44} active={playing} /> : null}
          <div><div className="n-player-voice-caption">Narrator</div><div className="n-player-voice-name">{voice?.name}</div></div>
        </button>
      </header>

      <div className="n-stage-well"><LineWave peaks={peaks} progress={progress} live={playing} busy={working && !peaks.length} height={132} /></div>

      <div className="n-caption">
        {working ? <section className="n-player-generation" aria-busy="true">
          <div className="n-player-generation-head"><span role="status">{status}</span>{percent !== null ? <span className="n-player-generation-percent">{percent}%</span> : null}</div>
          <div className="n-job-progress" role="progressbar" aria-label={engineLoading ? 'Loading narrator' : 'Generating audio'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span className={percent === null ? 'n-progress-indeterminate' : ''} style={percent === null ? undefined : { inlineSize: `${percent}%` }} /></div>
          <p>{engineLoading ? modelProgress?.file ?? 'Preparing the narrator. The model is cached for future listening.' : `${renderedCount} of ${total} sentences ready${generateMode === 'stream' ? ' · audio continues as you listen' : ''}`}</p>
          {cancel ? <button type="button" className="pill" onClick={cancel}><Icon name="stop" size={13} />Stop generation</button> : null}
        </section> : currentSentence ? <p className="n-caption-line">{currentSentence.text}</p> : <p className="n-caption-line n-caption-idle">{duration > 0 ? 'Your audio is ready. Press play to listen.' : generateMode === 'stream' ? 'Press play to start listening as your audio is made.' : 'Press play to render the whole document, then listen.'}</p>}
      </div>

      <div className="n-player-actions">
        <button type="button" className="pill" onClick={() => setView('reader')}><Icon name="page" size={17} />Follow the text</button>
        {complete ? <><button type="button" className="pill" disabled={working} onClick={() => void exportAudio('wav')}><Icon name="download" size={15} />WAV</button><button type="button" className="pill" disabled={working} onClick={() => void exportAudio('mp3')}><Icon name="download" size={15} />MP3</button></> : <button type="button" className="pill" onClick={() => setView('library')}><Icon name="library" size={16} />Library</button>}
      </div>
    </div>
  );
}
