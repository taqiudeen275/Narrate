import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNarrate } from '../state/store';
import { VoiceAvatar } from '../design/VoiceAvatar';
import { LineWave, audioPeaks } from '../design/Waveform';
import { Icon } from '../design/Icon';
import { voiceById } from '../core/tts/voices';
import { MODEL_VARIANTS } from '../core/tts/downloads';

function PlaybackWave({ peaks, working }: { peaks: readonly number[]; working: boolean }) {
  const { time, duration, playing } = useNarrate(useShallow((state) => ({ time: state.time, duration: state.duration, playing: state.playing })));
  return <LineWave peaks={peaks} progress={duration > 0 ? Math.min(1, time / duration) : 0}
    live={playing} busy={working && !peaks.length} height={112} label={peaks.length ? 'Waveform of saved audio' : working ? 'Preparing audio' : 'Audio waveform appears when generation starts'} />;
}

export function PlayerView({ onPickVoice }: { onPickVoice?: () => void }) {
  const { doc, duration, playing, currentSentence, voiceId, setView,
    busy, engineLoading, modelProgress, renderedCount, player, status, cancel, exportAudio, generateMode,
    audioProfile, engine, generate } = useNarrate(useShallow((state) => ({
      doc: state.doc, duration: state.duration, playing: state.playing, currentSentence: state.currentSentence,
      voiceId: state.voiceId, setView: state.setView, busy: state.busy, engineLoading: state.engineLoading,
      modelProgress: state.modelProgress, renderedCount: state.renderedCount, player: state.player,
      status: state.status, cancel: state.cancel, exportAudio: state.exportAudio, generateMode: state.generateMode,
      audioProfile: state.audioProfile, engine: state.engine, generate: state.generate,
    })));
  const voice = voiceById(voiceId);
  const peaks = useMemo(() => audioPeaks(player.segments.map((segment) => segment.samples)), [player, doc, renderedCount]);
  const working = busy || engineLoading;
  const total = doc?.sentences.length ?? 0;
  const complete = total > 0 && renderedCount === total;
  const fraction = engineLoading ? modelProgress?.fraction ?? null : total > 0 ? renderedCount / total : null;
  const percent = fraction === null ? null : Math.min(100, Math.round(fraction * 100));
  const savedModel = audioProfile ? MODEL_VARIANTS.find(model => model.cacheId === audioProfile.modelId)?.name ?? audioProfile.modelId : null;
  if (!doc) return null;

  return (
    <div className="n-player">
      <header className="n-player-head">
        <div className="n-player-meta">
          <h1 className="n-player-title heading">{doc.title}</h1>
          <div className="n-player-stats">{doc.words.length.toLocaleString()} words · about {Math.max(1, Math.round(doc.words.length / 150))} min</div>
          {savedModel ? <div className="n-player-stats" aria-label="Saved audio model">Saved audio: {savedModel}</div> : null}
        </div>
        <button type="button" className="n-player-voice" disabled={working} onClick={() => onPickVoice?.()} aria-label="Change narrator">
          {voice ? <VoiceAvatar voice={voice} size={38} active={playing} /> : null}
          <div><div className="n-player-voice-name">{voice?.name ?? voiceId}</div><div className="n-player-voice-caption">Change narrator</div></div>
        </button>
      </header>

      <div className="n-listening-field">
        <div className="n-stage-well"><PlaybackWave peaks={peaks} working={working} /></div>
        <div className="n-caption">
          <p className={`n-caption-line${currentSentence ? '' : ' n-caption-idle'}`}>{currentSentence?.text ??
            (engineLoading ? 'Preparing your narrator…' : working ? generateMode === 'full' ? 'Preparing the document…' : 'Preparing the first sentence…' : duration > 0 ? 'Your saved audio is ready to play.' :
              generateMode === 'stream' ? 'Press play to start listening as your audio is made.' : 'Press play to prepare the whole document for listening and export.')}</p>
        </div>
      </div>

      {working ? <section className="n-player-generation" aria-busy="true">
          <div className="n-player-generation-head"><span role="status">{status}</span>{percent !== null ? <span className="n-player-generation-percent">{percent}%</span> : null}</div>
          <div className="n-job-progress" role="progressbar" aria-label={engineLoading ? 'Loading narrator' : 'Generating audio'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><span className={percent === null ? 'n-progress-indeterminate' : ''} style={percent === null ? undefined : { inlineSize: `${percent}%` }} /></div>
          <div className="n-player-generation-foot"><p>{engineLoading ? modelProgress?.file ?? 'This narrator stays cached for your next session.' : `${renderedCount} of ${total} sentences saved`}</p>
            {cancel ? <button type="button" className="pill" onClick={cancel}><Icon name="stop" size={13} />Stop</button> : null}</div>
        </section> : null}

      <div className="n-player-actions">
        {audioProfile && audioProfile.modelId !== engine.id ? <button type="button" className="pill pill-primary" disabled={working}
          onClick={() => void generate(generateMode)}><Icon name="voice" size={17} />Generate with {engine.name}</button> : null}
        <button type="button" className="pill" onClick={() => setView('reader')}><Icon name="page" size={17} />Follow the text</button>
        {complete ? <><button type="button" className="pill" disabled={working} onClick={() => void exportAudio('wav')}><Icon name="download" size={15} />WAV</button><button type="button" className="pill" disabled={working} onClick={() => void exportAudio('mp3')}><Icon name="download" size={15} />MP3</button></> : <button type="button" className="pill" onClick={() => setView('library')}><Icon name="library" size={16} />Library</button>}
      </div>
      {renderedCount > 0 ? <details className="n-audio-recovery">
        <summary>Audio recovery</summary>
        <p>Make a fresh narration with {engine.name} and the current narrator. This replaces saved audio for this selection. Your previous take stays saved until replacement starts successfully.</p>
        <button type="button" className="pill" disabled={working}
          onClick={() => void generate('full', { fresh: true })}>Regenerate audio</button>
      </details> : null}
    </div>
  );
}
