import { useEffect, useRef, useState } from 'react';
import type { TtsEngine } from '../core/tts/engine';
import { AuditionPlayer } from '../core/audio/audition';

export function useAudition(engine: TtsEngine, ensureEngine: () => Promise<void>) {
  const [player] = useState(() => new AuditionPlayer());
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; player.cancel(); }, [player, engine]);

  const audition = async (text: string, voiceId: string) => {
    const current = ++request.current;
    setError(null);
    try {
      await player.play(async active => {
        await ensureEngine();
        if (!active()) return null;
        if (!engine.ready) throw new Error('The narrator could not be loaded. Check Models in Settings and try again.');
        return engine.synthesize(text, voiceId, { speed: 1 });
      });
    } catch (failure) {
      if (request.current === current) setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  return { audition, error };
}
