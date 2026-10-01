import { useEffect, useMemo, useRef } from 'react';
import type { Block, Doc, Word } from '../core/types';
import { useNarrate } from '../state/store';

type Token =
  | { t: 'text'; v: string }
  | { t: 'word'; w: Word }
  | { t: 'break' };

/**
 * Rebuild a block's display text from the word index.
 *
 * Text between words is emitted verbatim so the page looks like the document
 * rather than a list of tokens, and every word is a real element carrying its
 * own absolute offsets. This is why a click can seek exactly: the element is
 * the index entry.
 *
 * The caller supplies this block's word range. Re-scanning the whole word list
 * per block would be quadratic, which a 40,000-word document notices.
 */
function tokeniseBlock(doc: Doc, block: Block, from: number, to: number): Token[] {
  const out: Token[] = [];
  let cursor = block.start;
  for (let i = from; i < to; i++) {
    const w = doc.words[i];
    if (w.start > cursor) out.push({ t: 'text', v: doc.plain.slice(cursor, w.start) });
    out.push({ t: 'word', w });
    cursor = w.end;
  }
  if (cursor < block.end) out.push({ t: 'text', v: doc.plain.slice(cursor, block.end) });
  return out;
}

/** Every word in one sentence, in order, as renderable tokens. */
function tokensOfSentence(doc: Doc, sentenceIndex: number): Token[] {
  const s = doc.sentences[sentenceIndex];
  if (!s) return [];
  const out: Token[] = [];
  for (let i = s.wordStart; i < s.wordEnd; i++) {
    const w = doc.words[i];
    if (i > s.wordStart) {
      // Preserve the original inter-word spacing so the sentence still reads
      // as prose rather than as a run-together list.
      const gap = doc.plain.slice(doc.words[i - 1].end, w.start);
      if (gap) out.push({ t: 'text', v: gap });
    }
    out.push({ t: 'word', w });
  }
  return out;
}

