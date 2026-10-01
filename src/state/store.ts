import { create } from 'zustand';
import type { Doc, Sentence, Word } from '../core/types';
import { distributeSentence, wordAtTime } from '../core/types';
import { parseDocument } from '../core/parse';
import { Player, encodeMp3, encodeWav, type Segment } from '../core/audio/player';
import type { ModelLoadProgress, TtsEngine } from '../core/tts/engine';
import { EDGE_PAD, SENTENCE_GAP } from '../core/tts/engine';
import { WebKokoroEngine } from '../core/tts/web';
import { DEFAULT_VOICE_ID, voiceById } from '../core/tts/voices';
import { beginBackgroundWork, endBackgroundWork } from '../core/background';
import { SAMPLE_DOC } from './sample';
import { storage, type LibraryEntry, type GenerationJob } from './persistence';

export type { LibraryEntry, GenerationJob } from './persistence';
export type MainView = 'player' | 'reader' | 'library' | 'work' | 'models' | 'voices' | 'lab' | 'settings';
export type ReaderMode = 'page' | 'focus';
export type GenerateMode = 'stream' | 'full';

interface State {
  library: LibraryEntry[];
  generationJobs: GenerationJob[];
  hydrated: boolean;
  activeDocId: string | null;
  selectedModel: string;
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
  hydrate: () => Promise<void>;
  openBuffer: (name: string, buf: ArrayBuffer) => Promise<boolean>;
  openLibraryDoc: (id: string) => Promise<void>;
  openSample: () => void;
  removeDoc: (id: string) => Promise<void>;
  setView: (v: MainView) => void;
  setReaderMode: (m: ReaderMode) => void;
  setGenerateMode: (m: GenerateMode) => void;
  setVoice: (id: string) => void;
  setSpeed: (s: number) => void;
  selectModel: (id: string) => Promise<void>;
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
interface Run {
  id: string; docId: string; doc: Doc; voiceId: string; speed: number; engine: TtsEngine;
  mode: GenerateMode; cancelled: boolean; playRequested: boolean; waiting: boolean;
  from: number; seekTarget: number | null; seekWordIndex: number | null;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const freshId = () => crypto.randomUUID();
function clearTiming(doc: Doc) {
  for (const sentence of doc.sentences) { sentence.startTime = null; sentence.endTime = null; }
  for (const word of doc.words) { word.startTime = null; word.endTime = null; }
}
function entryFor(doc: Doc, id: string): LibraryEntry {
  return { id, title: doc.title, sourceName: doc.sourceName ?? 'Sample', charCount: doc.charCount,
    wordCount: doc.words.length, minutes: Math.max(1, Math.round(doc.words.length / 150)),
    addedAt: Date.now(), renderedCount: 0, totalSentences: doc.sentences.length, audioReady: false };
}

export const useNarrate = create<State & Actions>((set, get) => {
  const player = new Player();
  let activeRun: Run | null = null;
  let production: Promise<void> = Promise.resolve();
  let hydration: Promise<void> | null = null;
  let selectionEpoch = 0;
  const report = (error: unknown) => set({ error: message(error) });
  const preferences = () => storage.savePreferences({ voiceId: get().voiceId, speed: get().speed,
    selectedModel: get().selectedModel, generateMode: get().generateMode }).catch(report);
  const updateJob = async (id: string, patch: Partial<GenerationJob>) => {
    set(state => ({ generationJobs: state.generationJobs.map(job => job.id === id ? { ...job, ...patch } : job) }));
    await storage.saveJobs(get().generationJobs);
  };
  const updateEntry = async (id: string, count: number, total: number) => {
    set(state => ({ library: state.library.map(entry => entry.id === id ? {
      ...entry, renderedCount: count, totalSentences: total, audioReady: count === total && total > 0,
    } : entry) }));
    await storage.saveLibrary(get().library);
  };
  const cancelRun = () => {
    const run = activeRun;
    if (!run || run.cancelled) return;
    run.cancelled = true; run.playRequested = false;
    get().player.pause(); activeRun = null;
    set({ busy: false, playing: false, cancel: null, status: 'Stopped · saved audio kept' });
    void updateJob(run.id, { status: 'cancelled', finishedAt: Date.now() }).catch(report);
  };
  const current = (run: Run) => !run.cancelled && activeRun === run && get().activeDocId === run.docId;
  const rebuild = (time: number, duration: number) => {
    const doc = get().doc;
    if (!doc) return;
    const word = wordAtTime(doc, time);
    const sentence = word ? doc.sentences[word.sentenceIndex] : null;
    set({ time, duration, currentWord: word, currentSentence: sentence, targetSentence: sentence?.index ?? 0 });
  };
  player.attach({
    onTime: rebuild,
    onEnd: () => {
      if (activeRun && current(activeRun) && activeRun.playRequested) {
        activeRun.waiting = true; activeRun.from = get().player.time();
        set({ playing: false, status: 'Preparing the next sentence' });
      } else set({ playing: false, status: 'Finished' });
    },
    onError: report,
  });
  const restoreAudio = async (epoch: number) => {
    const { activeDocId, doc, voiceId, speed, engine, player } = get();
    if (!activeDocId || !doc) return;
    const key = storage.narrationKey(activeDocId, engine.id, voiceId, speed);
    const segments = await storage.loadNarration(key);
    if (epoch !== selectionEpoch || get().activeDocId !== activeDocId) return;
    clearTiming(doc); player.setTimeline(segments);
    for (const segment of player.segments) distributeSentence(doc, segment.sentenceIndex, segment.start, segment.start + segment.duration);
    set({ doc: { ...doc }, time: 0, duration: player.duration, renderedCount: player.renderedCount,
      currentWord: null, currentSentence: null, targetSentence: 0, playing: false,
      status: segments.length === doc.sentences.length ? 'Saved audio ready' : segments.length ? 'Saved progress ready' : 'Ready' });
    await updateEntry(activeDocId, player.renderedCount, doc.sentences.length);
  };
  const render = async (run: Run) => {
    if (!current(run)) return;
    let background = false;
    try {
      await storage.saveJobs(get().generationJobs);
      const key = storage.narrationKey(run.docId, run.engine.id, run.voiceId, run.speed);
      const saved = await storage.loadNarration(key);
      if (!current(run)) return;
      const player = get().player;
      clearTiming(run.doc); player.setTimeline(saved);
      for (const segment of player.segments) distributeSentence(run.doc, segment.sentenceIndex, segment.start, segment.start + segment.duration);
      set({ renderedCount: saved.length, duration: player.duration, doc: { ...run.doc } });
      await updateJob(run.id, { completedSentences: saved.length });
      if (!current(run)) return;
      if (saved.length < run.doc.sentences.length) {
        await beginBackgroundWork(`Rendering ${run.doc.title}`); background = true;
        if (!current(run)) return;
        await get().ensureEngine();
        if (!current(run)) return;
        if (!run.engine.ready) throw new Error(get().engineError ?? 'The model could not be loaded.');
      }
      const startPlayback = async () => {
        if (!current(run) || !run.playRequested || player.isRunning) return;
        if (run.seekTarget !== null && !player.hasSentence(run.seekTarget)) return;
        const seek = run.seekWordIndex === null ? null : run.doc.words[run.seekWordIndex]?.startTime;
        const from = seek ?? run.from;
        run.seekTarget = null; run.seekWordIndex = null; run.waiting = false;
        await player.play(Math.min(from, Math.max(0, player.duration - EDGE_PAD)));
        if (current(run)) set({ playing: player.isRunning });
      };
      if (run.mode === 'stream' && saved.length >= Math.min(2, run.doc.sentences.length)) await startPlayback();
      for (let index = saved.length; index < run.doc.sentences.length; index++) {
        if (!current(run)) return;
        const chunk = await run.engine.synthesize(run.doc.sentences[index].text, run.voiceId, { speed: run.speed });
        if (!current(run)) return;
        if (!chunk.samples.length || !Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) throw new Error('The model returned empty or invalid audio.');
        const previous = player.segments.at(-1);
        const segment: Segment = { sentenceIndex: index, samples: chunk.samples, sampleRate: chunk.sampleRate,
          duration: chunk.samples.length / chunk.sampleRate,
          start: previous ? previous.start + previous.duration + SENTENCE_GAP : EDGE_PAD };
        await storage.saveSegment(key, segment);
        if (!current(run)) return;
        player.putSentence(index, chunk.samples, chunk.sampleRate);
        const placed = player.segments.find(s => s.sentenceIndex === index)!;
        distributeSentence(run.doc, index, placed.start, placed.start + placed.duration);
        set({ doc: { ...run.doc }, renderedCount: index + 1, duration: player.duration,
          status: `Saving narration ${index + 1} / ${run.doc.sentences.length}` });
        await updateEntry(run.docId, index + 1, run.doc.sentences.length);
        await updateJob(run.id, { completedSentences: index + 1 });
        if (!current(run)) return;
        if (run.mode === 'stream' && (run.waiting || index + 1 >= Math.min(2, run.doc.sentences.length))) await startPlayback();
      }
      if (!current(run)) return;
      await updateEntry(run.docId, player.renderedCount, run.doc.sentences.length);
      await updateJob(run.id, { status: 'completed', finishedAt: Date.now(), completedSentences: player.renderedCount });
      if (!current(run)) return;
      if (run.mode === 'stream') await startPlayback();
      if (current(run)) set({ busy: false, cancel: null, duration: player.duration,
        status: player.isRunning ? 'Playing · audio saved' : 'Saved audio ready' });
    } catch (error) {
      if (!current(run)) return;
      run.playRequested = false; get().player.pause();
      set({ busy: false, playing: false, cancel: null, status: 'Generation stopped', error: message(error) });
      await updateJob(run.id, { status: 'failed', finishedAt: Date.now(), error: message(error) }).catch(report);
    } finally {
      if (activeRun === run) activeRun = null;
      if (background) await endBackgroundWork().catch(report);
    }
  };
  return {
    library: [], generationJobs: [], hydrated: false, activeDocId: null, selectedModel: 'kokoro-q8',
    doc: null, view: 'library', readerMode: 'page', generateMode: 'stream',
    voiceId: DEFAULT_VOICE_ID, speed: 1, engine: new WebKokoroEngine(), player,
    engineReady: false, engineLoading: false, modelProgress: null, engineError: null,
    playing: false, time: 0, duration: 0, renderedCount: 0, targetSentence: 0,
    currentWord: null, currentSentence: null, status: 'Ready', error: null, busy: false, cancel: null,
    async hydrate() {
      if (get().hydrated) return;
      if (hydration) return hydration;
      hydration = (async () => {
        try {
          const { library, jobs, preferences: prefs } = await storage.load();
          const generationJobs = jobs.map(job => job.status === 'running' ? { ...job, status: 'interrupted' as const, finishedAt: Date.now() } : job);
          const selectedModel = prefs?.selectedModel ?? get().selectedModel;
          const changedModel = selectedModel !== get().selectedModel;
          set({ library, generationJobs, hydrated: true, view: 'library', selectedModel,
            engine: changedModel ? new WebKokoroEngine(selectedModel) : get().engine,
            voiceId: prefs?.voiceId && voiceById(prefs.voiceId) ? prefs.voiceId : DEFAULT_VOICE_ID,
            speed: prefs?.speed ?? 1, generateMode: prefs?.generateMode ?? 'stream' });
          if (jobs.some(job => job.status === 'running')) await storage.saveJobs(generationJobs);
          if (typeof navigator !== 'undefined' && navigator.storage?.persist) void navigator.storage.persist().catch(() => undefined);
        } catch (error) { set({ hydrated: true, error: `Could not open local storage: ${message(error)}` }); }
      })();
      try { await hydration; } finally { hydration = null; }
    },
    async openBuffer(name, buffer) {
      cancelRun(); const epoch = ++selectionEpoch;
      set({ busy: true, status: `Reading ${name}`, error: null });
      try {
        if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength) throw new Error('That file is empty. Choose a file containing readable text.');
        const doc = await parseDocument(name, buffer);
        if (!doc.words.length) throw new Error('No readable text found. Scanned PDFs need text recognition before import.');
        if (epoch !== selectionEpoch) return false;
        const id = freshId(); await storage.saveDocument(id, doc);
        if (epoch !== selectionEpoch) return false;
        const library = [entryFor(doc, id), ...get().library]; await storage.saveLibrary(library);
        if (epoch !== selectionEpoch) return false;
        get().player.setTimeline([]);
        set({ doc, activeDocId: id, library, busy: false, status: 'Ready', playing: false,
          time: 0, duration: 0, renderedCount: 0, currentWord: null, currentSentence: null, targetSentence: 0 });
        return true;
      } catch (error) {
        if (epoch === selectionEpoch) set({ busy: false, error: message(error), status: 'Ready' });
        return false;
      }
    },
    async openLibraryDoc(id) {
      cancelRun(); const epoch = ++selectionEpoch;
      set({ busy: true, status: 'Opening saved document', error: null });
      try {
        const doc = await storage.loadDocument(id);
        if (!doc) throw new Error('The saved document could not be found. Import the original file again.');
        if (epoch !== selectionEpoch) return;
        get().player.setTimeline([]);
        set({ doc, activeDocId: id, renderedCount: 0, time: 0, duration: 0, playing: false,
          currentWord: null, currentSentence: null, targetSentence: 0 });
        await restoreAudio(epoch);
        if (epoch === selectionEpoch) set({ busy: false });
      } catch (error) { if (epoch === selectionEpoch) set({ busy: false, error: message(error) }); }
    },
    openSample() {
      const existing = get().library.find(entry => entry.sourceName === 'Narrate sample.md');
      if (existing) { void get().openLibraryDoc(existing.id); return; }
      const sample = SAMPLE_DOC();
      void get().openBuffer('Narrate sample.md', new TextEncoder().encode(sample.plain).buffer);
    },
    async removeDoc(id) {
      if (get().activeDocId === id) {
        cancelRun(); ++selectionEpoch; get().player.setTimeline([]);
        set({ doc: null, activeDocId: null, playing: false, time: 0, duration: 0, renderedCount: 0,
          currentWord: null, currentSentence: null, busy: false, view: 'library' });
      }
      try {
        await storage.removeDocument(id);
        const library = get().library.filter(entry => entry.id !== id); await storage.saveLibrary(library); set({ library });
      } catch (error) { report(error); }
    },
    setView(view) {
      if ((view === 'player' || view === 'reader') && !get().doc) view = 'library';
      set({ view }); if (typeof location !== 'undefined') history.replaceState(null, '', `#/${view}`);
    },
    setReaderMode(readerMode) {
      set({ readerMode }); if (typeof location !== 'undefined') history.replaceState(null, '', `#/reader/${readerMode}`);
    },
    setGenerateMode(generateMode) { set({ generateMode }); void preferences(); },
    setVoice(voiceId) {
      if (!voiceById(voiceId) || voiceId === get().voiceId) return;
      cancelRun(); const epoch = ++selectionEpoch; get().player.setTimeline([]);
      set({ voiceId, playing: false, renderedCount: 0, time: 0, duration: 0 });
      void preferences(); void restoreAudio(epoch).catch(report);
    },
    setSpeed(speed) {
      if (!Number.isFinite(speed)) return;
      speed = Math.max(0.5, Math.min(2, speed)); if (speed === get().speed) return;
      cancelRun(); const epoch = ++selectionEpoch; get().player.setTimeline([]);
      set({ speed, playing: false, renderedCount: 0, time: 0, duration: 0 });
      void preferences(); void restoreAudio(epoch).catch(report);
    },
    async selectModel(selectedModel) {
      if (!['kokoro-q4', 'kokoro-q8', 'kokoro-fp32'].includes(selectedModel) || selectedModel === get().selectedModel) return;
      cancelRun(); const epoch = ++selectionEpoch;
      get().player.setTimeline([]);
      set({ selectedModel, engine: new WebKokoroEngine(selectedModel), engineReady: false, engineLoading: false,
        modelProgress: null, engineError: null, playing: false, renderedCount: 0, time: 0, duration: 0 });
      await preferences(); await restoreAudio(epoch);
    },
    async ensureEngine() {
      const engine = get().engine;
      if (engine.ready) { set({ engineReady: true }); return; }
      set({ engineLoading: true, engineError: null, status: 'Loading local voice model' });
      try {
        await engine.load(progress => { if (get().engine === engine) set({ modelProgress: progress }); });
        if (get().engine === engine) set({ engineReady: true, engineLoading: false, status: 'Model ready' });
      } catch (error) {
        if (get().engine === engine) set({ engineReady: false, engineLoading: false, engineError: message(error), error: message(error), status: 'Model failed to load' });
      }
    },
    async generate(mode) {
      const { doc, activeDocId, voiceId, speed, engine, time } = get();
      if (!doc || !activeDocId) return;
      cancelRun();
      const run: Run = { id: freshId(), docId: activeDocId, doc, voiceId, speed, engine, mode,
        cancelled: false, playRequested: mode === 'stream', waiting: false, from: time, seekTarget: null, seekWordIndex: null };
      const job: GenerationJob = { id: run.id, docId: activeDocId, title: doc.title, voiceId, speed, mode,
        status: 'running', startedAt: Date.now(), completedSentences: get().renderedCount, totalSentences: doc.sentences.length };
      activeRun = run; get().player.pause();
      set(state => ({ busy: true, playing: false, error: null, cancel: cancelRun, generateMode: mode,
        status: mode === 'full' ? 'Rendering all · saving locally' : 'Preparing stream', generationJobs: [job, ...state.generationJobs] }));
      const task = production.catch(() => undefined).then(() => render(run)); production = task; await task;
    },
    async toggle() {
      const { doc, player, playing, renderedCount } = get(); if (!doc) return;
      if (activeRun && current(activeRun)) {
        activeRun.playRequested = !playing;
        if (playing) { player.pause(); activeRun.from = player.time(); set({ playing: false }); }
        else if (renderedCount > 0) { await player.play(get().time); set({ playing: player.isRunning }); }
        return;
      }
      if (renderedCount < doc.sentences.length) { await get().generate(get().generateMode); return; }
      await player.toggle(); set({ playing: player.isRunning, duration: player.duration });
    },
    seekTime(time) {
      if (!Number.isFinite(time)) return;
      if (activeRun) { activeRun.from = time; activeRun.seekTarget = null; activeRun.seekWordIndex = null; }
      get().player.seek(time); rebuild(get().player.time(), get().player.duration);
    },
    async seekWord(index) {
      const { doc, player } = get(); const word = doc?.words[index]; if (!doc || !word) return;
      if (word.startTime === null || !player.hasSentence(word.sentenceIndex)) {
        if (activeRun && current(activeRun)) {
          player.pause(); activeRun.seekTarget = word.sentenceIndex; activeRun.seekWordIndex = index;
          activeRun.playRequested = true; activeRun.waiting = true; set({ playing: false, status: 'Preparing audio for that word' }); return;
        }
        const task = get().generate('stream');
        if (activeRun) { activeRun.seekTarget = word.sentenceIndex; activeRun.seekWordIndex = index; activeRun.waiting = true; }
        await task; return;
      }
      if (activeRun) { activeRun.playRequested = true; activeRun.from = word.startTime; activeRun.seekTarget = null; activeRun.seekWordIndex = null; }
      try { await player.play(word.startTime); rebuild(player.time(), player.duration); set({ playing: player.isRunning }); }
      catch (error) { set({ playing: false }); report(error); }
    },
    async stepSentence(delta) {
      const { doc, currentSentence } = get(); if (!doc?.sentences.length) return;
      const index = Math.max(0, Math.min(doc.sentences.length - 1, (currentSentence?.index ?? 0) + delta));
      await get().seekWord(doc.sentences[index].wordStart);
    },
    async stepParagraph(delta) {
      const { doc, currentSentence } = get(); if (!doc?.sentences.length) return;
      const base = currentSentence?.index ?? 0; const block = doc.sentences[base].blockIndex;
      const candidates = doc.sentences.filter(sentence => delta > 0 ? sentence.blockIndex > block : sentence.blockIndex < block);
      const target = delta > 0 ? candidates[0] : candidates.length ? doc.sentences.find(sentence => sentence.blockIndex === candidates.at(-1)!.blockIndex) : doc.sentences[0];
      if (target) await get().seekWord(target.wordStart);
    },
    async exportAudio(format) {
      const { doc, player, renderedCount } = get(); if (!doc) return;
      if (renderedCount !== doc.sentences.length || !doc.sentences.length) {
        set({ error: 'Finish rendering the entire document before exporting. Saved progress will be reused.', status: 'More audio needed' }); return;
      }
      if (get().busy) return;
      set({ busy: true, status: `Encoding ${format.toUpperCase()}`, error: null });
      try {
        const { chunks, sampleRate } = player.toExportChunks();
        const blob = format === 'wav' ? encodeWav(chunks, sampleRate) : await encodeMp3(chunks, sampleRate);
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = `${doc.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'narrate'}.${format}`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); set({ busy: false, status: `Exported ${format.toUpperCase()}` });
      } catch (error) { set({ busy: false, error: message(error), status: 'Export failed' }); }
    },
    clearError: () => set({ error: null }),
  };
});
export function readHash(): { view?: MainView; readerMode?: ReaderMode } {
  if (typeof location === 'undefined') return {};
  const match = /^#\/(player|reader|library|work|models|voices|lab|settings)(?:\/(page|focus))?$/.exec(location.hash);
  return match ? { view: match[1] as MainView, readerMode: match[2] as ReaderMode | undefined } : {};
}
export { SENTENCE_GAP };
