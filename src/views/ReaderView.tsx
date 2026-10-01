import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Block, Doc, Word } from '../core/types';
import { wordAtTime } from '../core/types';
import { useNarrate } from '../state/store';
import { prefersReducedMotion } from '../core/motion';

type Token =
  | { t: 'text'; v: string }
  | { t: 'word'; w: Word }
  | { t: 'break' };

type WordPhase = 'ahead' | 'spent' | 'now';
interface ReadingTokensProps {
  tokens: Token[];
  sentences: Doc['sentences'];
  currentWordIndex: number;
  currentSentenceIndex: number;
  wordPhase: WordPhase;
  timedTo: number;
  wordRef: RefObject<HTMLElement | null>;
  sentenceRefs: Map<number, HTMLElement>;
  onSeek: (index: number) => void;
}

function ReadingTokens({ tokens, sentences, currentWordIndex, currentSentenceIndex, wordPhase, timedTo,
  wordRef, sentenceRefs, onSeek }: ReadingTokensProps) {
  return tokens.map((tok, i) => {
    if (tok.t === 'text') return <span key={i}>{tok.v}</span>;
    if (tok.t === 'break') return <br key={i} />;
    const w = tok.w;
    const phase = w.index >= timedTo ? 'ahead' : w.index < currentWordIndex ? 'spent'
      : w.index === currentWordIndex ? wordPhase : 'ahead';
    return <span key={i}><span
      className={`n-w n-w-${phase}${currentSentenceIndex === w.sentenceIndex ? ' n-w-sentence' : ''}`}
      ref={(el) => {
        if (w.index === currentWordIndex) wordRef.current = el;
        if (w.index !== sentences[w.sentenceIndex].wordStart) return;
        if (el) sentenceRefs.set(w.sentenceIndex, el);
        else sentenceRefs.delete(w.sentenceIndex);
      }}
      onClick={(event) => { event.stopPropagation(); onSeek(w.index); }}
      role="button" tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); event.stopPropagation(); onSeek(w.index);
        }
      }}
      title={w.index < timedTo ? 'Play from here' : 'Render and play from here'}
    >{w.text}</span></span>;
  });
}

// Clip playback and generation positions to each block's range before passing
// them here. Words elsewhere in the book then leave this content unchanged.
const ReaderBlock = memo(function ReaderBlock({ block, ...props }: ReadingTokensProps & { block: Block }) {
  const content = <ReadingTokens {...props} />;
  return <div className={`n-block n-block-${block.kind}`}>
    {block.kind === 'heading' ? <h2 className={`n-h n-h-${block.level ?? 2}`}>{content}</h2>
      : block.kind === 'listItem' ? <p className="n-li"><span className="n-li-mark" aria-hidden="true" /><span className="n-li-text">{content}</span></p>
      : block.kind === 'quote' ? <blockquote className="n-quote">{content}</blockquote>
      : block.kind === 'code' ? <pre className="n-code">{content}</pre>
      : <p className="n-p">{content}</p>}
  </div>;
});

