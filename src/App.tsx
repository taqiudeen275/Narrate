import { useEffect, useRef } from 'react';
import { useNarrate, readHash } from './state/store';
import { Transport } from './components/Transport';
import { PlayerView } from './views/PlayerView';
import { ReaderView } from './views/ReaderView';
import { VoicePicker } from './views/VoicePicker';
import { ModelsView } from './views/ModelsView';
import { VoiceLab } from './views/VoiceLab';
import { Icon, type IconName } from './design/Icon';
import './styles/base.css';
import './design/app.css';

type View = 'player' | 'reader' | 'voices' | 'lab' | 'models';

const NAV: { view: View; icon: IconName; label: string }[] = [
  { view: 'player', icon: 'play', label: 'Listen' },
  { view: 'reader', icon: 'page', label: 'Read' },
  { view: 'voices', icon: 'voice', label: 'Narrators' },
  { view: 'lab', icon: 'mic', label: 'Voice lab' },
  { view: 'models', icon: 'models', label: 'Models' },
];

function NavItems({ view, setView, className }: {
  view: View;
  setView: (v: View) => void;
  className?: string;
}) {
  return (
    <nav className={className} aria-label="Sections">
      {NAV.map((n) => (
        <button
          key={n.view}
          type="button"
          className={`n-navbtn${view === n.view ? ' n-navbtn-on' : ''}`}
          onClick={() => setView(n.view)}
          aria-current={view === n.view ? 'page' : undefined}
          title={n.label}
        >
          <span className="n-navicon">
            <Icon name={n.icon} size={18} />
          </span>
          <span className="n-navlabel">{n.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default function App() {
  const {
    doc, view, setView, openSample, busy, status, error, clearError,
    generateMode, setGenerateMode,
  } = useNarrate();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const h = readHash();
    if (h.view) setView(h.view);
    if (h.readerMode) useNarrate.getState().setReaderMode(h.readerMode);
    openSample();
  }, [openSample, setView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const s = useNarrate.getState();
      if (e.code === 'Space') { e.preventDefault(); void s.toggle(); }
      else if (e.key === 'ArrowRight' && !e.shiftKey) { e.preventDefault(); void s.stepSentence(1); }
      else if (e.key === 'ArrowLeft' && !e.shiftKey) { e.preventDefault(); void s.stepSentence(-1); }
      else if (e.key === 'ArrowRight' && e.shiftKey) { e.preventDefault(); void s.stepParagraph(1); }
      else if (e.key === 'ArrowLeft' && e.shiftKey) { e.preventDefault(); void s.stepParagraph(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="n-app">
      <aside className="n-rail">
        <div className="n-brand">
          <span className="n-brand-mark"><Icon name="voice" size={15} strokeWidth={1.9} /></span>
          <span className="n-brand-name">Narrate</span>
        </div>

        <NavItems view={view as View} setView={setView} className="n-nav" />

        <div className="n-rail-foot">
          <span className="n-local">Local only</span>
        </div>
      </aside>

      <main className="n-main">
        <header className="n-topbar">
          <div className="n-topbar-doc">
            {doc ? (
              <>
                <span className="n-topbar-title">{doc.title}</span>
                <span className="n-topbar-meta mono">
                  {doc.words.length.toLocaleString()} words
                </span>
              </>
            ) : (
              <span className="n-topbar-title n-topbar-empty">No document</span>
            )}
          </div>

          <div className="n-topbar-right">
            <div className="n-segment" role="group" aria-label="Generation mode">
              <button
                type="button"
                className={`n-segbtn${generateMode === 'stream' ? ' n-segbtn-on' : ''}`}
                onClick={() => setGenerateMode('stream')}
                title="Start playing after a couple of sentences and keep rendering ahead of the playhead"
              >
                Stream
              </button>
              <button
                type="button"
                className={`n-segbtn${generateMode === 'full' ? ' n-segbtn-on' : ''}`}
                onClick={() => setGenerateMode('full')}
                title="Render the whole document first, so it can be exported"
              >
                Render all
              </button>
            </div>
            <span className="n-status mono">{busy ? status : ''}</span>
          </div>
        </header>

        <div className="n-stage">
          {view === 'player' ? <PlayerView /> : null}
          {view === 'reader' ? <ReaderView /> : null}
          {view === 'voices' ? <VoicePicker /> : null}
          {view === 'lab' ? <VoiceLab /> : null}
          {view === 'models' ? <ModelsView /> : null}
        </div>

        {view === 'player' || view === 'reader' ? <Transport /> : null}
      </main>

      {/* The reference's floating bottom pill, for narrow screens. */}
      <NavItems view={view as View} setView={setView} className="n-bottomnav glass-strong" />

      {error ? (
        <div className="n-toast" role="alert">
          <span>{error}</span>
          <button type="button" className="n-toast-x" onClick={clearError} aria-label="Dismiss">
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
