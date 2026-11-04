import type { ChunkWriterPlugin } from '@/types';

// The Android app's files go to native code in pieces: one string holding a whole backup (every
// PDF in base64) froze the app. A multiple of 3 bytes, so the pieces' base64 joins up.
export const CHUNK_BYTES = 3 * 256 * 1024;

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error ?? new Error("Couldn't read the file."));
    reader.readAsDataURL(blob);
  });
}

export async function base64ToBlob(data: string): Promise<Blob> {
  return (await fetch(`data:application/octet-stream;base64,${data}`)).blob();
}

/** Writes the blob into a file the plugin opened as id, then closes it; on a failure deletes it. */
export async function writeInChunks(plugin: ChunkWriterPlugin, id: string, blob: Blob) {
  try {
    for (let at = 0; at < blob.size; at += CHUNK_BYTES) await plugin.write({ id, data: await blobToBase64(blob.slice(at, at + CHUNK_BYTES)) });
    await plugin.close({ id });
  } catch (error) {
    await plugin.abort({ id }).catch(() => undefined);
    throw error;
  }
}
