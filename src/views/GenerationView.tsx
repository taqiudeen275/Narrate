import { useNarrate } from '../state/store';
import { Icon } from '../design/Icon';

/**
 * Work / generation.
 *
 * This is the Operate surface: the one page whose job is to make a waiting
 * process legible. Everything on it answers a question the user actually has —
 * is it working, how far along is it, what has already been made, and can I
 * take the result away yet.
 *
 * The honesty rule here is that progress is read from the document itself
 * (`sentence.startTime !== null`), never from the counter in the store. The
 * counter is what the engine *intends*; the sentence timestamps are what
 * actually exist as audio. If they ever disagree, this page shows the truth.
 */

/** Beyond this the list stops being a summary and becomes a second reader. */
const CAP = 300;

/** Bars in the travelling wave. Enough to read as a wave, few enough to stay light. */
const BARS = 32;

/** 150 wpm — the measured average for read speech, and the same figure the library uses. */
const WPM = 150;

const CSS = `
.n-gen-head { display: flex; flex-direction: column; gap: 0.2rem; }

/* ------------------------------------------------------------------ stage ---- */

/* The working state gets the room. Centred, generous, and impossible to
   mistake for an empty state. */
.n-gen-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-4);
  padding: var(--s-7) var(--s-5);
  margin: 0 auto var(--s-5);
  max-inline-size: 46rem;
  text-align: center;
  border-radius: var(--r-xl);
  background: var(--glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  box-shadow: var(--sh-md);
}

/* Bars grow from the centre axis rather than from the top, which is what makes
   a row of animated rectangles read as a waveform instead of a loading bar. */
.n-gen-bars {
  display: flex;
  align-items: center;
  gap: 3px;
  inline-size: min(100%, 26rem);
  block-size: 3.25rem;
}

.n-gen-bar {
  --k: 0.6;
  flex: 1 1 0;
  min-inline-size: 2px;
  block-size: 100%;
  border-radius: var(--r-pill);
  background: var(--wash-2);
  transform-origin: center;
  transform: scaleY(calc(var(--k) * 0.2));
  animation: n-gen-swell 1.15s var(--ease) infinite;
  animation-delay: calc(var(--i) * -0.072s);
}

.n-gen-bar-done { background: var(--accent); }

@keyframes n-gen-swell {
  0%, 100% { transform: scaleY(calc(var(--k) * 0.18)); opacity: 0.45; }
  50% { transform: scaleY(var(--k)); opacity: 1; }
}

.n-gen-status {
  margin: 0;
  font-size: var(--t-xl);
  font-weight: 300;
  letter-spacing: -0.02em;
  color: var(--ink);
}

.n-gen-hint {
  margin: 0;
  max-inline-size: 44ch;
  font-size: var(--t-sm);
  line-height: 1.6;
  color: var(--ink-2);
}

.n-gen-file {
  margin: 0;
  font-size: var(--t-3xs);
  color: var(--ink-3);
}

/* The track. A soft well, with a fill that grows or a sheen that sweeps. */
.n-gen-track {
  position: relative;
  inline-size: min(100%, 26rem);
  block-size: 6px;
  border-radius: var(--r-pill);
  background: var(--glass-thin);
  box-shadow: var(--sh-inset);
  overflow: hidden;
}

.n-gen-fill {
  block-size: 100%;
  border-radius: var(--r-pill);
  background: var(--accent);
  transition: inline-size var(--t-mid) var(--ease);
}

.n-gen-sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgb(255 255 255 / 0.72) 45%,
    transparent 100%
  );
  animation: n-gen-sweep 1.5s var(--ease) infinite;
}

@keyframes n-gen-sweep {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}

.n-gen-stagefoot {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  flex-wrap: wrap;
  justify-content: center;
}

/* ------------------------------------------------------------------- idle ---- */

.n-gen-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--s-3);
  padding: var(--s-7) var(--s-5);
  margin: 0 auto var(--s-5);
  max-inline-size: 46rem;
  text-align: center;
  border-radius: var(--r-xl);
  background: var(--glass-thin);
  box-shadow: var(--sh-inset);
}

.n-gen-idle-title {
  margin: 0;
  font-size: var(--t-2xl);
  font-weight: 300;
  letter-spacing: -0.03em;
  color: var(--ink);
}

.n-gen-actions { display: flex; flex-wrap: wrap; gap: var(--s-2); justify-content: center; }

/* -------------------------------------------------------------- sentences ---- */

.n-gen-gridwrap {
  max-inline-size: 68rem;
  margin: 0 auto var(--s-5);
}

.n-gen-legend {
  display: flex;
  align-items: center;
  gap: var(--s-4);
  flex-wrap: wrap;
  margin-block-end: var(--s-3);
  font-size: var(--t-2xs);
  color: var(--ink-3);
}

.n-gen-legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }

.n-gen-key {
  inline-size: 8px;
  block-size: 8px;
  border-radius: 50%;
  background: var(--accent);
}
.n-gen-key-todo { background: var(--ink-4); }
.n-gen-key-now { background: var(--glass-strong); box-shadow: 0 0 0 3px var(--accent-soft); }

.n-gen-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
  gap: var(--s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.n-gen-sent {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
  padding: 0.5rem 0.7rem;
  border-radius: var(--r-md);
  background: var(--glass);
  backdrop-filter: blur(var(--glass-blur));
  -webkit-backdrop-filter: blur(var(--glass-blur));
  box-shadow: var(--sh-sm);
  transition: all var(--t-fast) var(--ease);
}

/* Not yet rendered: low contrast, so the finished sentences are the ones the
   eye lands on. Never colour alone — the dot carries the same state. */
.n-gen-sent-todo { color: var(--ink-4); }
.n-gen-sent-todo .n-gen-dot { background: var(--ink-4); opacity: 0.5; }
.n-gen-sent-done { color: var(--ink); }
.n-gen-sent-done .n-gen-dot { background: var(--accent); }

.n-gen-sent-now {
  color: var(--ink);
  background: var(--glass-strong);
  box-shadow: var(--sh-md), inset 2px 0 0 var(--accent);
}

.n-gen-num {
  flex: 0 0 auto;
  min-inline-size: 2.2ch;
  font-size: var(--t-3xs);
  color: var(--ink-3);
  padding-block-start: 0.15em;
}

.n-gen-sent-todo .n-gen-num { color: var(--ink-4); }

.n-gen-dot {
  flex: 0 0 auto;
  inline-size: 6px;
  block-size: 6px;
  margin-block-start: 0.52em;
  border-radius: 50%;
}

.n-gen-text {
  min-inline-size: 0;
  font-family: var(--font-read);
  font-size: var(--t-xs);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.n-gen-more {
  margin: var(--s-3) 0 0;
  font-size: var(--t-2xs);
  color: var(--ink-3);
  text-align: center;
}

/* ---------------------------------------------------------------- summary ---- */

.n-gen-summary {
  max-inline-size: 68rem;
  margin: 0 auto;
  padding: var(--s-5);
  border-radius: var(--r-lg);
  background: var(--glass);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.4);
  box-shadow: var(--sh-md);
}

.n-gen-sum-title {
  margin: var(--s-1) 0 var(--s-4);
  font-size: var(--t-lg);
  font-weight: 500;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.n-gen-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--s-3) var(--s-5);
  margin: 0 0 var(--s-4);
}

.n-gen-stats > div {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  padding-block-start: var(--s-2);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5);
}

.n-gen-stats dt {
  font-size: var(--t-3xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.n-gen-stats dd {
  margin: 0;
  font-size: var(--t-md);
  color: var(--ink);
}

.n-gen-export { display: flex; flex-wrap: wrap; gap: var(--s-2); }

.n-gen-note {
  margin: var(--s-3) 0 0;
  font-size: var(--t-2xs);
  line-height: 1.55;
  color: var(--ink-3);
}

@media (max-width: 900px) {
  .n-gen-stage, .n-gen-idle { padding: var(--s-5) var(--s-4); }
  .n-gen-status { font-size: var(--t-lg); }
  .n-gen-summary { padding: var(--s-4); }
}

/* With reduced motion the wave stops moving and becomes a static profile —
   the colour split between rendered and unrendered bars is then the only
   thing carrying the animation's meaning, so it has to be legible on its own. */
@media (prefers-reduced-motion: reduce) {
  .n-gen-bar { animation: none; transform: scaleY(var(--k)); opacity: 0.7; }
  .n-gen-sheen { animation: none; opacity: 0.5; }
  .n-gen-sent { transition: none; }
}
`;

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A fixed per-bar amplitude. Deterministic, so the wave has the same silhouette
 * every render and reads as one object rather than a reshuffle.
 */
