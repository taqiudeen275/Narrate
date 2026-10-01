import { get, set, setMany, del, keys } from 'idb-keyval';
import type { Doc } from '../core/types';
import type { Segment } from '../core/audio/player';
import type { KokoroRuntimeInfo } from '../core/tts/worker-types';

export interface NarrationProfile { modelId: string; voiceId: string; speed: number }

export interface LibraryEntry {
  id: string;
  title: string;
  sourceName: string;
  charCount: number;
  wordCount: number;
  minutes: number;
  addedAt: number;
  renderedCount: number;
  totalSentences: number;
  audioReady: boolean;
  narration?: NarrationProfile;
}

export interface GenerationJob {
  id: string;
  docId: string;
  title: string;
  voiceId: string;
  /** Earlier saved attempts predate model-edition tracking. */
  modelId?: string;
  requestedModelId?: string;
  runtime?: KokoroRuntimeInfo;
  appVersion?: string;
  /** An explicit replacement bypasses previously saved PCM for this profile. */
  freshAudio?: boolean;
  speed: number;
  mode: 'stream' | 'full';
  status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  startedAt: number;
  finishedAt?: number;
  completedSentences: number;
  totalSentences: number;
  error?: string;
}

export interface Preferences {
  voiceId: string;
  speed: number;
  selectedModel: string;
  generateMode: 'stream' | 'full';
  backendPreference?: 'auto' | 'wasm';
}

const LIBRARY = 'narrate:v1:library';
const JOBS = 'narrate:v1:jobs';
const PREFS = 'narrate:v1:preferences';
const docKey = (id: string) => `narrate:v1:document:${id}`;
const audioPrefix = (id: string) => `narrate:v1:audio:${id}:`;

// Serialize writes so a slower earlier transaction cannot overwrite newer
// library metadata or job status. Audio lives in individual records, avoiding
// copying a whole book's PCM for each sentence that finishes.
let writes: Promise<unknown> = Promise.resolve();
function write<T>(action: () => Promise<T>): Promise<T> {
  const result = writes.catch(() => undefined).then(action);
  writes = result;
  return result;
}

export const storage = {
  async load() {
    await writes.catch(() => undefined);
    const [library, jobs, preferences] = await Promise.all([
      get<LibraryEntry[]>(LIBRARY), get<GenerationJob[]>(JOBS), get<Preferences>(PREFS),
    ]);
    return { library: library ?? [], jobs: jobs ?? [], preferences };
  },
  saveLibrary: (entries: LibraryEntry[]) => write(() => set(LIBRARY, entries)),
  saveJobs: (jobs: GenerationJob[]) => write(() => set(JOBS, jobs)),
  savePreferences: (preferences: Preferences) => write(() => set(PREFS, preferences)),
  saveDocument: (id: string, doc: Doc) => write(() => set(docKey(id), doc)),
  loadDocument: (id: string) => get<Doc>(docKey(id)),
  narrationKey(id: string, engine: string, voice: string, speed: number) {
    return `${audioPrefix(id)}${encodeURIComponent(engine)}:${encodeURIComponent(voice)}:${speed}`;
  },
  async loadNarration(key: string): Promise<Segment[]> {
    await writes.catch(() => undefined);
    const count = await get<number>(`${key}:count`) ?? 0;
    const segments: Segment[] = [];
    for (let index = 0; index < count; index++) {
      const segment = await get<Segment>(`${key}:sentence:${index}`);
      if (!segment || segment.sentenceIndex !== index || !(segment.samples instanceof Float32Array) ||
          segment.samples.length === 0 || !Number.isFinite(segment.sampleRate) || segment.sampleRate <= 0) break;
      segments.push(segment);
    }
    return segments;
  },
  saveSegment(key: string, segment: Segment) {
    // Commit PCM and its prefix length together. When replacing a take, the
    // previous count must never expose its old tail after the first new chunk.
    return write(() => setMany([
      [`${key}:sentence:${segment.sentenceIndex}`, segment],
      [`${key}:count`, segment.sentenceIndex + 1],
    ]));
  },
  removeDocument(id: string) {
    return write(async () => {
      const allKeys = await keys();
      await Promise.all(allKeys.filter(key => typeof key === 'string' &&
        (key === docKey(id) || key.startsWith(audioPrefix(id)))).map(key => del(key)));
    });
  },
};
