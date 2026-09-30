/**
 * The voice library.
 *
 * Narrate treats voice selection as casting, not as choosing a sample rate, so
 * every voice carries a proper name, a character description, and an avatar.
 *
 * Avatars are generated from the voice itself rather than sourced from stock
 * photography. Each one is the voice's distinguishing name rendered as real
 * braille cells on a tinted paper ground — distinct, meaningful, consistent
 * with the visual world, and carrying no third-party image licence.
 *
 * The `persona` strings are editorial characterisations written for this
 * product, not vendor descriptions. Treat them as casting notes.
 */

import type { VoiceInfo } from './engine';

export interface Voice extends VoiceInfo {
  /** The part of the id after the language prefix, e.g. "bella" in af_bella. */
  stem: string;
  /** Paper tint for the generated avatar. */
  tone: number;
  /** Preview phrase. Kept short and phonetically broad on purpose. */
  sample: string;
}

/* ----------------------------------------------------------------- tones ---- */

/** Lamplit paper tints. All sit in the same warm band as the reading plane. */
const TONES = [
  38, 24, 12, 348, 30, 200, 96, 320, 52, 8, 264, 168,
  44, 186, 340, 108, 16, 288, 68, 220, 300, 140, 40, 250,
];

export const SAMPLE_PHRASE =
  'The quiet room held its breath, and every word arrived exactly on time.';

/* ------------------------------------------------------------------ data ---- */

type Seed = [id: string, name: string, persona: string, accent: string];

