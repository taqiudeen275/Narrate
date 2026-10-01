/**
 * The voice library.
 *
 * Narrators are **model-bound**: a voice id like `af_bella` is a speaker inside
 * one set of weights, not a portable persona. Piper's 100+ voices and Kokoro's
 * 54 are disjoint sets with no overlap and no way to move a voice between them.
 *
 * So the curated names below are keyed to one engine, and `availableVoices()`
 * intersects them with what the loaded engine actually reports. Anything the
 * engine offers that has no curated name still appears, under a readable
 * fallback, rather than being hidden or silently substituted.
 */

import type { VoiceInfo } from './engine';
import { SUPPORTED_VOICE_IDS } from './downloads';

/** A presentable narrator: a model-bound voice, with a name and a face. */
export interface Voice extends VoiceInfo {
  /** The engine id this voice belongs to, e.g. the stem of `af_bella`. */
  stem: string;
  /** Hue used for this voice's generated avatar. */
  tone: number;
  /** Preview phrase, kept short and phonetically broad. */
  sample: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const TONES = [38, 24, 12, 348, 30, 200, 96, 320, 52, 8, 264, 168, 44, 186, 340, 108, 16, 288, 68, 220, 300, 140, 40, 250];

export const SAMPLE_PHRASE =
  'The quiet room held its breath, and every word arrived exactly on time.';

type Seed = [id: string, name: string, persona: string, accent: string];

/**
 * Curated casting notes for Kokoro's voices. Editorial characterisations
 * written for this product, not vendor descriptions.
 */
const SEEDS: Seed[] = [
  ['af_bella', 'Ingrid', 'The default narrator. Clear, warm, unremarkable in the best way.', 'American'],
  ['af_nicole', 'Beatrix', 'Soft and deliberate. Best for dense, dry prose.', 'American'],
  ['af_sarah', 'Nadia', 'Neutral and clean. The safest choice for accuracy.', 'American'],
  ['af_sky', 'Camille', 'Light and airy. Reads quickly without sounding rushed.', 'American'],
  ['af_amv', 'Wren', 'Even and unhurried. Reads technical material without flattening it.', 'American'],
  ['am_adam', 'Theo', 'Neutral and grounded. Nothing to adjust to.', 'American'],
  ['am_echo', 'Rune', 'Smooth and even. Reads lists and tables well.', 'American'],
  ['am_michael', 'Amos', 'Warm mid-range. Reliable across long documents.', 'American'],
  ['bf_alice', 'Elsie', 'Light British warmth. Reads dry comedy well.', 'British'],
  ['bf_emma', 'Rosalind', 'Composed British mid-range. Excellent on long prose.', 'British'],
  ['bf_isabella', 'Marguerite', 'Measured and precise. Handles difficult names.', 'British'],
  ['bm_george', 'Rupert', 'Rounded and genial. Easy to listen to for hours.', 'British'],
  ['bm_lewis', 'Clive', 'Measured and formal. Suits technical and legal prose.', 'British'],
  ['zf_xiaobei', 'Xiaobei', 'Mandarin, brighter and more animated.', 'Chinese'],
  ['zm_yunjian', 'Yunjian', 'Mandarin, low and measured.', 'Chinese'],
  ['zm_yunxi', 'Yunxi', 'Mandarin, young and direct.', 'Chinese'],
  ['hf_alpha', 'Ana', 'Castilian Spanish, even and clear.', 'Spanish'],
  ['hm_omega', 'Mateo', 'Castilian Spanish, low and steady.', 'Spanish'],
  ['if_sara', 'Amelie', 'French, smooth and rounded.', 'French'],
  ['pm_alex', 'Matteo', 'Italian, warm and even.', 'Italian'],
  ['pm_sara', 'Chiara', 'Italian, brighter and more animated.', 'Italian'],
  ['em_albert', 'Tomas', 'Brazilian Portuguese, warm and open.', 'Portuguese'],
  ['jf_alpha', 'Aoi', 'Japanese, clear and measured.', 'Japanese'],
  ['jm_kumo', 'Haru', 'Japanese, low and steady.', 'Japanese'],
];

function buildVoice([id, name, persona, accent]: Seed, i: number): Voice {
  return {
    id,
    name,
    persona,
    accent,
    engine: 'kokoro',
    clonable: false,
    stem: id,
    tone: TONES[(hash(id) + i) % TONES.length],
    sample: SAMPLE_PHRASE,
  };
}

/** Curated voices for the Kokoro engine, keyed by id. */
const KOKORO_BY_ID = new Map(SEEDS.map(buildVoice).map((v) => [v.id, v]));

/**
 * The curated Kokoro cast, used until the engine reports its own list.
 * Every id here is a speaker inside Kokoro's weights; none of them would
 * resolve under a different engine.
 */
export const KOKORO_VOICES: Voice[] = SUPPORTED_VOICE_IDS.map((id, i) => {
  const curated = SEEDS.find((seed) => seed[0] === id);
  const accent = id.startsWith('b') ? 'British' : 'American';
  const name = id.split('_')[1];
  return buildVoice(curated ?? [id, name.charAt(0).toUpperCase() + name.slice(1), `${accent} English narrator.`, accent], i);
});

export const DEFAULT_VOICE_ID = 'af_bella';

/** Turn a raw engine voice id into a presentable voice. */
function voiceFor(info: VoiceInfo): Voice {
  const known = KOKORO_BY_ID.get(info.id);
  if (known) return { ...known, engine: info.engine, clonable: info.clonable };
  // Uncurated: still shown, never hidden, never silently swapped for another.
  const h = hash(info.id);
  return {
    id: info.id,
    name: info.name || titleise(info.id),
    persona: info.persona || 'No casting note for this voice yet.',
    accent: info.accent || 'Unknown',
    engine: info.engine,
    clonable: info.clonable,
    stem: info.id,
    tone: TONES[h % TONES.length],
    sample: SAMPLE_PHRASE,
  };
}

/** `af_nicole` -> `Af Nicole`. Only used where there is no curated name. */
function titleise(id: string): string {
  return id
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * The voices the current engine can actually produce.
 *
 * Falls back to the curated Kokoro set before the engine has loaded, so the
 * picker is never empty — but the list is replaced the moment the engine
 * reports its real one.
 */
export function availableVoices(): Voice[] {
  return KOKORO_VOICES;
}

export function syncVoicesFromEngine(list: VoiceInfo[]): Voice[] {
  if (!list.length) return KOKORO_VOICES;
  return list.map(voiceFor);
}

export function voiceById(id: string): Voice | undefined {
  return KOKORO_VOICES.find((voice) => voice.id === id);
}
