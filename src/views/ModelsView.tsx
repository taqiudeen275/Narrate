import { useEffect, useReducer, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';
import { MODEL_VARIANTS, installModel, modelInstall, pauseModelDownload, refreshModelInstalls, subscribeModelDownloads } from '../core/tts/downloads';
import { deviceHints, deviceMeasurements, loadDeviceMeasurements, modelDownloadWarning, recommendModel, subscribeDeviceMeasurements } from '../core/tts/device';

const sizes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export function ModelsView() {
  const { selectedModel, selectModel, engineReady, engineLoading, busy, ensureEngine, engine,
    backendPreference, setBackendPreference } = useNarrate(useShallow((state) => ({
    selectedModel: state.selectedModel, selectModel: state.selectModel, engineReady: state.engineReady,
    engineLoading: state.engineLoading, busy: state.busy, ensureEngine: state.ensureEngine, engine: state.engine,
    backendPreference: state.backendPreference, setBackendPreference: state.setBackendPreference,
  })));
  const runtime = engineReady ? engine.runtime : null;
  const [, refresh] = useReducer((value) => value + 1, 0);
  const [warningId, setWarningId] = useState<string | null>(null);
  const accepted = useRef(new Set<string>());
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
  const requestDownload = (id: string) => {
    if (!accepted.current.has(id) && modelDownloadWarning(id, hints, deviceMeasurements())) setWarningId(id);
    else download(id);
  };
  return <div className="n-panel-view n-models">
    <header className="n-panel-head"><div><h2 className="n-panel-title">Voice models</h2><p className="n-panel-sub">Download once, then generate on this device. Downloads can run together and resume saved progress.</p></div></header>
    <section className="n-device-advice" aria-label="Device recommendation">
      <h3>{hints.mobile ? 'Recommended for this phone' : 'Recommended for this device'}</h3>
      <p className="n-device-recommended">{recommended.name}</p><p>{recommendation.reason}</p>
      <div className="n-device-facts">{hints.memoryGB !== null ? <span>About {hints.memoryGB} GB reported memory</span> : null}{hints.cores ? <span>{hints.cores} reported CPU threads</span> : null}<span>{recommendation.measured ? 'Measured on this device' : 'Starting recommendation'}</span></div>
      {recommendation.realtimeFactor !== null ? <p className="n-device-speed">Once the model is loaded, 10 minutes of audio takes about {Math.max(1, Math.round(10 * recommendation.realtimeFactor))} minutes to generate at normal pace. {recommendation.mode === 'full' ? 'Render all first for uninterrupted listening.' : 'Streaming should keep up at normal pace.'} Temperature and other apps can change speed.</p> : <p className="n-device-speed">Generate a few sentences at 1× pace to measure this device. Memory and CPU reports are approximate; temperature and other apps can change speed.</p>}
    </section>
    <section className="n-model-runtime" aria-label="Generation execution">
      <h3>Generation</h3>
      <div className="n-segment" role="group" aria-label="Generation execution mode">
        <button type="button" className={`n-segbtn${backendPreference === 'auto' ? ' n-segbtn-on' : ''}`}
          aria-pressed={backendPreference === 'auto'} disabled={busy || engineLoading}
          onClick={() => void setBackendPreference('auto')}>Automatic</button>
        <button type="button" className={`n-segbtn${backendPreference === 'wasm' ? ' n-segbtn-on' : ''}`}
          aria-pressed={backendPreference === 'wasm'} disabled={busy || engineLoading}
          onClick={() => void setBackendPreference('wasm')}>CPU compatibility</button>
      </div>
      <p>Automatic uses GPU for Full precision when available. If audio is distorted, try CPU compatibility, then open the document and choose Audio recovery → Regenerate audio. This keeps your chosen edition; CPU generation may take longer.</p>
    </section>
    <details className="n-model-performance">
      <summary>Generation performance</summary>
      <p>Selected model: {engine.name}</p>
      {runtime ? <><p>{runtime.backend === 'webgpu' ? 'WebGPU with CPU fallback' : `CPU · ${runtime.wasmThreads} ${runtime.wasmThreads === 1 ? 'thread' : 'threads'}`}</p><p>{runtime.reason}</p>
        {runtime.backend === 'wasm' && runtime.wasmThreads === 1 ? <p>This app environment currently permits one inference thread. Render all can prepare saved audio before listening.</p> : null}</> : <p>Load your selected model to see how generation runs on this device.</p>}
    </details>
    <div className="n-model-catalog-head"><h3>All voice models</h3><p>All {MODEL_VARIANTS.length} editions are available. Choose the recommended model or try another.</p></div>
    <div className="n-model-list">
      {MODEL_VARIANTS.map(model => {
        const install = modelInstall(model.cacheId);
        const downloading = install.status === 'downloading' || install.status === 'queued';
        const installed = install.status === 'installed';
        const selected = selectedModel === model.cacheId;
        const percent = Math.min(100, Math.round(install.loaded / Math.max(1, install.total) * 100));
        const warning = warningId === model.cacheId ? modelDownloadWarning(model.cacheId, hints, deviceMeasurements()) : null;
        return <article className={`n-model-card${selected ? ' n-model-card-selected' : ''}`} key={model.cacheId}>
          <div className="n-model-top"><div><h3>{model.name}{model.cacheId === recommendation.modelId ? <span className="n-recommended-tag">Recommended</span> : null}</h3><p>{sizes(model.sizeBytes)} weights · English · Apache 2.0</p></div><span className="n-model-status">{downloading ? `${percent}%` : installed ? 'Saved offline' : install.status === 'paused' ? 'Paused' : 'Download needed'}</span></div>
          <p className="n-model-description">{model.description}</p>
          {install.loaded > 0 || downloading ? <><div className="n-job-progress" role="progressbar" aria-label={`${model.name} download`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><span style={{ inlineSize: `${percent}%` }} /></div><p className="n-model-transfer">{sizes(install.loaded)} / {sizes(install.total)} including narrators{install.file ? ` · ${install.file.split('/').at(-1)}` : ''}</p></> : null}
          {install.error ? <p className="n-job-error">{install.error}</p> : null}
          <div className="n-model-actions">
            {downloading ? <button type="button" className="pill" onClick={() => pauseModelDownload(model.cacheId)}><Icon name="pause" size={15} />Pause download</button> : !installed ? <button type="button" className="pill pill-primary" aria-expanded={warningId === model.cacheId} aria-controls={warningId === model.cacheId ? `model-warning-${model.cacheId}` : undefined} onClick={() => requestDownload(model.cacheId)}><Icon name="download" size={15} />{install.loaded ? 'Resume download' : 'Download'}</button> : null}
            <button type="button" className={`pill${selected ? ' pill-primary' : ''}`} disabled={!installed || busy || engineLoading || selected} onClick={() => void selectModel(model.cacheId)}><Icon name={selected ? 'check' : 'voice'} size={15} />{selected ? 'Selected' : 'Use this model'}</button>
            {selected && installed && !engineReady ? <button type="button" className="pill" disabled={engineLoading || busy} onClick={() => void ensureEngine()}>{engineLoading ? 'Loading…' : 'Load model'}</button> : null}
          </div>
          {warning ? <section className="n-model-warning" id={`model-warning-${model.cacheId}`} role="alert">
            <h4>{warning.title}</h4><p>{warning.reason}</p>
            <div className="n-model-actions"><button type="button" className="pill" onClick={() => setWarningId(null)}>Cancel</button><button type="button" className="pill pill-primary" onClick={() => { accepted.current.add(model.cacheId); setWarningId(null); download(model.cacheId); }}><Icon name="download" size={15} />Download anyway</button></div>
          </section> : null}
        </article>;
      })}
    </div>
    <p className="n-model-note">All three Kokoro editions share the same 28 narrators. Precision changes the model weights, storage and generation performance. Piper, Pocket TTS and the other engines from the earlier catalog are planned integrations; their audio engines are not implemented in this build.</p>
  </div>;
}
