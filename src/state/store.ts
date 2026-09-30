/**
 * Application state.
 *
 * The one thing worth understanding here is the synthesis scheduler. Playback
 * and rendering are decoupled: the player only ever plays audio that exists,
 * and the scheduler keeps a few sentences ahead of the playhead. That is what
 * makes streaming and full generation the same code path, and it is why the
 * highlight can follow the voice without ever waiting on a model.
 */

import { create } from 'zustand';
import type { Doc, Sentence, Word } from '../core/types';
import { distributeSentence, wordAtTime } from '../core/types';
import { parseDocument } from '../core/parse';
import { Player, encodeMp3, encodeWav } from '../core/audio/player';
import type { ModelLoadProgress, TtsEngine } from '../core/tts/engine';
import { SENTENCE_GAP } from '../core/tts/engine';
import { WebKokoroEngine } from '../core/tts/web';
import { DEFAULT_VOICE_ID, voiceById } from '../core/tts/voices';
import { SAMPLE_DOC } from './sample';

export type MainView =
  | 'player' | 'reader' | 'library' | 'work' | 'models' | 'voices' | 'lab';
export type ReaderMode = 'page' | 'focus';
export type GenerateMode = 'stream' | 'full';

export interface LibraryEntry {
  id: string;
  title: string;
  sourceName: string;
  charCount: number;
  wordCount: number;
  minutes: number;
  addedAt: number;
}

interface State {
  library: LibraryEntry[];
  doc: Doc | null;
  view: MainView;
  readerMode: ReaderMode;
  generateMode: GenerateMode;
  voiceId: string;
  speed: number;

  engineReady: boolean;
  engineLoading: boolean;
  modelProgress: ModelLoadProgress | null;
  engineError: string | null;

  playing: boolean;
  time: number;
  duration: number;
  renderedCount: number;
  targetSentence: number;

  currentWord: Word | null;
  currentSentence: Sentence | null;

  status: string;
  error: string | null;
  busy: boolean;

  engine: TtsEngine;
  player: Player;
  cancel: (() => void) | null;
}

interface Actions {
  openBuffer: (name: string, buf: ArrayBuffer) => Promise<void>;
  openSample: () => void;
  removeDoc: (id: string) => void;
  setView: (v: MainView) => void;
  setReaderMode: (m: ReaderMode) => void;
  setGenerateMode: (m: GenerateMode) => void;
  setVoice: (id: string) => void;
  setSpeed: (s: number) => void;
  ensureEngine: () => Promise<void>;
  generate: (mode: GenerateMode) => Promise<void>;
  toggle: () => Promise<void>;
  seekTime: (t: number) => void;
  seekWord: (wordIndex: number) => Promise<void>;
  stepSentence: (delta: number) => Promise<void>;
  stepParagraph: (delta: number) => Promise<void>;
  exportAudio: (format: 'wav' | 'mp3') => Promise<void>;
  clearError: () => void;
}

const engine = new WebKokoroEngine();
const player = new Player();

/** How many sentences to render ahead of the playhead while streaming. */
const LOOKAHEAD = 3;

function toEntry(doc: Doc, id: string): LibraryEntry {
  return {
    id,
    title: doc.title,
    sourceName: doc.sourceName ?? 'sample',
    charCount: doc.charCount,
    wordCount: doc.words.length,
    // 150 wpm is a measured average for read speech, not a guess.
    minutes: Math.round(doc.words.length / 150),
    addedAt: Date.now(),
  };
}

function resolveTime(doc: Doc, t: number): { word: Word | null; sentence: Sentence | null } {
  let lo = 0;
  let hi = doc.sentences.length - 1;
  let found: Sentence | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = doc.sentences[mid];
    if (t < (s.startTime ?? 0)) hi = mid - 1;
    else if (t > (s.endTime ?? 0)) lo = mid + 1;
    else {
      found = s;
      break;
    }
  }
  if (!found) {
    // In a gap between sentences: attribute the time to the nearest one.
    const idx = Math.max(0, Math.min(doc.sentences.length - 1, lo));
    found = doc.sentences[idx] ?? null;
  }
  if (!found) return { word: null, sentence: null };
  // Resolve the word by TIME, not by the sentence's character offset.
  return { word: wordAtTime(doc, t), sentence: found };
}

