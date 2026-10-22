import { Capacitor, registerPlugin } from '@capacitor/core';
import { BOARD_FOLDER, MANIFEST_NAME, PDF_FOLDER } from '@/lib/backup';
import { CHUNK_BYTES, base64ToBlob, writeInChunks } from '@/lib/nativeFiles';
import type { BackupDirectory, BackupFolderPlugin } from '@/types';

// The folders a backup is written into (src/lib/autoBackup.ts): a folder picked in the browser
// (File System Access, Chromium), or in the Android app one picked with Android's folder picker
// (BackupFolderPlugin in android/), which the WebView has no browser API for.

const BackupFolder = registerPlugin<BackupFolderPlugin>('BackupFolder');

export const androidFolders = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackupFolder');

export function browserDirectory(handle: FileSystemDirectoryHandle): BackupDirectory {
  return {
    name: handle.name,
    directory: async (name) => browserDirectory(await handle.getDirectoryHandle(name, { create: true })),
    names: async () => {
      const names: string[] = [];
      for await (const name of handle.keys()) names.push(name);
      return names;
    },
    size: (name) => handle.getFileHandle(name).then((file) => file.getFile()).then((file) => file.size, () => null),
    write: async (name, contents) => {
      const file = await handle.getFileHandle(name, { create: true });
      const writable = await file.createWritable();
      try { await writable.write(contents); } catch (error) { await writable.abort().catch(() => undefined); throw error; }
      await writable.close();
    },
    remove: (name) => handle.removeEntry(name, { recursive: true }),
  };
}

// The plugin rejects with NOT_ALLOWED once Android took the folder back; the backup then pauses,
// as it does when a browser asks for permission again.
async function native<T>(call: Promise<T>): Promise<T> {
  try { return await call; } catch (error) {
    if ((error as { code?: string })?.code === 'NOT_ALLOWED') throw new DOMException('The app may no longer use that folder.', 'NotAllowedError');
    throw error;
  }
}

/** A folder inside an Android tree; folders on its path are made when it is first written to or listed. */
export function androidDirectory(tree: string, name: string, path: string[] = []): BackupDirectory {
  let listing: Promise<Map<string, number | null>> | undefined;
  const entries = () => (listing ??= native(BackupFolder.list({ tree, path, create: true }))
    .then(({ entries }) => new Map(entries.map((entry) => [entry.name, entry.directory || entry.size < 0 ? null : entry.size])))
    .catch((error) => { listing = undefined; throw error; }));
  return {
    name,
    directory: async (child) => androidDirectory(tree, child, [...path, child]),
    names: async () => [...(await entries()).keys()],
    size: async (child) => (await entries()).get(child) ?? null,
    write: async (child, contents) => {
      listing = undefined;
      const { id } = await native(BackupFolder.openWrite({ tree, path, name: child }));
      await native(writeInChunks(BackupFolder, id, contents));
    },
    remove: async (child) => {
      listing = undefined;
      await native(BackupFolder.remove({ tree, path, name: child }));
    },
  };
}

/** Android's folder picker (from a click); null when cancelled. */
export async function pickAndroidFolder(keep = true): Promise<{ tree: string; name: string } | null> {
  const { tree, name } = await BackupFolder.pick({ keep });
  return tree ? { tree, name: name ?? 'Backup folder' } : null;
}

export const androidFolderAllowed = (tree: string) => BackupFolder.check({ tree }).then(({ granted }) => granted, () => false);
export const releaseAndroidFolder = (tree: string) => BackupFolder.release({ tree }).catch(() => undefined);

// Read up to a short piece, not to the listed size: some providers don't say a file's size.
async function readFile(tree: string, path: string[], name: string): Promise<Blob> {
  const parts: Blob[] = [];
  for (let offset = 0; ; offset += CHUNK_BYTES) {
    const { data } = await native(BackupFolder.read({ tree, path, name, offset, length: CHUNK_BYTES }));
    const part = await base64ToBlob(data);
    parts.push(part);
    if (part.size < CHUNK_BYTES) return new Blob(parts);
  }
}

/**
 * A backup folder's files, picked with Android's folder picker, for restoreFromFiles: each File
 * named by its path in the folder, as <input webkitdirectory> names them. The picked folder can
 * be the backup folder or the one holding it. Null when the picker was cancelled.
 */
export async function pickAndroidBackupFiles(backupFolderName: string): Promise<File[] | null> {
  const picked = await pickAndroidFolder(false);
  if (!picked) return null;
  const { tree } = picked;
  const list = async (path: string[]) => (await native(BackupFolder.list({ tree, path }))).entries;
  let root: string[] = [];
  let top = await list(root);
  // The picked folder is the backup only if it holds a backup's own JSON, not any JSON file.
  const isBackup = (entries: typeof top) => entries.some((entry) => !entry.directory && (entry.name === MANIFEST_NAME || /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)));
  const inside = top.find((entry) => entry.directory && entry.name === backupFolderName);
  if (!isBackup(top) && inside) {
    root = [backupFolderName];
    top = await list(root);
  }
  const files: File[] = [];
  const add = async (path: string[], entry: { name: string }) => {
    const file = new File([await readFile(tree, [...root, ...path], entry.name)], entry.name);
    Object.defineProperty(file, 'webkitRelativePath', { value: [backupFolderName, ...path, entry.name].join('/') });
    files.push(file);
  };
  // Only what a backup holds: its JSON files, boards/, pdfs/ and history/<day>/.
  for (const entry of top) {
    if (!entry.directory) { if (entry.name.endsWith('.json')) await add([], entry); continue; }
    if (entry.name === BOARD_FOLDER || entry.name === PDF_FOLDER) {
      for (const file of await list([...root, entry.name])) if (!file.directory) await add([entry.name], file);
    }
    if (entry.name === 'history') {
      for (const day of await list([...root, 'history'])) {
        if (!day.directory) continue;
        for (const file of await list([...root, 'history', day.name])) if (!file.directory) await add(['history', day.name], file);
      }
    }
  }
  return files;
}