function barScale(i: number): number {
  return 0.34 + (Math.sin((i + 1) * 1.7) * 0.5 + 0.5) * 0.66;
}

export function GenerationView() {
  const {
    doc, busy, engineLoading, status, error, engineError, modelProgress,
    renderedCount, duration, playing, currentSentence, generateMode,
    generate, exportAudio, cancel,
  } = useNarrate();

  const sentences = doc ? doc.sentences : [];
  const total = sentences.length;
  const shown = sentences.slice(0, CAP);
  const hidden = total - shown.length;

  const words = doc ? doc.words.length : 0;
  const minutes = Math.round(words / WPM);

  const working = busy || engineLoading;

  /** Truth, read off the document: audio that exists. */
  const allRendered = total > 0 && sentences.every((s) => s.startTime !== null);
  const canExport = allRendered && !working && total > 0;

  /**
   * Which sentence to call current. While working that is the one the engine
   * is about to do; once it stops it is wherever the playhead actually is.
   */
  const current = working
    ? Math.min(renderedCount, Math.max(0, total - 1))
    : currentSentence
      ? currentSentence.index
      : -1;

  const fraction = modelProgress ? modelProgress.fraction : null;
  const determinate = fraction !== null;
  const pct = determinate ? Math.round((fraction as number) * 100) : 0;

  const start = (mode: 'stream' | 'full') => {
    void generate(mode);
  };

  const primaryLabel = generateMode === 'stream' ? 'Stream as you listen' : 'Render everything';
  const alternateLabel = generateMode === 'stream' ? 'Render everything' : 'Stream as you listen';
  const alternateMode: 'stream' | 'full' = generateMode === 'stream' ? 'full' : 'stream';

  return (
    <div className="n-panel-view">
      <style>{CSS}</style>

      <header className="n-panel-head">
        <div>
          <div className="label">Work</div>
          <h1 className="heading n-panel-title">Generation</h1>
          <p className="n-panel-sub">
            Speech is synthesised here, on this machine, one sentence at a time. This page
            shows what exists so far and what is still to come.
          </p>
        </div>
        <div className="n-gen-head">
          {working ? (
            <span className="live-dot live-dot-on">Working</span>
          ) : playing ? (
            <span className="live-dot live-dot-on">Playing</span>
          ) : (
            <span className="live-dot">Idle</span>
          )}
        </div>
      </header>

      {/* ------------------------------------------------------------ work ---- */}

      {working ? (
        <section className="n-gen-stage" aria-busy="true">
          <div className="n-gen-bars" aria-hidden="true">
            {Array.from({ length: BARS }, (_, i) => {
              // Colour carries the same meaning the motion does: bars behind the
              // render frontier are committed, bars ahead of it are still to come.
              const done = i < Math.round((renderedCount / Math.max(1, total)) * BARS);
              return (
                <span
                  key={i}
                  className={`n-gen-bar${done ? ' n-gen-bar-done' : ''}`}
                  style={{ ['--i' as string]: i, ['--k' as string]: barScale(i) }}
                />
              );
            })}
          </div>

          <p className="n-gen-status" role="status">{status}</p>

          <p className="n-gen-hint">
            {engineLoading && !doc
              ? 'Nothing to do until a document is open.'
              : engineLoading
                ? 'Fetching the voice model. It is cached on disk, so this only happens once.'
                : total > 0
                  ? `Rendering sentence ${Math.min(renderedCount + 1, total)} of ${total}. Nothing is uploaded, and you can leave this page open until it finishes.`
                  : 'Waiting for a document.'}
          </p>

          <div
            className="n-gen-track"
            role="progressbar"
            aria-label="Model download"
            aria-valuemin={determinate ? 0 : undefined}
            aria-valuemax={determinate ? 100 : undefined}
            aria-valuenow={determinate ? pct : undefined}
          >
            {determinate ? (
              <span className="n-gen-fill" style={{ inlineSize: `${pct}%` }} />
            ) : (
              <span className="n-gen-sheen" />
            )}
          </div>

          {modelProgress ? (
            <p className="n-gen-file mono">
              {modelProgress.file} · {bytes(modelProgress.loaded)} / {bytes(modelProgress.total)}
            </p>
          ) : (
            <p className="n-gen-file mono">{status}</p>
          )}

          {busy && cancel ? (
            <div className="n-gen-stagefoot">
              <button type="button" className="pill pill-quiet" onClick={cancel}>
                <Icon name="stop" size={15} />
                Stop
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="n-gen-idle">
          <p className="n-gen-idle-title">Nothing is rendering.</p>
          <p className="n-gen-hint">
            {!doc
              ? 'Open a document from the library and Narrate will start synthesising.'
              : allRendered
                ? `Every one of the ${total} sentences is rendered and ready to play or export.`
                : `${renderedCount} of ${total} sentences are rendered. Playback renders the rest as it goes; export needs all of them.`}
          </p>
          <div className="n-gen-actions">
            <button
              type="button"
              className="pill pill-primary"
              disabled={!doc}
              onClick={() => start(generateMode)}
            >
              <Icon name="play" size={15} />
              {primaryLabel}
            </button>
            <button
              type="button"
              className="pill"
              disabled={!doc}
              onClick={() => start(alternateMode)}
            >
              <Icon name="download" size={15} />
              {alternateLabel}
            </button>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------- sentences ---- */}

      <div className="n-gen-gridwrap">
        <div className="n-gen-legend">
          <span className="n-gen-legend-item">
            <span className="n-gen-key" /> Rendered
          </span>
          <span className="n-gen-legend-item">
            <span className="n-gen-key n-gen-key-todo" /> Not yet rendered
          </span>
          <span className="n-gen-legend-item">
            <span className="n-gen-key n-gen-key-now" /> In progress
          </span>
          <span className="mono">{renderedCount} / {total} sentences</span>
        </div>

        {total === 0 ? (
          <p className="n-gen-more">No sentences to show — open a document first.</p>
        ) : (
          <ul className="n-gen-grid">
            {shown.map((s) => {
              const done = s.startTime !== null;
              const now = s.index === current;
              const state = now ? ' n-gen-sent-now' : done ? ' n-gen-sent-done' : ' n-gen-sent-todo';
              return (
                <li
                  key={s.index}
                  className={`n-gen-sent${state}`}
                  aria-current={now ? 'true' : undefined}
                >
                  <span className="n-gen-num mono">{s.index + 1}</span>
                  <span className="n-gen-dot" />
                  <span className="n-gen-text">{s.text}</span>
                </li>
              );
            })}
          </ul>
        )}

        {hidden > 0 ? (
          <p className="n-gen-more">
            {hidden.toLocaleString()} further {hidden === 1 ? 'sentence is' : 'sentences are'} not
            listed here — the list is capped at {CAP.toLocaleString()} so a long document stays
            scannable.
          </p>
        ) : null}
      </div>

      {/* --------------------------------------------------------- summary ---- */}

      <section className="n-gen-summary">
        <div className="label">Output</div>
        <h2 className="n-gen-sum-title">{doc ? doc.title : 'No document open'}</h2>

        <dl className="n-gen-stats">
          <div>
            <dt>Sentences</dt>
            <dd className="mono">{renderedCount} / {total}</dd>
          </div>
          <div>
            <dt>Words</dt>
            <dd className="mono">{words.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd className="mono">~{minutes} min</dd>
          </div>
          <div>
            <dt>Rendered audio</dt>
            <dd className="mono">{duration > 0 ? clock(duration) : '—'}</dd>
          </div>
        </dl>

        <div className="n-gen-export">
          <button
            type="button"
            className="pill pill-primary"
            disabled={!canExport}
            onClick={() => void exportAudio('wav')}
          >
            <Icon name="download" size={15} />
            Export WAV
          </button>
          <button
            type="button"
            className="pill"
            disabled={!canExport}
            onClick={() => void exportAudio('mp3')}
          >
            <Icon name="download" size={15} />
            Export MP3
          </button>
        </div>

        <p className="n-gen-note">
          {canExport
            ? 'WAV is uncompressed and exact; MP3 is roughly a tenth of the size. Both come from the audio already on disk.'
            : total === 0
              ? 'Export becomes available once a document is open and fully rendered.'
              : `${total - renderedCount} of ${total} ${total - renderedCount === 1 ? 'sentence is' : 'sentences are'} still missing. Export needs the whole document rendered, because a partial file would end mid-sentence.`}
        </p>
      </section>

      {error ? <p className="n-error" style={{ marginBlockStart: 'var(--s-4)' }}>{error}</p> : null}
      {engineError ? (
        <p className="n-error" style={{ marginBlockStart: 'var(--s-4)' }}>Voice model: {engineError}</p>
      ) : null}
    </div>
  );
}
