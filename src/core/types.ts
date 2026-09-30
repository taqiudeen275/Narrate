/**
 * The document model.
 *
 * One rule governs this file: the flat `plain` string is the single source of
 * truth, and every block, sentence, and word carries absolute character offsets
 * into it. That is what makes word seeking exact — seeking a word is setting
 * the playhead to a number, not searching the text again.
 */

export type BlockKind = 'heading' | 'paragraph' | 'listItem' | 'quote' | 'code';

export interface Block {
  kind: BlockKind;
  /** Offset of this block's first character in `plain`. */
  start: number;
  /** Offset one past this block's last character in `plain`. */
  end: number;
  /** Heading depth, 1-6, when `kind` is 'heading'. */
  level?: number;
}

export interface Word {
  index: number;
  /** Trimmed surface form, for display. */
  text: string;
  /** Raw segment including any trailing whitespace, so display can be rebuilt. */
  raw: string;
  start: number;
  end: number;
  sentenceIndex: number;
  blockIndex: number;
  /**
   * Relative expected duration, used when the engine reports a per-sentence
   * time but not per-word times. Counted from sound-producing characters, so a
   * long word takes longer than a short one and punctuation costs nothing.
   */
  weight: number;
  /**
   * Seconds into the rendered audio. Null until the engine has produced audio
   * spanning this word. Streaming writes these progressively.
   */
  startTime: number | null;
  endTime: number | null;
}

export interface Sentence {
  index: number;
  text: string;
  start: number;
  end: number;
  blockIndex: number;
  wordStart: number;
  wordEnd: number;
  /**
   * Seconds into the rendered audio. Null until the engine has produced audio
   * for this sentence. Streaming writes these progressively.
   */
  startTime: number | null;
  endTime: number | null;
}

export interface Doc {
  title: string;
  /** Source filename, when it came from a file. */
  sourceName?: string;
  /** The full plain text. Every offset in this model indexes into this. */
  plain: string;
  blocks: Block[];
  sentences: Sentence[];
  words: Word[];
  /** Character length of the source, for progress estimates. */
  charCount: number;
}

/* ------------------------------------------------------------- utilities ---- */

const NOISE = /[^\p{L}\p{N}'’-]/gu;

function isWordLike(s: string): boolean {
  return /\p{L}|\p{N}/u.test(s);
}

/** Sounds-per-word estimate. Not a phonemizer — a first-order duration weight. */
export function wordWeight(s: string): number {
  const cleaned = s.replace(NOISE, '');
  if (!cleaned) return 0.5;
  // Longer words take longer, with a small floor so short words still register.
  return Math.max(1, cleaned.length * 0.8);
}

/**
 * Build the block/sentence/word index for a plain string.
 *
 * `Intl.Segmenter` does the sentence and word work. This is a real segmenter
 * with locale data, not a regular expression, which matters: a regex splits on
 * abbreviations, decimals and initials, and every one of those becomes an
 * audible glitch in the output.
 */
export function indexDocument(plain: string, blocks: Block[], title: string): Doc {
  const sentences: Sentence[] = [];
  const words: Word[] = [];

  const sentSeg = new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const wordSeg = new Intl.Segmenter(undefined, { granularity: 'word' });

  for (const s of sentSeg.segment(plain)) {
    const text = s.segment;
    const start = s.index;
    const end = start + text.length;
    if (!text.trim()) continue;

    const sentenceIndex = sentences.length;
    const blockIndex = blockIndexFor(blocks, start);
    const wordStart = words.length;

    for (const w of wordSeg.segment(text)) {
      if (!isWordLike(w.segment)) continue;
      const trimmed = w.segment.trim();
      if (!trimmed) continue;
      // Offset of the trimmed word inside `plain`: the segment starts at
      // `start + w.index`, and leading whitespace, if any, is inside the segment.
      const lead = w.segment.length - w.segment.trimStart().length;
      const abs = start + w.index + lead;
      words.push({
        index: words.length,
        text: trimmed,
        raw: w.segment,
        start: abs,
        end: abs + trimmed.length,
        sentenceIndex,
        blockIndex,
        weight: wordWeight(trimmed),
        startTime: null,
        endTime: null,
      });
    }

    if (words.length === wordStart) continue; // sentence of pure punctuation

    sentences.push({
      index: sentenceIndex,
      text: text.trim(),
      start,
      end,
      blockIndex,
      wordStart,
      wordEnd: words.length,
      startTime: null,
      endTime: null,
    });
  }

  return {
    title,
    plain,
    blocks,
    sentences,
    words,
    charCount: plain.length,
  };
}

function blockIndexFor(blocks: Block[], offset: number): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].start <= offset) return i;
  }
  return 0;
}

