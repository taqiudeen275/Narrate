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
        engine = null;
        const dtype = modelVariant(data.cacheId!).dtype;
        const selected = await selectKokoroBackend(dtype, data.device, data.mobile);
        backend = selected.backend;
        configureKokoroRuntime(backend);
        scope.postMessage({ id: data.id, type: 'backend', backend });
        engine = await KokoroTTS.from_pretrained(MODEL_REPO, { dtype, device: backend });
        scope.postMessage({ id: data.id, type: 'ready', runtime: kokoroRuntimeInfo(backend, selected.reason) });
      } else {
        if (!engine) throw new Error('The voice engine is not loaded.');
        const output = await engine.generate(data.text!, { voice: data.voiceId as NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice'], speed: data.speed ?? 1 });
        if (!(output.audio instanceof Float32Array) || output.audio.length === 0
          || !Number.isFinite(output.sampling_rate) || output.sampling_rate <= 0) {
          throw new Error('The voice engine returned invalid audio or a sample rate.');
        }
        let peak = 0;
        let energy = 0;
        for (const sample of output.audio) {
          if (!Number.isFinite(sample)) throw new Error('The voice engine returned nonfinite audio samples.');
          peak = Math.max(peak, Math.abs(sample));
          energy += sample * sample;
        }
        const rms = Math.sqrt(energy / output.audio.length);
        // PCM normally fits within [-1, 1]. Allow isolated overshoot, but never
        // play or save a numerically runaway inference result. This is not a
        // speech/noise classifier: bounded noise still needs a backend comparison.
        if (peak > 4 || rms > 1) throw new Error(`The voice engine returned overloaded audio (peak ${peak.toFixed(2)}, RMS ${rms.toFixed(2)}). Try CPU compatibility and regenerate the narration.`);
        scope.postMessage({ id: data.id, type: 'chunk', samples: output.audio, sampleRate: output.sampling_rate }, [output.audio.buffer as ArrayBuffer]);
      }
    } catch (error) {
      scope.postMessage({ id: data.id, type: 'error', error: error instanceof Error ? error.message : String(error), backend });
    }
  });
};