export function ReaderView() {
  const {
    doc, time, playing, currentSentence, readerMode, setReaderMode,
    seekWord, setView,
  } = useNarrate();

  const sentenceRefs = useRef(new Map<number, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const isFocus = readerMode === 'focus';

  const tokensByBlock = useMemo(() => {
    if (!doc) return [];
    // One pass to find each block's word range, then tokenise only that range.
    const ranges = new Map<number, [number, number]>();
    doc.words.forEach((w, i) => {
      const r = ranges.get(w.blockIndex);
      if (r) r[1] = i + 1;
      else ranges.set(w.blockIndex, [i, i + 1]);
    });
    return doc.blocks.map((b, bi) => {
      const r = ranges.get(bi);
      return r ? tokeniseBlock(doc, b, r[0], r[1]) : [{ t: 'text' as const, v: doc.plain.slice(b.start, b.end) }];
    });
  }, [doc]);

  /** First sentence index per block, so block refs can register in O(1). */
  const firstSentenceOfBlock = useMemo(() => {
    const map = new Map<number, number>();
    if (!doc) return map;
    for (const s of doc.sentences) {
      if (!map.has(s.blockIndex)) map.set(s.blockIndex, s.index);
    }
    return map;
  }, [doc]);

  // Follow the narrator while playing, but stop following the moment the user
  // takes the scroll. Yanking the page back from someone who is reading ahead is
  // the fastest way to make a follow-along view unusable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { following.current = false; };
    el.addEventListener('wheel', onScroll, { passive: true });
    el.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onScroll);
      el.removeEventListener('touchmove', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!playing || !currentSentence || isFocus) return;
    const el = sentenceRefs.current.get(currentSentence.index);
    if (!el) return;
    if (el.getBoundingClientRect().top < 90 ||
        el.getBoundingClientRect().bottom > window.innerHeight - 190) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [currentSentence?.index, playing, isFocus]);

  if (!doc) {
    return (
      <div className="n-reader n-reader-empty">
        <p className="n-empty-title">No document open</p>
        <p className="n-empty-body">
          Open a file, or start with the sample, and the text here will move with the voice.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setView('player')}>
          Go to library
        </button>
      </div>
    );
  }

  const wordState = (w: Word): string => {
    if (w.endTime === null) return 'n-w-ahead';
    if (time >= w.endTime) return 'n-w-spent';
    if (time >= (w.startTime ?? 0)) return 'n-w-now';
    return 'n-w-ahead';
  };

  const renderTokens = (tokens: Token[]) =>
    tokens.map((tok, i) => {
      if (tok.t === 'text') return <span key={i}>{tok.v}</span>;
      if (tok.t === 'break') return <br key={i} />;
      const w = tok.w;
      const inSentence = currentSentence?.index === w.sentenceIndex;
      return (
        <span key={i}>
          <span
            className={[
              'n-w',
              wordState(w),
              inSentence ? 'n-w-sentence' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={(event) => {
              event.stopPropagation();
              void seekWord(w.index);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                void seekWord(w.index);
              }
            }}
            title={w.startTime !== null ? 'Play from here' : 'Render and play from here'}
          >
            {w.text}
          </span>
        </span>
      );
    });

  /* ------------------------------------------------------------- focus mode ---- */

  if (isFocus) {
    const centre = currentSentence?.index ?? 0;
    const window_ = [-2, -1, 0, 1, 2]
      .map((d) => centre + d)
      .filter((i) => i >= 0 && i < doc.sentences.length);
    return (
      <div className="n-reader n-reader-focus">
        {/* The mode switch lives in both modes. Omitting it here is what made
            focus mode a one-way door. */}
        <div className="n-page-toolbar">
          <div className="label">Focus</div>
          <div className="n-segment" role="group" aria-label="Reading mode">
            <button
              type="button"
              className="n-segbtn"
              onClick={() => setReaderMode('page')}
              aria-pressed={false}
            >
              Page
            </button>
            <button
              type="button"
              className="n-segbtn n-segbtn-on"
              onClick={() => setReaderMode('focus')}
              aria-pressed
            >
              Focus
            </button>
          </div>
        </div>

        <div className="n-focus-stage">
          <div className="n-focus-stack">
            {window_.map((i) => {
              const s = doc.sentences[i];
              const isNow = i === centre;
              return (
                <p
                  key={i}
                  ref={(el) => { if (el) sentenceRefs.current.set(i, el); }}
                  className={`n-focus-sentence${isNow ? ' n-focus-now' : ''}`}
                  onClick={() => void seekWord(s.wordStart)}
                >
                  {/* Rendered as words, not a string: the current word has to
                      highlight here too, or focus mode silently loses the
                      feature it exists to foreground. */}
                  {renderTokens(tokensOfSentence(doc, i))}
                </p>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- page mode ---- */

  return (
    <div className="n-reader n-reader-page">
      <div className="n-page-toolbar">
        <div className="label">Reading</div>
        <div className="n-segment" role="group" aria-label="Reading mode">
          <button
            type="button"
            className={`n-segbtn${!isFocus ? ' n-segbtn-on' : ''}`}
            onClick={() => setReaderMode('page')}
            aria-pressed={!isFocus}
          >
            Page
          </button>
          <button
            type="button"
            className={`n-segbtn${isFocus ? ' n-segbtn-on' : ''}`}
            onClick={() => setReaderMode('focus')}
            aria-pressed={isFocus}
          >
            Focus
          </button>
        </div>
      </div>

      <article className="page n-page" ref={scrollRef}>
        {doc.blocks.map((block, bi) => (
          <div
            key={bi}
            className={`n-block n-block-${block.kind}`}
            ref={(el) => {
              if (!el) return;
              const first = firstSentenceOfBlock.get(bi);
              if (first !== undefined) sentenceRefs.current.set(first, el);
            }}
          >
            {block.kind === 'heading' ? (
              <h2 className={`n-h n-h-${block.level ?? 2}`}>{renderTokens(tokensByBlock[bi])}</h2>
            ) : block.kind === 'listItem' ? (
              <p className="n-li">
                <span className="n-li-mark" aria-hidden="true" />
                {renderTokens(tokensByBlock[bi])}
              </p>
            ) : block.kind === 'quote' ? (
              <blockquote className="n-quote">{renderTokens(tokensByBlock[bi])}</blockquote>
            ) : block.kind === 'code' ? (
              <pre className="n-code">{renderTokens(tokensByBlock[bi])}</pre>
            ) : (
              <p className="n-p">{renderTokens(tokensByBlock[bi])}</p>
            )}
          </div>
        ))}
        <div className="n-page-end">
          <span className="label">End of document</span>
        </div>
      </article>
    </div>
  );
}