export const useNarrate = create<State & Actions>((set, get) => {
  const rebuild = (t: number, d: number) => {
    const doc = get().doc;
    if (!doc) return;
    const { word, sentence } = resolveTime(doc, t);
    set({
      time: t,
      duration: d,
      currentWord: word,
      currentSentence: sentence,
      targetSentence: sentence?.index ?? 0,
    });
  };

  player.attach({
    onTime: (t, d) => rebuild(t, d),
    onEnd: () => set({ playing: false }),
    onError: (e) => set({ error: e.message, busy: false }),
  });

  return {
    library: [],
    doc: null,
    view: 'player',
    readerMode: 'page',
    generateMode: 'stream',
    voiceId: DEFAULT_VOICE_ID,
    speed: 1,

    engineReady: false,
    engineLoading: false,
    modelProgress: null,
    engineError: null,

    playing: false,
    time: 0,
    duration: 0,
    renderedCount: 0,
    targetSentence: 0,

    currentWord: null,
    currentSentence: null,

    status: 'Ready',
    error: null,
    busy: false,

    engine,
    player,
    cancel: null,

    async ensureEngine() {
      if (engine.ready || get().engineLoading) return;
      set({ engineLoading: true, engineError: null, status: 'Loading Kokoro' });
      try {
        await engine.load((p) => set({ modelProgress: p }));
        set({ engineReady: true, engineLoading: false, status: 'Ready' });
      } catch (e) {
        set({
          engineLoading: false,
          engineError: e instanceof Error ? e.message : String(e),
          status: 'Model failed to load',
        });
      }
    },

    openSample() {
      const doc = SAMPLE_DOC();
      // Deliberately does not touch `view`. Opening a document should not yank
      // someone out of the view they are using, and it would also clobber a
      // deep link on first load.
      set((s) => ({
        doc,
        library: [toEntry(doc, 'sample'), ...s.library.filter((e) => e.id !== 'sample')],
        status: 'Ready',
        error: null,
        time: 0,
        duration: 0,
        currentWord: null,
        currentSentence: null,
      }));
      player.setTimeline([]);
    },

    async openBuffer(name, buf) {
      set({ busy: true, status: `Reading ${name}`, error: null });
      try {
        const doc = await parseDocument(name, buf);
        if (doc.words.length === 0) {
          throw new Error('No readable text found in that document.');
        }
        set((s) => ({
          doc,
          library: [toEntry(doc, `${Date.now()}`), ...s.library],
          status: 'Ready',
          busy: false,
          time: 0,
          duration: 0,
          currentWord: null,
          currentSentence: null,
        }));
        player.setTimeline([]);
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : String(e), status: 'Ready' });
      }
    },

    removeDoc(id) {
      set((s) => ({ library: s.library.filter((e) => e.id !== id) }));
    },

    setView(v) {
      set({ view: v });
      // Hash routing so the browser extension can deep-link into a view, and so
      // a reload lands where the user left off.
      if (typeof location !== 'undefined') {
        const h = `#/${v}`;
        if (location.hash !== h) history.replaceState(null, '', h);
      }
    },
    setReaderMode(m) {
      set({ readerMode: m });
      if (typeof location !== 'undefined') {
        const h = `#/reader/${m}`;
        if (location.hash !== h) history.replaceState(null, '', h);
      }
    },
    setGenerateMode: (m) => set({ generateMode: m }),
    setSpeed: (s) => set({ speed: s }),

    setVoice(id) {
      if (!voiceById(id)) return;
      set({ voiceId: id });
    },

    async generate(mode) {
      const { doc, voiceId, speed } = get();
      if (!doc) return;
      get().cancel?.();
      const cancelled = { hit: false };
      set(() => ({ cancel: () => { cancelled.hit = true; } }));

      player.pause();
      player.setTimeline([]);
      set({
        playing: false, time: 0, renderedCount: 0, error: null, busy: true,
        status: mode === 'stream' ? 'Streaming' : 'Rendering all',
      });

      await get().ensureEngine();
      if (!engine.ready) {
        set({ busy: false, status: 'Ready' });
        return;
      }

      const sentences = doc.sentences;
      const total = sentences.length;
      let cursor = 0;

      try {
        while (cursor < total) {
          if (cancelled.hit) { set({ status: 'Stopped', busy: false }); return; }

          // In full mode we render everything. In stream mode we stop once we
          // are far enough ahead of the playhead.
          if (mode === 'stream' && player.isRunning) {
            const ahead = player.segmentAt(player.time());
            const here = ahead?.sentenceIndex ?? 0;
            if (cursor > here + LOOKAHEAD) break;
          }

          const s = sentences[cursor];
          const chunk = await engine.synthesize(s.text, voiceId, { speed });
          if (cancelled.hit) { set({ status: 'Stopped', busy: false }); return; }

          player.putSentence(cursor, chunk.samples, chunk.sampleRate);
          const seg = player.segments.find((x) => x.sentenceIndex === cursor);
          if (seg) {
            distributeSentence(doc, cursor, seg.start, seg.start + seg.duration);
          }

          const done = cursor + 1;
          set({
            renderedCount: done,
            status: `${mode === 'stream' ? 'Streaming' : 'Rendering'} ${done} / ${total}`,
          });

          // Start playing as soon as there is enough audio to be worth starting.
          if (mode === 'stream' && !player.isRunning && done >= Math.min(2, total)) {
            set({ playing: true });
            await player.play(0);
          }
          cursor += 1;
        }

        set({
          busy: false,
          duration: player.duration,
          status: player.isRunning ? 'Playing' : 'Ready to play',
          cancel: null,
        });
        if (mode === 'full') {
          set({ playing: true });
          await player.play(0);
          set({ duration: player.duration });
        }
      } catch (e) {
        set({
          busy: false,
          status: 'Stopped',
          error: e instanceof Error ? e.message : String(e),
          cancel: null,
        });
      }
    },

    async toggle() {
      const { doc } = get();
      if (!doc) return;
      if (doc.sentences[0]?.startTime === null) {
        await get().generate(get().generateMode);
        return;
      }
      if (player.renderedCount === 0) {
        await get().generate(get().generateMode);
        return;
      }
      await player.toggle();
      set({ playing: player.isRunning, duration: player.duration });
    },

    seekTime(t) {
      player.seek(t);
      rebuild(player.time(), player.duration);
    },

    async seekWord(wordIndex) {
      const { doc } = get();
      if (!doc) return;
      const w = doc.words[wordIndex];
      if (!w) return;
      const t = w.startTime;
      if (t === null) {
        // The word has not been rendered yet. Render up to it, then land there.
        set({ status: 'Rendering to that point', busy: true });
        await get().ensureEngine();
        const target = w.sentenceIndex;
        player.pause();
        player.setTimeline([]);
        for (let i = 0; i <= target; i++) {
          const chunk = await engine.synthesize(doc.sentences[i].text, get().voiceId, {
            speed: get().speed,
          });
          player.putSentence(i, chunk.samples, chunk.sampleRate);
          const seg = player.segments.find((x) => x.sentenceIndex === i);
          if (seg) distributeSentence(doc, i, seg.start, seg.start + seg.duration);
          set({ renderedCount: i + 1 });
        }
        set({ busy: false, status: 'Ready' });
        const wt = w.startTime ?? 0;
        set({ playing: true });
        await player.play(wt);
        return;
      }
      set({ playing: true });
      await player.play(t);
    },

    async stepSentence(delta) {
      const { doc, currentSentence } = get();
      if (!doc || doc.sentences.length === 0) return;
      const base = currentSentence?.index ?? 0;
      const next = Math.max(0, Math.min(doc.sentences.length - 1, base + delta));
      const s = doc.sentences[next];
      await get().seekWord(s.wordStart);
    },

    async stepParagraph(delta) {
      const { doc, currentSentence } = get();
      if (!doc || doc.sentences.length === 0) return;
      const base = currentSentence?.index ?? 0;
      const block = doc.sentences[base].blockIndex;
      let target = base;
      if (delta > 0) {
        while (target + 1 < doc.sentences.length &&
               doc.sentences[target + 1].blockIndex === block) target++;
        if (target + 1 < doc.sentences.length) target++;
      } else {
        let b = block;
        while (b > 0) {
          b -= 1;
          const first = doc.sentences.findIndex((x) => x.blockIndex === b);
          if (first >= 0) { target = first; break; }
        }
      }
      const s = doc.sentences[target];
      if (s) await get().seekWord(s.wordStart);
    },

    async exportAudio(format) {
      const { doc } = get();
      if (!doc) return;
      if (player.renderedCount === 0) {
        set({ status: 'Render everything before exporting', error: 'Switch to "Render all" first — export needs the whole document.' });
        return;
      }
      set({ busy: true, status: `Encoding ${format.toUpperCase()}` });
      try {
        const { chunks, sampleRate } = player.toExportChunks();
        const blob = format === 'wav'
          ? encodeWav(chunks, sampleRate)
          : await encodeMp3(chunks, sampleRate);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${doc.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'narrate'}.${format}`;
        a.click();
        URL.revokeObjectURL(url);
        set({ busy: false, status: `Exported ${format.toUpperCase()}` });
      } catch (e) {
        set({ busy: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    clearError: () => set({ error: null }),
  };
});

/** Read the initial view and reader mode from the URL hash. */
export function readHash(): { view?: MainView; readerMode?: ReaderMode } {
  if (typeof location === 'undefined') return {};
  const m = /^#\/(player|reader|library|work|models|voices|lab)(?:\/(page|focus))?$/.exec(
    location.hash,
  );
  if (!m) return {};
  return { view: m[1] as MainView, readerMode: m[2] as ReaderMode | undefined };
}

export { SENTENCE_GAP };
