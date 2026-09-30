/**
 * lamejs ships no type declarations and there is no `@types/lamejs` on the
 * registry. This declares only the surface Narrate actually uses.
 */
declare module 'lamejs' {
  export class Mp3Encoder {
    constructor(channels: 1 | 2, sampleRate: number, kbps: number);
    encodeBuffer(samples: Float32Array): Int8Array;
    flush(): Int8Array;
  }
}
