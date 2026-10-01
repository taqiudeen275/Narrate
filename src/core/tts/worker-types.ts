export interface KokoroRequest {
  id: number;
  type: 'load' | 'synthesize';
  cacheId?: string;
  text?: string;
  voiceId?: string;
  speed?: number;
}

export type KokoroReply =
  | { id: number; type: 'ready' }
  | { id: number; type: 'chunk'; samples: Float32Array; sampleRate: number }
  | { id: number; type: 'error'; error: string };
