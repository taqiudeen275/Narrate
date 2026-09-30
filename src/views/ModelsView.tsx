import { useState } from 'react';
import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';

type Status = 'ready' | 'needs-native' | 'planned';

interface ModelEntry {
  id: string;
  name: string;
  family: string;
  size: string;
  license: string;
  licenseNote?: string;
  languages: string;
  /** Measured or reported CPU real-time factor where known. */
  speed: string;
  clones: boolean;
  status: Status;
  why: string;
}

/**
 * The catalogue.
 *
 * `status` is the honest bit. A model that cannot be installed today says so,
 * and says why, rather than sitting behind a button that does nothing. The
 * 'needs-native' models all work — they are waiting on the sherpa-onnx native
 * build, which needs a C++ toolchain this machine does not have installed.
 */
const MODELS: ModelEntry[] = [
  {
    id: 'kokoro',
    name: 'Kokoro 82M',
    family: 'Kokoro',
    size: '86 MB (int8)',
    license: 'Apache 2.0',
    languages: '8–9',
    speed: '~1.5× real-time on 4 cores',
    clones: false,
    status: 'ready',
    why: 'The quality ceiling for anything this size. Preinstalled and used by default.',
  },
  {
    id: 'piper',
    name: 'Piper',
    family: 'VITS',
    size: '22 MB (int8) – 110 MB',
    license: 'GPL 3.0',
    licenseNote: 'eSpeak-NG is statically linked. Relevant if you ever redistribute.',
    languages: '30+',
    speed: '~10× real-time on a phone CPU',
    clones: false,
    status: 'needs-native',
    why: 'Fastest open TTS measured. The broadest language coverage. 100+ fixed voices.',
  },
  {
    id: 'kitten',
    name: 'KittenTTS',
    family: 'KittenTTS',
    size: '19 MB (nano int8)',
    license: 'Apache 2.0',
    languages: '1',
    speed: 'Real-time on desktop CPU',
    clones: false,
    status: 'needs-native',
    why: 'The size floor. For iPhones and low-end hardware where Kokoro will not fit.',
  },
  {
    id: 'matcha',
    name: 'Matcha-TTS',
    family: 'Matcha',
    size: '71 MB',
    license: 'MIT',
    languages: '2',
    speed: '~6× real-time on a Raspberry Pi 4',
    clones: false,
    status: 'needs-native',
    why: 'Fastest neural TTS ever measured. One voice, but the architecture many better models are built on.',
  },
  {
    id: 'supertonic',
    name: 'Supertonic 3',
    family: 'Supertonic',
    size: '102 MB (int8)',
    license: 'OpenRAIL-M',
    languages: '31',
    speed: '~3× real-time on a flagship phone',
    clones: false,
    status: 'needs-native',
    why: '31 languages, 44.1 kHz, no phonemiser dependency. Known to drop words on very short inputs.',
  },
  {
    id: 'melotts',
    name: 'MeloTTS',
    family: 'MeloTTS',
    size: '163 MB',
    license: 'MIT',
    languages: '6 (incl. CJK)',
    speed: '~1.7× real-time on a flagship phone',
    clones: false,
    status: 'needs-native',
    why: 'The proven Mandarin choice on mobile, with its own pinyin phonemiser.',
  },
  {
    id: 'pocket',
    name: 'Pocket TTS',
    family: 'Kyutai',
    size: '73 MB (int4 GGUF)',
    license: 'MIT',
    languages: '6',
    speed: '~6× real-time on 2 CPU cores',
    clones: true,
    status: 'planned',
    why: 'The only voice cloning that also runs on a CPU. Needed for the Voice Lab to do real work.',
  },
];

const STATUS_COPY: Record<Status, { label: string; tone: string; detail: string }> = {
  ready: {
    label: 'Installed',
    tone: 'ok',
    detail: 'Working now.',
  },
  'needs-native': {
    label: 'Waiting on native build',
    tone: 'wait',
    detail:
      'This model works, but installing it needs the sherpa-onnx native library, which needs a C++ toolchain (Visual Studio Build Tools + CMake) that is not installed on this machine yet.',
  },
  planned: {
    label: 'Planned',
    tone: 'wait',
    detail: 'Scheduled after the native build.',
  },
};

export function ModelsView() {
  const { modelProgress, engineReady, engineLoading, ensureEngine, setView, busy } = useNarrate();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="n-panel-view">
      <header className="n-panel-head">
        <div>
          <div className="label">Models</div>
          <h1 className="heading n-panel-title">Voice engines</h1>
          <p className="n-panel-sub">
            Every model runs on your machine. Nothing is uploaded, and a model you have
            not installed cannot send your document anywhere.
          </p>
        </div>
        <button type="button" className="pill" onClick={() => setView('player')}>Done</button>
      </header>

      <div className="n-engine-card">
        <div className="n-engine-row">
          <Icon name="models" size={20} />
          <div>
            <div className="n-engine-name">Kokoro 82M</div>
            <div className="n-engine-sub">
              {engineLoading
                ? 'Downloading weights…'
                : engineReady
                  ? 'Resident and ready.'
                  : 'Downloaded on first use, then cached locally.'}
            </div>
          </div>
          <div className="n-engine-state">
            {engineReady ? (
              <span className="n-badge n-badge-ok">Ready</span>
            ) : engineLoading ? (
              <span className="n-badge n-badge-wait">
                {modelProgress?.fraction != null
                  ? `${Math.round(modelProgress.fraction * 100)}%`
                  : 'Loading'}
              </span>
            ) : (
              <button type="button" className="pill pill-primary" onClick={() => void ensureEngine()}>
                Download now
              </button>
            )}
          </div>
        </div>
        {engineLoading && modelProgress?.fraction != null ? (
          <div className="n-progress">
            <div className="n-progress-fill" style={{ inlineSize: `${modelProgress.fraction * 100}%` }} />
          </div>
        ) : null}
        {modelProgress && !engineReady ? (
          <div className="n-progress-note mono">{modelProgress.file}</div>
        ) : null}
      </div>

      <div className="n-modelgrid">
        {MODELS.map((m) => {
          const s = STATUS_COPY[m.status];
          const expanded = open === m.id;
          return (
            <article key={m.id} className="n-mcard">
              <div className="n-mcard-top">
                <div>
                  <div className="n-mcard-name">{m.name}</div>
                  <div className="n-mcard-family label">{m.family}</div>
                </div>
                <span className={`n-badge n-badge-${s.tone}`}>{s.label}</span>
              </div>

              <p className="n-mcard-why">{m.why}</p>

              <dl className="n-mcard-specs">
                <div><dt>Size</dt><dd className="mono">{m.size}</dd></div>
                <div><dt>License</dt><dd className="mono">{m.license}</dd></div>
                <div><dt>Languages</dt><dd className="mono">{m.languages}</dd></div>
                <div><dt>Cloning</dt><dd className="mono">{m.clones ? 'Yes' : 'No'}</dd></div>
              </dl>

              <div className="n-mcard-speed">
                <span className="label">CPU speed</span>
                <span>{m.speed}</span>
              </div>

              {m.licenseNote ? <p className="n-mcard-note">{m.licenseNote}</p> : null}

              <div className="n-mcard-foot">
                {m.status === 'ready' ? (
                  <span className="n-mcard-ok">In use</span>
                ) : (
                  <button
                    type="button"
                    className="pill"
                    disabled={busy}
                    onClick={() => setOpen(expanded ? null : m.id)}
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide' : 'Why not yet?'}
                  </button>
                )}
              </div>

              {expanded && m.status !== 'ready' ? (
                <p className="n-mcard-detail">{s.detail}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