const SEEDS: Seed[] = [
  // American English, feminine
  ['af_alloy', 'Wren', 'Even and unhurried. Reads technical material without flattening it.', 'American'],
  ['af_aoede', 'Marisol', 'Warm and slightly breathy. Comfortable at pace.', 'American'],
  ['af_bella', 'Ingrid', 'The default narrator. Clear, warm, unremarkable in the best way.', 'American'],
  ['af_heart', 'Noor', 'Bright and direct, with a lift at the end of phrases.', 'American'],
  ['af_jessica', 'Priya', 'Conversational and close. Sounds like someone reading to you.', 'American'],
  ['af_kore', 'Saoirse', 'Low and steady. Holds long paragraphs without fatigue.', 'American'],
  ['af_nicole', 'Beatrix', 'Soft and deliberate. Best for dense, dry prose.', 'American'],
  ['af_nova', 'Zuri', 'Bright and youthful. Loses weight in long passages.', 'American'],
  ['af_river', 'Halina', 'Calm and unhurried. Built for long listening.', 'American'],
  ['af_sarah', 'Nadia', 'Neutral and clean. The safest choice for accuracy.', 'American'],
  ['af_sky', 'Camille', 'Light and airy. Reads quickly without sounding rushed.', 'American'],
  // American English, masculine
  ['am_adam', 'Theo', 'Neutral and grounded. Nothing to adjust to.', 'American'],
  ['am_echo', 'Rune', 'Smooth and even. Reads lists and tables well.', 'American'],
  ['am_eric', 'Desmond', 'Older, gravelly. Good for memoir and history.', 'American'],
  ['am_fenrir', 'Baldur', 'Deep and resonant. Authoritative without being loud.', 'American'],
  ['am_liam', 'Ronan', 'Young and clear. The most legible of the set.', 'American'],
  ['am_michael', 'Amos', 'Warm mid-range. Reliable across long documents.', 'American'],
  ['am_onyx', 'Ivo', 'Low and textured. Reads long passages with authority.', 'American'],
  ['am_puck', 'Eamon', 'Lighter and quicker. Keeps pace over an hour.', 'American'],
  ['am_santa', 'Rufus', 'Rich and characterful. Best suited to fiction.', 'American'],
  // British English, feminine
  ['bf_alice', 'Elsie', 'Light British warmth. Reads dry comedy well.', 'British'],
  ['bf_emma', 'Rosalind', 'Composed British mid-range. Excellent on long prose.', 'British'],
  ['bf_isabella', 'Marguerite', 'Measured and precise. Handles difficult names.', 'British'],
  ['bf_lily', 'Fiona', 'Lighter and younger. Bright without being thin.', 'British'],
  // British English, masculine
  ['bm_daniel', 'Nigel', 'Classic British documentary register.', 'British'],
  ['bm_fable', 'Barnaby', 'Storytelling cadence. Made for narrative.', 'British'],
  ['bm_george', 'Rupert', 'Rounded and genial. Easy to listen to for hours.', 'British'],
  ['bm_lewis', 'Clive', 'Measured and formal. Suits technical and legal prose.', 'British'],
  ['bm_reed', 'Duncan', 'Dry and understated. Reads irony without flattening it.', 'British'],
  // International voices present in the v1.0 / v1.1 multi-language export
  ['af_nicole_zh', 'Mei', 'Mandarin, clear and unhurried.', 'Chinese'],
  ['zf_xiaobei', 'Xiaobei', 'Mandarin, brighter and more animated.', 'Chinese'],
  ['zm_yunjian', 'Yunjian', 'Mandarin, low and measured.', 'Chinese'],
  ['zf_xiaoxiao', 'Xiaoxiao', 'Mandarin, light and precise.', 'Chinese'],
  ['zm_yunxi', 'Yunxi', 'Mandarin, young and direct.', 'Chinese'],
  ['hf_alpha', 'Ana', 'Castilian Spanish, even and clear.', 'Spanish'],
  ['hf_beta', 'Marisol', 'Castilian Spanish, warmer and slower.', 'Spanish'],
  ['hm_omega', 'Mateo', 'Castilian Spanish, low and steady.', 'Spanish'],
  ['hm_psi', 'Javier', 'Castilian Spanish, brighter delivery.', 'Spanish'],
  ['if_sara', 'Amelie', 'French, smooth and rounded.', 'French'],
  ['if_nicola', 'Camille', 'French, lighter and quicker.', 'French'],
  ['hf_alpha_fem', 'Solene', 'French, mid-range and steady.', 'French'],
  ['pm_alex', 'Matteo', 'Italian, warm and even.', 'Italian'],
  ['pm_sara', 'Chiara', 'Italian, brighter and more animated.', 'Italian'],
  ['em_albert', 'Tomas', 'Brazilian Portuguese, warm and open.', 'Portuguese'],
  ['em_ella', 'Luiza', 'Brazilian Portuguese, lighter and quicker.', 'Portuguese'],
  ['jf_alpha', 'Aoi', 'Japanese, clear and measured.', 'Japanese'],
  ['jf_gongitsune', 'Ren', 'Japanese, softer and more intimate.', 'Japanese'],
  ['jm_kumo', 'Haru', 'Japanese, low and steady.', 'Japanese'],
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function buildVoice([id, name, persona, accent]: Seed, index: number): Voice {
  const stem = id.split('_').slice(1).join('_') || id;
  return {
    id,
    name,
    persona,
    accent,
    engine: 'kokoro',
    clonable: false,
    stem,
    tone: TONES[(hash(id) + index) % TONES.length],
    sample: SAMPLE_PHRASE,
  };
}

export const KOKORO_VOICES: Voice[] = SEEDS.map(buildVoice);

/** Default narrator. Chosen because it is the one that stays unremarkable. */
export const DEFAULT_VOICE_ID = 'af_bella';

/**
 * Voices the engine can actually load. A requested id that is not in this
 * engine's set is never silently substituted for a different voice — the UI
 * treats it as unavailable, because quietly swapping a narrator is exactly the
 * failure this product exists to avoid.
 */
export function voiceById(id: string): Voice | undefined {
  return KOKORO_VOICES.find((v) => v.id === id);
}

export function voicesByAccent(): Map<string, Voice[]> {
  const m = new Map<string, Voice[]>();
  for (const v of KOKORO_VOICES) {
    const list = m.get(v.accent) ?? [];
    list.push(v);
    m.set(v.accent, list);
  }
  return m;
}
