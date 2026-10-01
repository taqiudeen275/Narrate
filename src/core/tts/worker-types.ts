export type KokoroBackend = 'wasm' | 'webgpu';

export interface KokoroRuntimeInfo {
  /** Requested execution provider; WebGPU can use CPU for unsupported nodes. */
  backend: KokoroBackend;
  wasmThreads: number;
  crossOriginIsolated: boolean;
  reason: string;
}

export interface KokoroRequest {
  id: number;
  type: 'load' | 'synthesize';
  cacheId?: string;
  device?: 'auto' | 'wasm';
  /** Main-thread tablet hints are unavailable on WorkerNavigator. */
  mobile?: boolean;
  text?: string;
  voiceId?: string;
  speed?: number;
}

export type KokoroReply =
  | { id: number; type: 'ready'; runtime?: KokoroRuntimeInfo }
  | { id: number; type: 'chunk'; samples: Float32Array; sampleRate: number }
  | { id: number; type: 'error'; error: string; backend?: KokoroBackend };
