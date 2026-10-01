import { useEffect, useRef, useState } from 'react';
import { useNarrate, readHash, type MainView } from './state/store';
import { Transport } from './components/Transport';
import { VoiceSheet } from './components/VoiceSheet';
import { PlayerView } from './views/PlayerView';
import { ReaderView } from './views/ReaderView';
import { VoicePicker } from './views/VoicePicker';
import { VoiceLab } from './views/VoiceLab';
import { LibraryView } from './views/LibraryView';
import { SettingsView } from './views/SettingsView';
import { Icon, type IconName } from './design/Icon';
import './styles/base.css';
import './design/app.css';
import './design/sheet.css';
import './design/library.css';
import './design/settings.css';

const SIDEBAR: { view: MainView; icon: IconName; label: string }[] = [
  { view: 'library', icon: 'library', label: 'Library' },
  { view: 'voices', icon: 'voice', label: 'Narrators' },
  { view: 'lab', icon: 'mic', label: 'Voice lab' },
  { view: 'settings', icon: 'settings', label: 'Settings' },
];

function sectionView(view: MainView): MainView {
  return view === 'models' || view === 'work' ? 'settings' : view;
}

function NavItems({ view, setView }: { view: MainView; setView: (v: MainView) => void }) {
  return (
    <nav className="n-nav" aria-label="Sections">
      {SIDEBAR.map((item) => (
        <button key={item.view} type="button"
          className={`n-navbtn${sectionView(view) === item.view ? ' n-navbtn-on' : ''}`}
          onClick={() => setView(item.view)}
          aria-current={sectionView(view) === item.view ? 'page' : undefined}>
          <span className="n-navicon"><Icon name={item.icon} size={18} /></span>
          <span className="n-navlabel">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function MobileNav({ view, setView, hasDoc }: { view: MainView; setView: (v: MainView) => void; hasDoc: boolean }) {
  const items = [SIDEBAR[0], SIDEBAR[1], { view: 'player' as MainView, icon: 'play' as IconName, label: 'Listen' }, SIDEBAR[2], SIDEBAR[3]];
  return (
    <nav className="n-bottomnav glass-strong" aria-label="Sections">
      {items.map((item) => {
        const center = item.view === 'player';
        const active = center ? view === 'player' || view === 'reader' : sectionView(view) === item.view;
        return (
          <button key={item.view} type="button"
            className={`n-mobile-navbtn${center ? ' n-mobile-navbtn-center' : ''}${active ? ' n-mobile-navbtn-on' : ''}`}
            disabled={center && !hasDoc}
            aria-label={center && !hasDoc ? 'Listen — open a document from Library first' : item.label}
            title={center && !hasDoc ? 'Open a document from Library first' : item.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => setView(item.view)}>
            <span className="n-mobile-navicon"><Icon name={item.icon} size={center ? 22 : 18} /></span>
            <span className="n-mobile-navlabel">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const { doc, view, setView, hydrate, hydrated, busy, status, error, clearError,
    generateMode, setGenerateMode } = useNarrate();
  const started = useRef(false);
  const [sheet, setSheet] = useState(false);
  const documentView = !!doc && (view === 'player' || view === 'reader');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void hydrate().then(() => {
      const hash = readHash();
      if (hash.readerMode) useNarrate.getState().setReaderMode(hash.readerMode);
      if (hash.view && hash.view !== 'player' && hash.view !== 'reader') setView(hash.view);
      else setView('library');
    });
  }, [hydrate, setView]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, button, [role="slider"], [contenteditable="true"]')) return;
      const state = useNarrate.getState();
      if (!state.doc || (state.view !== 'player' && state.view !== 'reader')) return;
      if (event.code === 'Space') { event.preventDefault(); void state.toggle(); }
      else if (event.key === 'ArrowRight' && !event.shiftKey) { event.preventDefault(); void state.stepSentence(1); }
      else if (event.key === 'ArrowLeft' && !event.shiftKey) { event.preventDefault(); void state.stepSentence(-1); }
      else if (event.key === 'ArrowRight' && event.shiftKey) { event.preventDefault(); void state.stepParagraph(1); }
      else if (event.key === 'ArrowLeft' && event.shiftKey) { event.preventDefault(); void state.stepParagraph(-1); }
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
        <NavItems view={view} setView={setView} />
        {doc ? <button type="button" className={`n-rail-document${documentView ? ' n-rail-document-on' : ''}`}
          onClick={() => setView('player')} title={doc.title}>
          <Icon name="play" size={16} />
          <span><span className="n-rail-document-caption">Open document</span><span className="n-rail-document-title">{doc.title}</span></span>
        </button> : null}
        <div className="n-rail-foot"><span className="n-local">Local only</span></div>
      </aside>

      <main className="n-main">
        <header className={`n-topbar${documentView ? '' : ' n-topbar-section'}`}>
          <div className="n-topbar-doc">
            {documentView ? <>
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => setView('library')} aria-label="Back to Library"><Icon name="library" size={16} /></button>
              <span className="n-topbar-title">{doc.title}</span>
              <span className="n-topbar-meta">{doc.words.length.toLocaleString()} words</span>
            </> : <span className="n-topbar-welcome">A little space to listen.</span>}
          </div>
          {documentView ? <div className="n-topbar-right">
            <div className="n-segment" role="group" aria-label="Document view">
              <button type="button" className={`n-segbtn${view === 'player' ? ' n-segbtn-on' : ''}`} onClick={() => setView('player')} aria-pressed={view === 'player'}><Icon name="play" size={13} />Listen</button>
              <button type="button" className={`n-segbtn${view === 'reader' ? ' n-segbtn-on' : ''}`} onClick={() => setView('reader')} aria-pressed={view === 'reader'}><Icon name="page" size={13} />Read</button>
            </div>
            <div className="n-segment n-generation-mode" role="group" aria-label="Generation mode">
              <button type="button" className={`n-segbtn${generateMode === 'stream' ? ' n-segbtn-on' : ''}`} onClick={() => setGenerateMode('stream')} disabled={busy} aria-pressed={generateMode === 'stream'} title="Generate audio as you listen">Stream</button>
              <button type="button" className={`n-segbtn${generateMode === 'full' ? ' n-segbtn-on' : ''}`} onClick={() => setGenerateMode('full')} disabled={busy} aria-pressed={generateMode === 'full'} title="Generate the whole document for listening and export">Render all</button>
            </div>
          </div> : busy ? <span className="n-status" role="status">{status}</span> : <span className="n-topbar-local">On your device</span>}
        </header>

        <div className="n-stage">
          {!hydrated ? <div className="n-startup" role="status" aria-busy="true"><div className="n-loading-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -0.12}s` }} />)}</div><p>Opening your Library…</p></div> : <>
            {documentView && view === 'player' ? <PlayerView onPickVoice={() => setSheet(true)} /> : null}
            {documentView && view === 'reader' ? <ReaderView /> : null}
            {view === 'library' || (!doc && (view === 'player' || view === 'reader')) ? <LibraryView /> : null}
            {view === 'voices' ? <VoicePicker onPickVoice={() => setSheet(true)} /> : null}
            {view === 'lab' ? <VoiceLab /> : null}
            {view === 'settings' || view === 'models' || view === 'work' ? <SettingsView initialTab={view === 'work' ? 'work' : 'models'} /> : null}
          </>}
        </div>
        {documentView ? <Transport onPickVoice={() => setSheet(true)} /> : null}
      </main>
      {sheet ? <VoiceSheet onClose={() => setSheet(false)} /> : null}
      <MobileNav view={view} setView={setView} hasDoc={!!doc} />
      {error ? <div className="n-toast" role="alert"><span>{error}</span><button type="button" className="n-toast-x" onClick={clearError} aria-label="Dismiss"><Icon name="close" size={15} /></button></div> : null}
    </div>
  );
}
