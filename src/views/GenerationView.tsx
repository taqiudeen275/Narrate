import { useNarrate } from '../state/store';
import { useShallow } from 'zustand/react/shallow';
import { Icon } from '../design/Icon';
import { voiceById } from '../core/tts/voices';
import { MODEL_VARIANTS } from '../core/tts/downloads';

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const LABELS = { running: 'Generating', completed: 'Complete', cancelled: 'Stopped', failed: 'Failed', interrupted: 'Interrupted' };

export function GenerationView() {
  const { generationJobs, library, engineLoading, modelProgress, status, cancel, openLibraryDoc, setView } = useNarrate(useShallow(state => ({
    generationJobs: state.generationJobs, library: state.library, engineLoading: state.engineLoading,
    modelProgress: state.modelProgress, status: state.status, cancel: state.cancel,
    openLibraryDoc: state.openLibraryDoc, setView: state.setView,
  })));
  const jobs = [...generationJobs].sort((a, b) => b.startedAt - a.startedAt);
  const running = jobs.find((job) => job.status === 'running');
  const downloadPercent = modelProgress?.fraction != null ? Math.round(modelProgress.fraction * 100) : null;
  const open = async (docId: string) => {
    await openLibraryDoc(docId);
    if (useNarrate.getState().activeDocId === docId) setView('player');
  };

  return (
    <div className="n-panel-view n-work">
      <header className="n-panel-head"><div><h2 className="n-panel-title">Work history</h2><p className="n-panel-sub">Every generation attempt, with its narrator, progress, and outcome. Saved on this device.</p></div><span className="n-work-count">{jobs.length} {jobs.length === 1 ? 'attempt' : 'attempts'}</span></header>
      {engineLoading ? <section className="n-work-loading" aria-busy="true">
        <div className="n-loading-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -0.12}s` }} />)}</div>
        <div><h3>{status}</h3><p>{modelProgress ? `${modelProgress.file}${downloadPercent !== null ? ` · ${downloadPercent}%` : ''}` : 'Preparing the narrator…'}</p></div>
        <div className="n-job-progress" role="progressbar" aria-label="Voice model download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={downloadPercent ?? undefined}><span className={downloadPercent === null ? 'n-progress-indeterminate' : ''} style={downloadPercent === null ? undefined : { inlineSize: `${downloadPercent}%` }} /></div>
      </section> : null}
      {!jobs.length ? <section className="n-work-empty"><Icon name="history" size={30} /><h3>Your first narration starts in Library.</h3><p>Open a document, choose a narrator, and press play. Each attempt will be recorded here, including work that is stopped or interrupted.</p><button type="button" className="pill" onClick={() => setView('library')}><Icon name="library" size={16} />Go to Library</button></section> : <ol className="n-job-list">
        {jobs.map((job) => {
          const narrator = voiceById(job.voiceId)?.name ?? job.voiceId;
          const model = MODEL_VARIANTS.find(variant => variant.cacheId === job.modelId)?.name ?? job.modelId ?? 'Not recorded';
          const percent = Math.min(100, Math.round(job.completedSentences / Math.max(1, job.totalSentences) * 100));
          const available = library.some((entry) => entry.id === job.docId);
          return <li key={job.id} className={`n-job${job.status === 'running' ? ' n-job-running' : ''}`}>
            <div className="n-job-heading"><div><h3>{job.title}</h3><p>{dateTime.format(job.startedAt)} · {job.mode === 'stream' ? 'Stream' : 'Full render'}</p></div><span className={`n-job-state n-job-state-${job.status}`}><Icon name={job.status === 'completed' ? 'check' : job.status === 'running' ? 'voice' : job.status === 'failed' ? 'close' : 'stop'} size={14} />{LABELS[job.status]}</span></div>
            <dl className="n-job-details"><div><dt>Narrator</dt><dd>{narrator}</dd></div><div><dt>Model</dt><dd>{model}</dd></div><div><dt>Speed</dt><dd>{job.speed}×</dd></div><div><dt>Sentences</dt><dd>{job.completedSentences.toLocaleString()} / {job.totalSentences.toLocaleString()}</dd></div>{job.finishedAt ? <div><dt>Finished</dt><dd>{dateTime.format(job.finishedAt)}</dd></div> : null}</dl>
            <div className="n-job-progress" role="progressbar" aria-label={`${job.title}: sentences generated`} aria-valuemin={0} aria-valuemax={job.totalSentences} aria-valuenow={job.completedSentences} aria-valuetext={`${percent}% · ${LABELS[job.status]}`}><span style={{ inlineSize: `${percent}%` }} /></div>
            {job.error ? <p className="n-job-error">{job.error}</p> : job.status === 'interrupted' ? <p className="n-job-note">The app closed before this attempt finished. Open the document to continue.</p> : null}
            <div className="n-job-foot"><span>{available ? `${percent}% generated` : 'Document removed from Library'}</span><div>{job.id === running?.id && cancel ? <button type="button" className="pill" onClick={cancel}><Icon name="stop" size={14} />Stop</button> : null}<button type="button" className="pill" disabled={!available} onClick={() => void open(job.docId)}><Icon name="page" size={14} />Open document</button></div></div>
          </li>;
        })}
      </ol>}
    </div>
  );
}
