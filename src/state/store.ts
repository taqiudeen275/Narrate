import { create } from 'zustand';
import type { Doc, Sentence, Word } from '../core/types';
import { distributeSentence, wordAtTime } from '../core/types';
import { parseDocument } from '../core/parse';
import { Player, encodeMp3, encodeWav, type Segment } from '../core/audio/player';
import { saveAudioExport } from '../core/audio/export';
import type { ModelLoadProgress, TtsEngine } from '../core/tts/engine';
import { EDGE_PAD, SENTENCE_GAP } from '../core/tts/engine';
import { WebKokoroEngine } from '../core/tts/web';
import { DEFAULT_VOICE_ID, voiceById } from '../core/tts/voices';
import { DEFAULT_MODEL_ID, MODEL_VARIANTS } from '../core/tts/downloads';
import { beginBackgroundWork, endBackgroundWork } from '../core/background';
import { loadDeviceMeasurements, recordGenerationMeasurement } from '../core/tts/device';
import { SAMPLE_DOC } from './sample';
import { storage, type LibraryEntry, type GenerationJob, type NarrationProfile } from './persistence';
import { APP_VERSION } from '../version';

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
  backendPreference: 'auto' | 'wasm';
  /** Identity of the PCM currently loaded for playback, independent of generation. */
  audioProfile: NarrationProfile | null;
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
  /** Playback intent stays active while a stream waits for more audio. */
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
  openSample: () => Promise<boolean>;
  removeDoc: (id: string) => Promise<void>;
  setView: (v: MainView) => void;
  setReaderMode: (m: ReaderMode) => void;
  setGenerateMode: (m: GenerateMode) => void;
  setVoice: (id: string) => void;
  setSpeed: (s: number) => void;
  selectModel: (id: string) => Promise<void>;
  setBackendPreference: (preference: 'auto' | 'wasm') => Promise<void>;
  ensureEngine: () => Promise<void>;
  generate: (mode: GenerateMode, options?: { fresh?: boolean }) => Promise<void>;
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
  epoch: number; freshAudio: boolean; replacementStarted: boolean; previousProfile: NarrationProfile | null;
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
    selectedModel: get().selectedModel, generateMode: get().generateMode,
    backendPreference: get().backendPreference }).catch(report);
  const updateJob = async (id: string, patch: Partial<GenerationJob>) => {
    set(state => ({ generationJobs: state.generationJobs.map(job => job.id === id ? { ...job, ...patch } : job) }));
    await storage.saveJobs(get().generationJobs);
  };
  const updateEntry = async (id: string, count: number, total: number, profile: NarrationProfile) => {
    set(state => ({ library: state.library.map(entry => {
      if (entry.id !== id || !count && entry.narration) return entry;
      return { ...entry, renderedCount: count, totalSentences: total, audioReady: count === total && total > 0,
        narration: count ? { ...profile } : undefined };
    }) }));
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
  const saveAndOpenDocument = async (doc: Doc, epoch: number): Promise<boolean> => {
    const id = freshId(); await storage.saveDocument(id, doc);
    if (epoch !== selectionEpoch) return false;
    const library = [entryFor(doc, id), ...get().library];
    set({ library });
    await storage.saveLibrary(library);
    if (epoch !== selectionEpoch) return false;
    get().player.setTimeline([]);
    set({ doc, activeDocId: id, audioProfile: null, busy: false, status: 'Ready', playing: false,
      time: 0, duration: 0, renderedCount: 0, currentWord: null, currentSentence: null, targetSentence: 0 });
    return true;
  };
  const startPlayback = async (run: Run) => {
    const player = get().player;
    if (!current(run) || !run.playRequested || player.isRunning) return;
    if (run.seekTarget !== null && !player.hasSentence(run.seekTarget)) {
      run.waiting = true;
      set({ playing: true, status: 'Preparing audio for that word' });
      return;
    }
    const seek = run.seekWordIndex === null ? null : run.doc.words[run.seekWordIndex]?.startTime;
    const requested = seek ?? run.from;
    const from = player.renderedCount === run.doc.sentences.length && requested >= player.duration ? 0 : requested;
    if (!player.renderedCount || from >= player.duration) {
      run.waiting = true;
      set({ playing: true, status: 'Preparing the next sentence' });
      return;
    }
    run.seekTarget = null; run.seekWordIndex = null; run.waiting = false; run.from = from;
    await player.play(from);
    if (current(run)) set({ playing: run.playRequested });
  };
  player.attach({
    onTime: rebuild,
    onEnd: () => {
      if (activeRun && current(activeRun) && activeRun.playRequested && get().player.renderedCount < activeRun.doc.sentences.length) {
        activeRun.waiting = true; activeRun.from = get().player.time();
        set({ playing: true, status: 'Preparing the next sentence' });
      } else {
        if (activeRun) { activeRun.playRequested = false; activeRun.waiting = false; }
        set({ playing: false, status: 'Finished' });
      }
    },
    onError: report,
  });
  const restoreAudio = async (epoch: number, savedProfile?: NarrationProfile) => {
    const { activeDocId, doc, voiceId, speed, engine, player } = get();
    if (!activeDocId || !doc) return;
    const profile = savedProfile ?? { modelId: engine.id, voiceId, speed };
    const key = storage.narrationKey(activeDocId, profile.modelId, profile.voiceId, profile.speed);
    const segments = await storage.loadNarration(key);
    if (epoch !== selectionEpoch || get().activeDocId !== activeDocId) return;
    clearTiming(doc); player.setTimeline(segments);
    for (const segment of player.segments) distributeSentence(doc, segment.sentenceIndex, segment.start, segment.start + segment.duration);
    set({ doc: { ...doc }, audioProfile: segments.length ? { ...profile } : null,
      time: 0, duration: player.duration, renderedCount: player.renderedCount,
      currentWord: null, currentSentence: null, targetSentence: 0, playing: false,
      status: segments.length === doc.sentences.length ? 'Saved audio ready' : segments.length ? 'Saved progress ready' : 'Ready' });
    await updateEntry(activeDocId, player.renderedCount, doc.sentences.length, profile);
  };
  const render = async (run: Run) => {
    if (!current(run)) return;
    let background = false;
    try {
      await storage.saveJobs(get().generationJobs);
      const key = storage.narrationKey(run.docId, run.engine.id, run.voiceId, run.speed);
      const profile = { modelId: run.engine.id, voiceId: run.voiceId, speed: run.speed };
      const saved = run.freshAudio ? [] : await storage.loadNarration(key);
      if (!current(run)) return;
      const player = get().player;
      clearTiming(run.doc); player.setTimeline(saved);
      for (const segment of player.segments) distributeSentence(run.doc, segment.sentenceIndex, segment.start, segment.start + segment.duration);
      set({ audioProfile: saved.length ? profile : null, renderedCount: saved.length, duration: player.duration, doc: { ...run.doc } });
      await updateJob(run.id, { completedSentences: saved.length });
      if (!current(run)) return;
      if (saved.length < run.doc.sentences.length) {
        await beginBackgroundWork(`Rendering ${run.doc.title}`); background = true;
        if (!current(run)) return;
        await get().ensureEngine();
        if (!current(run)) return;
        if (!run.engine.ready) throw new Error(get().engineError ?? 'The model could not be loaded.');
        await updateJob(run.id, { runtime: run.engine.runtime ? { ...run.engine.runtime } : undefined });
      }
      if (run.mode === 'stream' && saved.length >= Math.min(2, run.doc.sentences.length)) await startPlayback(run);
      for (let index = saved.length; index < run.doc.sentences.length; index++) {
        if (!current(run)) return;
        const synthesisStarted = performance.now();
        const chunk = await run.engine.synthesize(run.doc.sentences[index].text, run.voiceId, { speed: run.speed });
        if (!current(run)) return;
        if (!chunk.samples.length || !Number.isFinite(chunk.sampleRate) || chunk.sampleRate <= 0) throw new Error('The model returned empty or invalid audio.');
        void recordGenerationMeasurement(run.engine.id, chunk.samples.length / chunk.sampleRate,
          performance.now() - synthesisStarted, run.speed).catch(() => undefined);
        const previous = player.segments.at(-1);
        const segment: Segment = { sentenceIndex: index, samples: chunk.samples, sampleRate: chunk.sampleRate,
          duration: chunk.samples.length / chunk.sampleRate,
          start: previous ? previous.start + previous.duration + SENTENCE_GAP : EDGE_PAD };
        await storage.saveSegment(key, segment);
        run.replacementStarted = true;
        if (!current(run)) return;
        player.putSentence(index, chunk.samples, chunk.sampleRate);
        const placed = player.segments.find(s => s.sentenceIndex === index)!;
        distributeSentence(run.doc, index, placed.start, placed.start + placed.duration);
        set({ doc: { ...run.doc }, audioProfile: profile, renderedCount: index + 1, duration: player.duration,
          status: `Saving narration ${index + 1} / ${run.doc.sentences.length}` });
        await updateEntry(run.docId, index + 1, run.doc.sentences.length, profile);
        await updateJob(run.id, { completedSentences: index + 1,
          runtime: run.engine.runtime ? { ...run.engine.runtime } : undefined });
        if (!current(run)) return;
        if (run.playRequested && (run.waiting || index + 1 >= Math.min(2, run.doc.sentences.length))) await startPlayback(run);
      }
      if (!current(run)) return;
      await updateEntry(run.docId, player.renderedCount, run.doc.sentences.length, profile);
      if (!current(run)) return;
      await updateJob(run.id, { status: 'completed', finishedAt: Date.now(), completedSentences: player.renderedCount });
      if (!current(run)) return;
      if (run.playRequested) await startPlayback(run);
      if (current(run)) set({ busy: false, cancel: null, duration: player.duration,
        status: player.isRunning ? 'Playing · audio saved' : 'Saved audio ready' });
    } catch (error) {
      if (!current(run)) return;
      run.playRequested = false; get().player.pause();
      set({ busy: false, playing: false, cancel: null, status: 'Generation stopped', error: message(error) });
      await updateJob(run.id, { status: 'failed', finishedAt: Date.now(), error: message(error) }).catch(report);
    } finally {
      if (activeRun === run) activeRun = null;
      // Before the first successful replacement, the stored take is untouched.
      // Restore it after failure/Stop, unless another document or run took over.
      if (run.freshAudio && !run.replacementStarted && run.epoch === selectionEpoch
        && get().activeDocId === run.docId && !activeRun) {
        const status = get().status;
        await restoreAudio(run.epoch, run.previousProfile ?? undefined).catch(report);
        if (run.epoch === selectionEpoch) set({ status });
      }
      if (background) await endBackgroundWork().catch(report);
    }
  };
  return {
    library: [], generationJobs: [], hydrated: false, activeDocId: null, selectedModel: DEFAULT_MODEL_ID, backendPreference: 'auto', audioProfile: null,
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
          await loadDeviceMeasurements().catch(() => undefined);
          const generationJobs = jobs.map(job => job.status === 'running' ? { ...job, status: 'interrupted' as const, finishedAt: Date.now() } : job);
          const selectedModel = MODEL_VARIANTS.some(model => model.cacheId === prefs?.selectedModel)
            ? prefs!.selectedModel : DEFAULT_MODEL_ID;
          const backendPreference = prefs?.backendPreference === 'wasm' ? 'wasm' : 'auto';
          const changedEngine = selectedModel !== get().selectedModel || backendPreference !== get().backendPreference;
          set({ library, generationJobs, hydrated: true, view: 'library', selectedModel, backendPreference,
            engine: changedEngine ? new WebKokoroEngine(selectedModel, { backendPreference }) : get().engine,
            voiceId: typeof prefs?.voiceId === 'string' && voiceById(prefs.voiceId) ? prefs.voiceId : DEFAULT_VOICE_ID,
            speed: Number.isFinite(prefs?.speed) && prefs!.speed >= 0.5 && prefs!.speed <= 2 ? prefs!.speed : 1,
            generateMode: prefs?.generateMode === 'full' ? 'full' : 'stream' });
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
        const parsed = await parseDocument(name, buffer);
        const doc = { ...parsed, sourceName: parsed.sourceName ?? name };
        if (!doc.words.length) throw new Error('No readable text found. Scanned PDFs need text recognition before import.');
        if (epoch !== selectionEpoch) return false;
        return await saveAndOpenDocument(doc, epoch);
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
        const saved = get().library.find(entry => entry.id === id)?.narration;
        const validSaved = saved && voiceById(saved.voiceId) && Number.isFinite(saved.speed) && saved.speed >= 0.5 && saved.speed <= 2
          && (MODEL_VARIANTS.some(model => model.cacheId === saved.modelId) || saved.modelId === get().engine.id);
        if (validSaved) {
          set({ voiceId: saved.voiceId, speed: saved.speed });
          void preferences();
        }
        get().player.setTimeline([]);
        set({ doc, activeDocId: id, audioProfile: null, renderedCount: 0, time: 0, duration: 0, playing: false,
          currentWord: null, currentSentence: null, targetSentence: 0 });
        await restoreAudio(epoch, validSaved ? saved : undefined);
        if (epoch === selectionEpoch) set({ busy: false });
      } catch (error) { if (epoch === selectionEpoch) set({ busy: false, error: message(error) }); }
    },
    async openSample() {
      const existing = get().library.find(entry => entry.sourceName === 'Narrate sample.md');
      if (existing) {
        await get().openLibraryDoc(existing.id);
        return get().activeDocId === existing.id && !!get().doc && !get().error;
      }
      cancelRun(); const epoch = ++selectionEpoch;
      set({ busy: true, status: 'Opening sample', error: null });
      try { return await saveAndOpenDocument(SAMPLE_DOC(), epoch); }
      catch (error) {
        if (epoch === selectionEpoch) set({ busy: false, error: message(error), status: 'Ready' });
        return false;
      }
    },
    async removeDoc(id) {
      set(state => ({ library: state.library.filter(entry => entry.id !== id) }));
      if (get().activeDocId === id) {
        cancelRun(); ++selectionEpoch; get().player.setTimeline([]);
        set({ doc: null, activeDocId: null, audioProfile: null, playing: false, time: 0, duration: 0, renderedCount: 0,
          currentWord: null, currentSentence: null, busy: false, view: 'library' });
      }
      try {
        await storage.removeDocument(id);
        await storage.saveLibrary(get().library);
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
      set({ voiceId, audioProfile: null, playing: false, renderedCount: 0, time: 0, duration: 0 });
      void preferences(); void restoreAudio(epoch).catch(report);
    },
    setSpeed(speed) {
      if (!Number.isFinite(speed)) return;
      speed = Math.max(0.5, Math.min(2, speed)); if (speed === get().speed) return;
      cancelRun(); const epoch = ++selectionEpoch; get().player.setTimeline([]);
      set({ speed, audioProfile: null, playing: false, renderedCount: 0, time: 0, duration: 0 });
      void preferences(); void restoreAudio(epoch).catch(report);
    },
    async selectModel(selectedModel) {
      if (!['kokoro-q4', 'kokoro-q8', 'kokoro-fp32'].includes(selectedModel) || selectedModel === get().selectedModel) return;
      cancelRun(); const epoch = ++selectionEpoch;
      const oldEngine = get().engine;
      void production.catch(() => undefined).then(() => oldEngine.dispose());
      get().player.setTimeline([]);
      set({ selectedModel, audioProfile: null, engine: new WebKokoroEngine(selectedModel, { backendPreference: get().backendPreference }), engineReady: false, engineLoading: false,
        modelProgress: null, engineError: null, playing: false, renderedCount: 0, time: 0, duration: 0 });
      await preferences(); await restoreAudio(epoch);
    },
    async setBackendPreference(backendPreference) {
      if (!['auto', 'wasm'].includes(backendPreference) || backendPreference === get().backendPreference) return;
      cancelRun(); ++selectionEpoch;
      const oldEngine = get().engine;
      void production.catch(() => undefined).then(() => oldEngine.dispose());
      get().player.pause();
      set({ backendPreference, engine: new WebKokoroEngine(get().selectedModel, { backendPreference }),
        engineReady: false, engineLoading: false, modelProgress: null, engineError: null, playing: false,
        status: 'Generation setting updated · saved audio kept' });
      await preferences();
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
    async generate(mode, options) {
      const { doc, activeDocId, voiceId, speed, engine, time, audioProfile, renderedCount } = get();
      if (!doc || !activeDocId) return;
      cancelRun();
      const epoch = ++selectionEpoch;
      const freshAudio = options?.fresh === true;
      const run: Run = { id: freshId(), docId: activeDocId, doc, voiceId, speed, engine, mode,
        cancelled: false, playRequested: mode === 'stream', waiting: false, from: freshAudio ? 0 : time, seekTarget: null, seekWordIndex: null,
        epoch, freshAudio, replacementStarted: false, previousProfile: audioProfile };
      const sameAudio = audioProfile?.modelId === engine.id && audioProfile.voiceId === voiceId && audioProfile.speed === speed;
      const job: GenerationJob = { id: run.id, docId: activeDocId, title: doc.title, voiceId, modelId: engine.id,
        requestedModelId: get().selectedModel, appVersion: APP_VERSION, speed, mode,
        freshAudio, status: 'running', startedAt: Date.now(), completedSentences: !freshAudio && sameAudio ? renderedCount : 0, totalSentences: doc.sentences.length };
      activeRun = run; get().player.pause();
      set(state => ({ busy: true, playing: run.playRequested, error: null, cancel: cancelRun, generateMode: mode,
        status: mode === 'full' ? 'Rendering all · saving locally' : 'Preparing stream', generationJobs: [job, ...state.generationJobs] }));
      const task = production.catch(() => undefined).then(() => render(run)); production = task; await task;
    },
    async toggle() {
      const { doc, player, renderedCount, audioProfile, engine } = get(); if (!doc) return;
      if (activeRun && current(activeRun)) {
        const run = activeRun;
        run.playRequested = !run.playRequested;
        if (!run.playRequested) {
          player.pause(); run.from = player.time(); run.waiting = false;
          set({ playing: false, status: 'Paused · rendering continues' });
        } else {
          run.from = player.time(); set({ playing: true });
          try { await startPlayback(run); }
          catch (error) { run.playRequested = false; set({ playing: false }); report(error); }
        }
        return;
      }
      if (renderedCount < doc.sentences.length && (!audioProfile || audioProfile.modelId === engine.id)) {
        await get().generate(get().generateMode); return;
      }
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
          activeRun.playRequested = true; activeRun.waiting = true; set({ playing: true, status: 'Preparing audio for that word' }); return;
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
        const filename = `${doc.title.replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'narrate'}.${format}`;
        set({ status: 'Choose where to save your audio' });
        const saved = await saveAudioExport(blob, filename);
        set({ busy: false, status: saved ? `Exported ${format.toUpperCase()}` : 'Export cancelled · saved audio kept' });
      } catch (error) { set({ busy: false, error: message(error), status: 'Export failed' }); }
    },
    clearError: () => set({ error: null }),
  };
});
export { SENTENCE_GAP };