/** Rebuild display text for a block from its words, preserving original gaps. */
export function blockText(doc: Doc, blockIndex: number): string {
  const block = doc.blocks[blockIndex];
  if (!block) return '';
  return doc.plain.slice(block.start, block.end);
}

/** The word containing or nearest to a character offset. */
export function wordAt(doc: Doc, offset: number): Word | null {
  if (doc.words.length === 0) return null;
  let lo = 0;
  let hi = doc.words.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = doc.words[mid];
    if (offset < w.start) hi = mid - 1;
    else if (offset >= w.end) lo = mid + 1;
    else return w;
  }
  // Between words: snap to the next one, so a click in the gap still seeks.
  return doc.words[Math.min(lo, doc.words.length - 1)];
}

/**
 * The word being spoken at a point on the audio timeline.
 *
 * Distinct from `wordAt`, which resolves a character offset in the source text.
 * Confusing the two is a silent failure: the highlight would sit on the first
 * word of whatever sentence is current and still look plausible.
 *
 * Falls back to the nearest word inside the sentence when the playhead is in a
 * gap, which is what happens during the pause between sentences.
 */
export function wordAtTime(doc: Doc, t: number): Word | null {
  if (doc.words.length === 0) return null;
  // First timed word at or after t.
  let lo = 0;
  let hi = doc.words.length - 1;
  let next = doc.words.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const w = doc.words[mid];
    if ((w.endTime ?? 0) < t) lo = mid + 1;
    else {
      next = mid;
      hi = mid - 1;
    }
  }
  const candidate = doc.words[Math.min(next, doc.words.length - 1)];
  if (candidate.endTime === null) return null;
  // Inside this word's window: that is the one being spoken.
  if (t >= (candidate.startTime ?? 0) && t < candidate.endTime) return candidate;
  // Otherwise we are in a gap. Take the previous word if we are past its end,
  // so the highlight does not jump ahead during the pause.
  if (next > 0) {
    const prev = doc.words[next - 1];
    if (prev.endTime !== null && t >= (prev.startTime ?? 0)) return prev;
  }
  return candidate;
}

/**
 * Distribute a measured sentence duration across its words, weighted by
 * expected speech time. This is the Web adapter's timing path: the engine
 * reports real per-sentence audio, and this spreads it sensibly across the
 * words inside. The native adapter will replace it with the acoustic model's
 * own phoneme durations, which are exact rather than weighted.
 */
export function distributeSentence(
  doc: Doc,
  sentenceIndex: number,
  from: number,
  to: number,
): void {
  const s = doc.sentences[sentenceIndex];
  if (!s) return;
  s.startTime = from;
  s.endTime = to;

  const total = to - from;
  let weightSum = 0;
  for (let i = s.wordStart; i < s.wordEnd; i++) weightSum += doc.words[i].weight;
  if (weightSum <= 0) return;

  let t = from;
  for (let i = s.wordStart; i < s.wordEnd; i++) {
    const share = (doc.words[i].weight / weightSum) * total;
    doc.words[i].startTime = t;
    doc.words[i].endTime = t + share;
    t += share;
  }
}