/** Streaming fills a contiguous timed prefix, followed by untimed words. */
function timedWordEnd(doc: Doc | null): number {
  if (!doc) return 0;
  let lo = 0;
  let hi = doc.words.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (doc.words[mid].endTime === null) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

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
    doc, activeDocId, playing, currentSentence, currentWord, wordPhase, timedTo, readerMode, setReaderMode,
    seekWord, setView,
  } = useNarrate(useShallow((state) => {
    // Timeline resets can precede the next playback callback. Resolve the word
    // from the timeline so a stale callback position cannot leave spent text.
    const currentWord = state.doc ? wordAtTime(state.doc, state.time) : null;
    return {
    doc: state.doc, activeDocId: state.activeDocId, playing: state.playing,
    currentSentence: state.currentSentence, currentWord,
    timedTo: timedWordEnd(state.doc),
    wordPhase: (!currentWord || state.time < (currentWord.startTime ?? 0) ? 'ahead'
      : currentWord.endTime !== null && state.time >= currentWord.endTime ? 'spent' : 'now') as WordPhase,
    readerMode: state.readerMode, setReaderMode: state.setReaderMode,
    seekWord: state.seekWord, setView: state.setView,
    };
  }));

  const sentenceRefs = useRef(new Map<number, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLElement | null>(null);
  const [following, setFollowing] = useState(true);
  const isFocus = readerMode === 'focus';
  const onSeek = useCallback((index: number) => { setFollowing(true); void seekWord(index); }, [seekWord]);

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
      return { from: r?.[0] ?? 0, to: r?.[1] ?? 0,
        tokens: r ? tokeniseBlock(doc, b, r[0], r[1]) : [{ t: 'text' as const, v: doc.plain.slice(b.start, b.end) }] };
    });
  }, [doc?.plain, doc?.blocks, doc?.words]);

  // Follow the narrator while playing, but stop following the moment the user
  // takes the scroll. Yanking the page back from someone who is reading ahead is
  // the fastest way to make a follow-along view unusable.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => { setFollowing(false); };
    el.addEventListener('wheel', onScroll, { passive: true });
    el.addEventListener('touchmove', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onScroll);
      el.removeEventListener('touchmove', onScroll);
    };
  }, [isFocus]);

  useEffect(() => { setFollowing(true); }, [activeDocId, isFocus]);

  useEffect(() => {
    if (!following || !playing || !currentSentence) return;
    const el = wordRef.current ?? sentenceRefs.current.get(currentSentence.index);
    const page = scrollRef.current;
    if (!el || !page) return;
    const wordBounds = el.getBoundingClientRect();
    const pageBounds = page.getBoundingClientRect();
    if (wordBounds.top < pageBounds.top + 16 || wordBounds.bottom > pageBounds.bottom - 16) {
      // Follow vertically inside the reading pane. scrollIntoView also moves
      // horizontal ancestors, which can leave the entire phone UI off screen.
      page.scrollTo({ top: Math.max(0, page.scrollTop + wordBounds.top - pageBounds.top - (page.clientHeight - wordBounds.height) / 2),
        behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    }
  }, [currentWord?.index, currentSentence?.index, playing, isFocus, following]);

  if (!doc) {
    return (
      <div className="n-reader n-reader-empty">
        <p className="n-empty-title">No document open</p>
        <p className="n-empty-body">
          Open a file, or start with the sample, and the text here will move with the voice.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setView('library')}>
          Go to library
        </button>
      </div>
    );
  }

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
          {following ? <div className="label">Focus</div> : <button type="button" className="n-reader-follow" onClick={() => setFollowing(true)}>Resume follow</button>}
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

        <div className="n-focus-stage" ref={scrollRef}>
          <div className="n-focus-stack">
            {window_.map((i) => {
              const s = doc.sentences[i];
              const isNow = i === centre;
              return (
                <p
                  key={i}
                  className={`n-focus-sentence${isNow ? ' n-focus-now' : ''}`}
                  onClick={() => void seekWord(s.wordStart)}
                >
                  {/* Rendered as words, not a string: the current word has to
                      highlight here too, or focus mode silently loses the
                      feature it exists to foreground. */}
                  <ReadingTokens tokens={tokensOfSentence(doc, i)} sentences={doc.sentences}
                    currentWordIndex={currentWord?.index ?? -1} currentSentenceIndex={currentSentence?.index ?? -1}
                    wordPhase={wordPhase} timedTo={timedTo} wordRef={wordRef} sentenceRefs={sentenceRefs.current} onSeek={onSeek} />
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
        {following ? <div className="label">Reading</div> : <button type="button" className="n-reader-follow" onClick={() => setFollowing(true)}>Resume follow</button>}
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
        {doc.blocks.map((block, bi) => {
          const content = tokensByBlock[bi];
          const currentIndex = currentWord?.index ?? -1;
          const containsWord = currentIndex >= content.from && currentIndex < content.to;
          return <ReaderBlock key={bi} block={block} tokens={content.tokens} sentences={doc.sentences}
            currentWordIndex={Math.max(content.from - 1, Math.min(content.to, currentIndex))}
            currentSentenceIndex={currentSentence?.blockIndex === bi ? currentSentence.index : -1}
            wordPhase={containsWord ? wordPhase : 'ahead'} timedTo={Math.max(content.from, Math.min(content.to, timedTo))}
            wordRef={wordRef} sentenceRefs={sentenceRefs.current} onSeek={onSeek} />;
        })}
        <div className="n-page-end">
          <span className="label">End of document</span>
        </div>
      </article>
    </div>
  );
}
