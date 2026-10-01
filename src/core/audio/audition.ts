import type { EngineChunk } from '../tts/engine';

/** One preview owns one audio context, including pending synthesis. */
export class AuditionPlayer {
  private epoch = 0;
  private context: AudioContext | null = null;
  private source: AudioBufferSourceNode | null = null;

  cancel(): void {
    this.epoch++;
    const source = this.source;
    const context = this.context;
    this.source = null;
    this.context = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* the preview already ended */ }
      source.disconnect();
    }
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  async play(produce: (active: () => boolean) => Promise<EngineChunk | null>): Promise<void> {
    this.cancel();
    const epoch = this.epoch;
    const active = () => this.epoch === epoch;
    try {
      // Open/resume in the click handler, while user activation is available.
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (!active()) return;
      const chunk = await produce(active);
      if (!active()) return;
      if (!chunk) { this.cancel(); return; }
      const buffer = context.createBuffer(1, chunk.samples.length, chunk.sampleRate);
      buffer.getChannelData(0).set(chunk.samples);
      const source = context.createBufferSource();
      this.source = source;
      source.buffer = buffer;
      source.connect(context.destination);
      source.onended = () => { if (active()) this.cancel(); };
      source.start();
    } catch (error) {
      if (!active()) return;
      this.cancel();
      throw error;
    }
  }
}
