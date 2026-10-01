import { KokoroTTS } from 'kokoro-js';
import { MODEL_REPO, modelVariant } from './downloads';
import { configureKokoroRuntime } from './runtime';
import type { KokoroReply, KokoroRequest } from './worker-types';

let engine: KokoroTTS | null = null;
let chain = Promise.resolve();
const scope = self as unknown as { onmessage: (event: MessageEvent<KokoroRequest>) => void; postMessage: (message: KokoroReply, transfer?: Transferable[]) => void };

scope.onmessage = ({ data }) => {
  // Phonemizer's eSpeak instance and an ONNX session must not run concurrently.
  chain = chain.then(async () => {
    try {
      if (data.type === 'load') {
        configureKokoroRuntime();
        engine = await KokoroTTS.from_pretrained(MODEL_REPO, { dtype: modelVariant(data.cacheId!).dtype, device: 'wasm' });
        scope.postMessage({ id: data.id, type: 'ready' });
      } else {
        if (!engine) throw new Error('The voice engine is not loaded.');
        const output = await engine.generate(data.text!, { voice: data.voiceId as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice'], speed: data.speed ?? 1 });
        scope.postMessage({ id: data.id, type: 'chunk', samples: output.audio, sampleRate: output.sampling_rate }, [output.audio.buffer as ArrayBuffer]);
      }
    } catch (error) {
      scope.postMessage({ id: data.id, type: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  });
};
