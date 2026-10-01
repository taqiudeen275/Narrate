import { KokoroTTS } from 'kokoro-js';
import { MODEL_REPO, modelVariant } from './downloads';
import { configureKokoroRuntime, kokoroRuntimeInfo, selectKokoroBackend } from './runtime';
import type { KokoroBackend, KokoroReply, KokoroRequest } from './worker-types';

let engine: KokoroTTS | null = null;
let backend: KokoroBackend = 'wasm';
let chain = Promise.resolve();
const scope = self as unknown as { onmessage: (event: MessageEvent<KokoroRequest>) => void; postMessage: (message: KokoroReply, transfer?: Transferable[]) => void };

scope.onmessage = ({ data }) => {
  // Phonemizer's eSpeak instance and an ONNX session must not run concurrently.
  chain = chain.then(async () => {
    try {
      if (data.type === 'load') {
        configureKokoroRuntime();
        engine = null;
        const dtype = modelVariant(data.cacheId!).dtype;
        const selected = await selectKokoroBackend(dtype, data.device, data.mobile);
        backend = selected.backend;
        engine = await KokoroTTS.from_pretrained(MODEL_REPO, { dtype, device: backend });
        scope.postMessage({ id: data.id, type: 'ready', runtime: kokoroRuntimeInfo(backend, selected.reason) });
      } else {
        if (!engine) throw new Error('The voice engine is not loaded.');
        const output = await engine.generate(data.text!, { voice: data.voiceId as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice'], speed: data.speed ?? 1 });
        scope.postMessage({ id: data.id, type: 'chunk', samples: output.audio, sampleRate: output.sampling_rate }, [output.audio.buffer as ArrayBuffer]);
      }
    } catch (error) {
      scope.postMessage({ id: data.id, type: 'error', error: error instanceof Error ? error.message : String(error), backend });
    }
  });
};
