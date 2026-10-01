import { invoke, isTauri } from '@tauri-apps/api/core';
import { beginBackgroundWork, endBackgroundWork } from '../background';

/** Each base64 payload is 120 KiB, leaving room for JSON within 128 KiB. */
const CHUNK_BYTES = 90 * 1024;
type Selection = { native: false } | { native: true; session: string | null };

export interface AudioExportBoundary {
  isTauri: () => boolean;
  invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  beginBackgroundWork: (label: string) => Promise<void>;
  endBackgroundWork: () => Promise<void>;
  download: (blob: Blob, filename: string) => void;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

/** False means the user cancelled Android's save picker; failures reject. */
export function createAudioExporter(boundary: AudioExportBoundary) {
  return async (blob: Blob, filename: string): Promise<boolean> => {
    if (!boundary.isTauri()) {
      boundary.download(blob, filename);
      return true;
    }
    const selection = await boundary.invoke('audio_export_begin', {
      filename,
      mimeType: blob.type || (filename.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'),
      expectedBytes: blob.size,
    }) as Selection;
    if (selection?.native === false) {
      boundary.download(blob, filename);
      return true;
    }
    if (selection?.native !== true) throw new Error('Invalid audio export response');
    if (selection.session === null) return false;
    if (!selection.session || typeof selection.session !== 'string') throw new Error('Invalid audio export session');
    const session = selection.session;
    let background = false;
    try {
      await boundary.beginBackgroundWork('Saving audio');
      background = true;
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        await boundary.invoke('audio_export_write', { session, data: base64(bytes) });
      }
      await boundary.invoke('audio_export_finish', { session });
      return true;
    } catch (error) {
      await boundary.invoke('audio_export_abort', { session }).catch(() => undefined);
      throw error;
    } finally {
      if (background) await boundary.endBackgroundWork().catch(() => undefined);
    }
  };
}

export const saveAudioExport = createAudioExporter({
  isTauri,
  invoke,
  beginBackgroundWork,
  endBackgroundWork,
  download,
});
