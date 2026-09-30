import { useRef, useState } from 'react';
import { useNarrate, type GenerateMode } from '../state/store';
import { Icon } from '../design/Icon';
import { Waveform } from '../design/Waveform';

const ACCEPT = '.md,.markdown,.txt,.pdf,.docx,.epub,.rtf,.html,.htm,.xhtml';

/**
 * The library.
 *
 * Two ways in — upload a file, or paste text straight in — and a deliberate
 * choice on open between streaming and rendering everything, because that
 * decision belongs to the reader and not to the app. Streaming starts playing
 * almost immediately; Render all is what export requires.
 */
export function LibraryView() {
  const { library, doc, openBuffer, openSample, generate, setView, status, busy } = useNarrate();
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [pasted, setPasted] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const take = (name: string, buf: ArrayBuffer) => {
    void openBuffer(name, buf).then(() => {
      // Once parsed, offer the two ways to play it rather than starting one.
      setPending({ name, text: '' });
    });
  };

  const takeText = (name: string, text: string) => {
    if (!text.trim()) return;
    void openBuffer(name, new TextEncoder().encode(text).buffer as ArrayBuffer).then(() => {
      setPending({ name, text: '' });
    });
  };

  const start = (mode: GenerateMode) => {
    setPending(null);
    setView('player');
    void generate(mode);
  };

  return (
    <div className="n-panel-view">
      <header className="n-panel-head">
        <div>
          <div className="label">Library</div>
          <h1 className="n-panel-title">Your documents</h1>
          <p className="n-panel-sub">
            Nothing is uploaded. Files are read on this machine and the text never leaves it.
          </p>
        </div>
      </header>

      <div className="n-lib-inputs">
        {/* Upload */}
        <label
          className={`n-dropzone${drag ? ' n-dropzone-drag' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) take(f.name, f.arrayBuffer() as unknown as ArrayBuffer);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) take(f.name, f.arrayBuffer() as unknown as ArrayBuffer);
              e.target.value = '';
            }}
          />
          <Icon name="file" size={26} />
          <span className="n-drop-title">Drop a file, or click to browse</span>
          <span className="n-drop-sub">
            Markdown, PDF, DOCX, EPUB, RTF, HTML and plain text. Legacy .doc and .pages
            have no client-side parser and are refused with an explanation.
          </span>
        </label>

        {/* Paste */}
        <div className="n-paste">
          <div className="label">Or paste text</div>
          <textarea
            className="n-textarea scroll"
            rows={7}
            placeholder="Paste anything you want read aloud. Markdown is understood, so headings and lists carry through."
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            aria-label="Paste text to read aloud"
          />
          <div className="n-paste-foot">
            <span className="n-drop-sub">
              {pasted.trim() ? `${pasted.trim().split(/\s+/).length} words` : 'Empty'}
            </span>
            <button
              type="button"
              className="pill pill-primary"
              disabled={!pasted.trim() || busy}
              onClick={() => takeText('Pasted text', pasted)}
            >
              <Icon name="voice" size={16} />
              Add to library
            </button>
          </div>
        </div>
      </div>

      {library.length === 0 ? (
        <div className="n-lib-empty">
          <p className="n-empty-body">Nothing here yet.</p>
          <button type="button" className="pill" onClick={openSample}>
            <Icon name="page" size={16} />
            Open the sample
          </button>
        </div>
      ) : (
        <div className="n-libgrid">
          {library.map((e) => (
            <button
              key={e.id}
              type="button"
              className={`n-libcard${doc?.sourceName === e.sourceName ? ' n-libcard-on' : ''}`}
              onClick={() => { openSample(); setView('player'); }}
            >
              <span className="n-libcard-top">
                <Icon name="file" size={18} />
                <span className="n-libcard-title">{e.title}</span>
              </span>
              <span className="n-libcard-meta mono">
                {e.wordCount.toLocaleString()} words · ~{e.minutes} min · {e.sourceName}
              </span>
              <Waveform bars={40} progress={0} seed={e.addedAt % 9973} height={22} />
            </button>
          ))}
        </div>
      )}

      {/* On open, the choice of streaming or rendering everything. */}
      {pending || doc ? (
        <div className="n-openbar" role="group" aria-label="How to play this document">
          <div className="n-openbar-text">
            <div className="label">Ready</div>
            <div className="n-openbar-title">{doc?.title ?? pending?.name}</div>
            <div className="n-openbar-meta mono">
              {doc ? `${doc.words.length.toLocaleString()} words · ~${Math.round(doc.words.length / 150)} min` : ''}
            </div>
          </div>
          <div className="n-openbar-actions">
            <button
              type="button"
              className="pill"
              onClick={() => start('stream')}
              title="Begin playing after a moment, and keep rendering ahead of the playhead"
            >
              <Icon name="play" size={15} />
              Stream as you listen
            </button>
            <button
              type="button"
              className="pill pill-primary"
              onClick={() => start('full')}
              title="Render the whole document first — this is what export needs"
            >
              <Icon name="download" size={15} />
              Render everything
            </button>
          </div>
          <span className="sr-only">{busy ? status : ''}</span>
        </div>
      ) : null}
    </div>
  );
}
