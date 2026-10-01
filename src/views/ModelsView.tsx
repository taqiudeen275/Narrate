import { useEffect, useReducer } from 'react';
import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';
import { MODEL_VARIANTS, installModel, modelInstall, pauseModelDownload, refreshModelInstalls, subscribeModelDownloads } from '../core/tts/downloads';
import { deviceHints, deviceMeasurements, loadDeviceMeasurements, recommendModel, subscribeDeviceMeasurements } from '../core/tts/device';

const sizes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function ModelsView() {
  const { selectedModel, selectModel, engineReady, engineLoading, busy, ensureEngine } = useNarrate();
  const [, refresh] = useReducer((value) => value + 1, 0);
  const hints = deviceHints();
  const recommendation = recommendModel(hints, deviceMeasurements());
  const recommended = MODEL_VARIANTS.find(model => model.cacheId === recommendation.modelId)!;
  useEffect(() => {
    const stop = subscribeModelDownloads(refresh);
    const stopMeasurements = subscribeDeviceMeasurements(refresh);
    void refreshModelInstalls().catch(error => useNarrate.setState({ error: String(error) }));
    void loadDeviceMeasurements().catch(() => undefined);
    return () => { stop(); stopMeasurements(); };
  }, []);
  const download = (id: string) => void installModel(id).catch(error => {
    if (!(error instanceof Error && error.name === 'AbortError')) useNarrate.setState({ error: String(error) });
  });
  return <div className="n-panel-view n-models">
    <header className="n-panel-head"><div><h2 className="n-panel-title">Voice models</h2><p className="n-panel-sub">Download once, then generate on this device. Downloads can run together and resume saved progress.</p></div></header>
    <section className="n-device-advice" aria-label="Device recommendation">
      <div className="label">{hints.mobile ? 'Recommended for this phone' : 'Recommended for this device'}</div>
      <h3>{recommended.name}</h3><p>{recommendation.reason}</p>
      <div className="n-device-facts">{hints.memoryGB !== null ? <span>About {hints.memoryGB} GB reported memory</span> : null}{hints.cores ? <span>{hints.cores} reported CPU threads</span> : null}<span>{recommendation.measured ? 'Measured on this device' : 'Starting recommendation'}</span></div>
      {recommendation.realtimeFactor !== null ? <p className="n-device-speed">Once the model is loaded, 10 minutes of audio takes about {Math.max(1, Math.round(10 * recommendation.realtimeFactor))} minutes to generate at normal pace. {recommendation.mode === 'full' ? 'Render all first for uninterrupted listening.' : 'Streaming should keep up at normal pace.'} Temperature and other apps can change speed.</p> : <p className="n-device-speed">Generate a few sentences at 1× pace to measure this device. Memory and CPU reports are approximate; temperature and other apps can change speed.</p>}
    </section>
    <div className="n-model-list">
      {MODEL_VARIANTS.map(model => {
        const install = modelInstall(model.cacheId);
        const downloading = install.status === 'downloading' || install.status === 'queued';
        const installed = install.status === 'installed';
        const selected = selectedModel === model.cacheId;
        const percent = Math.min(100, Math.round(install.loaded / Math.max(1, install.total) * 100));
        return <article className={`n-model-card${selected ? ' n-model-card-selected' : ''}`} key={model.cacheId}>
          <div className="n-model-top"><div><h3>{model.name}{model.cacheId === recommendation.modelId ? <span className="n-recommended-tag">Recommended</span> : null}</h3><p>{sizes(model.sizeBytes)} weights · English · Apache 2.0</p></div><span className="n-model-status">{downloading ? `${percent}%` : installed ? 'Saved offline' : install.status === 'paused' ? 'Paused' : 'Download needed'}</span></div>
          <p className="n-model-description">{model.description}</p>
          {install.loaded > 0 || downloading ? <><div className="n-job-progress" role="progressbar" aria-label={`${model.name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ inlineSize: `${percent}%` }} /></div><p className="n-model-transfer">{sizes(install.loaded)} / {sizes(install.total)} including narrators{install.file ? ` · ${install.file.split('/').at(-1)}` : ''}</p></> : null}
          {install.error ? <p className="n-job-error">{install.error}</p> : null}
          <div className="n-model-actions">
            {downloading ? <button type="button" className="pill" onClick={() => pauseModelDownload(model.cacheId)}><Icon name="pause" size={15} />Pause download</button> : !installed ? <button type="button" className="pill pill-primary" onClick={() => download(model.cacheId)}><Icon name="download" size={15} />{install.loaded ? 'Resume download' : 'Download'}</button> : null}
            <button type="button" className={`pill${selected ? ' pill-primary' : ''}`} disabled={!installed || busy || engineLoading || selected} onClick={() => void selectModel(model.cacheId)}><Icon name={selected ? 'check' : 'voice'} size={15} />{selected ? 'Selected' : 'Use this model'}</button>
            {selected && installed && !engineReady ? <button type="button" className="pill" disabled={engineLoading || busy} onClick={() => void ensureEngine()}>{engineLoading ? 'Loading…' : 'Load model'}</button> : null}
          </div>
        </article>;
      })}
    </div>
    <p className="n-model-note">These are three editions of Kokoro, with 28 supported narrators. Piper and voice cloning need an additional inference engine and are not available in this build.</p>
  </div>;
}
