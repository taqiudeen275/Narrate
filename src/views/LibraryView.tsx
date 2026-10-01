import { useRef, useState } from 'react';
import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';

const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.epub,.rtf,.html,.htm,.xhtml';
const addedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function LibraryView() {
  const { library, activeDocId, openBuffer, openLibraryDoc, removeDoc, setView, busy, status } = useNarrate();
  const [drag, setDrag] = useState(false);
  const [pasted, setPasted] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const takeFile = async (file: File) => {
    if (busy || opening) return;
    setOpening(file.name);
    setFileError(null);
    try {
      const buffer = await file.arrayBuffer();
      if (await openBuffer(file.name, buffer)) setView('player');
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not read that file. Try adding it again.');
    } finally { setOpening(null); }
  };

  const takeText = async () => {
    if (!pasted.trim() || busy || opening) return;
    setOpening('Pasted text');
    try {
      if (await openBuffer('Pasted text.md', new TextEncoder().encode(pasted).buffer as ArrayBuffer)) {
        setPasted('');
        setView('player');
      }
    } finally { setOpening(null); }
  };

  const openEntry = async (id: string) => {
    setOpening(id);
    try {
      await openLibraryDoc(id);
      if (useNarrate.getState().activeDocId === id) setView('player');
    } finally { setOpening(null); }
  };

  const filtered = library.filter((entry) => `${entry.title} ${entry.sourceName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));

  return (
    <div className="n-panel-view n-library">
      <header className="n-panel-head n-lib-head">
        <div>
          <h1 className="n-panel-title">Your Library</h1>
          <p className="n-panel-sub">Keep your documents and their audio together. Pick up where you left off.</p>
        </div>
        <button type="button" className="pill pill-primary" disabled={busy || !!opening} onClick={() => fileRef.current?.click()}><Icon name="plus" size={17} />Add a document</button>
      </header>

      <input ref={fileRef} type="file" className="sr-only" accept={ACCEPT} aria-label="Add a document"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void takeFile(file); }} />

      <section className={`n-lib-import${drag ? ' n-lib-import-drag' : ''}${opening ? ' n-lib-import-loading' : ''}`}
        onDragOver={(event) => { event.preventDefault(); if (!busy && !opening) setDrag(true); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrag(false); }}
        onDrop={(event) => { event.preventDefault(); setDrag(false); const file = event.dataTransfer.files?.[0]; if (file) void takeFile(file); }}
        aria-busy={!!opening}>
        <span className="n-lib-import-mark"><Icon name={opening ? 'voice' : 'file'} size={26} /></span>
        <div className="n-lib-import-copy">
          <h2>{opening ? 'Opening your document…' : drag ? 'Drop it here' : 'Bring something you want to hear'}</h2>
          <p>{opening ? status : 'Drop a file here. PDF, Word, Markdown, EPUB, RTF, HTML and plain text.'}</p>
          <p className="n-lib-private">Read and saved on this device.</p>
        </div>
        {opening ? <div className="n-loading-bars" aria-hidden="true">{Array.from({ length: 7 }, (_, index) => <i key={index} style={{ animationDelay: `${index * -0.12}s` }} />)}</div> : <button type="button" className="pill" aria-expanded={pasteOpen} onClick={() => setPasteOpen(!pasteOpen)}><Icon name="page" size={15} />Paste text</button>}
      </section>

      {pasteOpen ? <section className="n-paste n-lib-paste">
        <label htmlFor="library-pasted-text" className="n-lib-paste-label">Text to read aloud</label>
        <textarea id="library-pasted-text" className="n-textarea scroll" rows={5} placeholder="Paste an article, your notes, or a little Markdown…" value={pasted} onChange={(event) => setPasted(event.target.value)} />
        <div className="n-paste-foot"><span className="n-drop-sub">{pasted.trim() ? `${pasted.trim().split(/\s+/).length.toLocaleString()} words` : 'Headings and paragraphs are preserved.'}</span><button type="button" className="pill pill-primary" disabled={!pasted.trim() || busy || !!opening} onClick={() => void takeText()}><Icon name="plus" size={15} />Add text</button></div>
      </section> : null}
      {fileError ? <p className="n-error n-lib-fileerror" role="alert">{fileError}</p> : null}

      <div className="n-lib-shelf-head">
        <h2>{library.length ? `${library.length} ${library.length === 1 ? 'document' : 'documents'}` : 'Make yourself a Library'}</h2>
        {library.length ? <label className="n-searchwrap n-lib-search"><Icon name="search" size={17} /><input type="search" className="input" placeholder="Find a document" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search Library" /></label> : null}
      </div>

      {!library.length ? <div className="n-lib-empty"><Icon name="library" size={34} /><h3>One document is a good beginning.</h3><p>Add a file or paste some text. Your Library, saved audio, and listening place will be here when you come back.</p></div> : !filtered.length ? <div className="n-lib-empty"><h3>No documents match “{query}”.</h3><button type="button" className="pill" onClick={() => setQuery('')}>Clear search</button></div> : <div className="n-libgrid">
        {filtered.map((entry) => {
          const active = entry.id === activeDocId;
          const progress = Math.min(100, Math.round(entry.renderedCount / Math.max(1, entry.totalSentences) * 100));
          const format = entry.sourceName.split('.').at(-1)?.toUpperCase() ?? 'TEXT';
          return <article key={entry.id} className={`n-libcard${active ? ' n-libcard-on' : ''}`}>
            <button type="button" className="n-libcard-open" disabled={busy || !!opening} onClick={() => void openEntry(entry.id)} aria-label={`Open ${entry.title}`}>
              <span className="n-libcard-top"><span className="n-libcard-file"><Icon name="file" size={21} /></span><span className="n-libcard-format">{format.length < 8 ? format : 'TEXT'}</span>{active ? <span className="n-libcard-current">Open</span> : null}</span>
              <h3 className="n-libcard-title">{entry.title}</h3>
              <span className="n-libcard-source">{entry.sourceName}</span>
              <span className="n-libcard-meta">{entry.wordCount.toLocaleString()} words · about {Math.max(1, entry.minutes)} min</span>
              <span className={`n-libcard-audio${entry.audioReady ? ' n-libcard-audio-ready' : ''}`}><Icon name={entry.audioReady ? 'check' : entry.renderedCount > 0 ? 'voice' : 'page'} size={14} />{entry.audioReady ? 'Audio saved · ready to listen' : entry.renderedCount > 0 ? `${progress}% audio saved` : 'Ready to narrate'}</span>
              {entry.renderedCount > 0 ? <span className="n-libcard-progress" aria-hidden="true"><span style={{ inlineSize: `${progress}%` }} /></span> : null}
            </button>
            <footer className="n-libcard-foot"><span>Added {addedDate.format(entry.addedAt)}</span><button type="button" className="n-libcard-remove" disabled={busy || !!opening} onClick={() => setRemoveId(removeId === entry.id ? null : entry.id)} aria-label={`Remove ${entry.title} from Library`}><Icon name="trash" size={15} /></button></footer>
            {removeId === entry.id ? <div className="n-libcard-confirm"><p>Remove this document and its saved audio?</p><div><button type="button" className="pill" onClick={() => setRemoveId(null)}>Keep</button><button type="button" className="pill pill-primary" onClick={() => { void removeDoc(entry.id); setRemoveId(null); }}>Remove</button></div></div> : null}
          </article>;
        })}
      </div>}
    </div>
  );
}
