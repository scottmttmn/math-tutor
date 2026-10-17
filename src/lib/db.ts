import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { CanvasDocument, Stroke, ChatMessage, Folder, InkStroke, LearnerProfile, PageInk, SessionType, ShelfDocument } from '@/types';

interface MathTutorDB extends DBSchema {
  sessions: {
    key: string;
    value: {
      id: string;
      title: string;
      problemStatement: string;
      problemImage: string | null;
      canvasStrokes: Stroke[];
      canvasDocument?: CanvasDocument | null;
      canvasImageBlob: Blob | null;
      chatHistory: ChatMessage[];
      createdAt: number;
      updatedAt: number;
      isSolved?: boolean;
      sessionType?: SessionType;
      customTitle?: string;
      folderId?: string | null;
    };
    indexes: {
      'by-updated': number;
    };
  };
  /** The library's folders (boards and books say which one they are in). */
  folders: {
    key: string;
    value: Folder;
  };
  shelf: {
    key: string;
    value: ShelfDocument;
  };
  /** Ink written on Shelf pages, one record per page. */
  ink: {
    key: string;
    value: PageInk;
    indexes: {
      'by-document': string;
    };
  };
  /** Small app settings kept beside the work, e.g. the backup folder (a handle can't go in localStorage). */
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'math-tutor';
const DB_VERSION = 5;

let dbPromise: Promise<IDBPDatabase<MathTutorDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MathTutorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MathTutorDB>(DB_NAME, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('by-updated', 'updatedAt');
        }
        if (oldVersion < 2) db.createObjectStore('shelf', { keyPath: 'id' });
        if (oldVersion < 3) db.createObjectStore('settings');
        if (oldVersion < 4) db.createObjectStore('ink', { keyPath: 'id' }).createIndex('by-document', 'documentId');
        if (oldVersion < 5) {
          // Every book gets the folder a new one comes with; its boards follow it there.
          const folders = db.createObjectStore('folders', { keyPath: 'id' });
          if (oldVersion >= 2) {
            const shelf = tx.objectStore('shelf');
            for (const document of await shelf.getAll()) {
              if (document.folderId !== undefined) continue;
              await folders.put(bookFolder(document));
              await shelf.put({ ...document, folderId: bookFolderId(document.id) });
            }
          }
        }
      },
    });
  }
  return dbPromise;
}

// Writes to sessions, the Shelf (its ink too), folders or the tutor memory, so automatic backup knows when to run.
const changeListeners = new Set<() => void>();
const changed = () => changeListeners.forEach((listener) => listener());

/** Calls `listener` after every write to sessions, the Shelf or the tutor memory; returns the unsubscribe. */
export function onDataChange(listener: () => void) {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

export async function saveSession(session: MathTutorDB['sessions']['value']) {
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  // Names are given in History, and folders chosen by Move, not by the page that autosaves, so a
  // save without one keeps it.
  if (session.customTitle === undefined || session.folderId === undefined) {
    const existing = await tx.store.get(session.id);
    if (session.customTitle === undefined && existing?.customTitle) session = { ...session, customTitle: existing.customTitle };
    if (session.folderId === undefined && existing?.folderId !== undefined) session = { ...session, folderId: existing.folderId };
  }
  await tx.store.put(session);
  await tx.done;
  changed();
}

/** Names a saved session; an empty name goes back to the title taken from the problem. */
export async function renameSession(id: string, name: string) {
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    const renamed: MathTutorDB['sessions']['value'] = { ...existing, customTitle: name.trim() };
    if (!renamed.customTitle) delete renamed.customTitle;
    await tx.store.put(renamed);
  }
  await tx.done;
  changed();
}

/** Files a saved session in a folder (null: the top level); undefined puts it back where it belongs by default. */
export async function moveSession(id: string, folderId: string | null | undefined) {
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    const moved: MathTutorDB['sessions']['value'] = { ...existing, folderId };
    if (folderId === undefined) delete moved.folderId;
    await tx.store.put(moved);
  }
  await tx.done;
  changed();
}

export async function loadSession(id: string) {
  const db = await getDB();
  return db.get('sessions', id);
}

export async function deleteSession(id: string) {
  const db = await getDB();
  await db.delete('sessions', id);
  changed();
}

export async function listSessions() {
  const db = await getDB();
  const all = await db.getAllFromIndex('sessions', 'by-updated');
  return all.reverse(); // newest first
}

// === Shelf ===

/** The board for an exercise marked on a Shelf PDF. */
export const shelfSessionId = (documentId: string, exerciseId: string) => `shelf:${documentId}:${exerciseId}`;

export async function listShelf() {
  const db = await getDB();
  const all = await db.getAll('shelf');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadShelfDocument(id: string) {
  const db = await getDB();
  return db.get('shelf', id);
}

export async function saveShelfDocument(document: ShelfDocument) {
  const db = await getDB();
  await db.put('shelf', document);
  changed();
}

/** Removes a PDF, the boards of every exercise marked on it, and the ink on its pages. */
export async function deleteShelfDocument(id: string) {
  const db = await getDB();
  const tx = db.transaction(['shelf', 'sessions', 'ink'], 'readwrite');
  await tx.objectStore('shelf').delete(id);
  const prefix = `shelf:${id}:`;
  await tx.objectStore('sessions').delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  for (const key of await tx.objectStore('ink').index('by-document').getAllKeys(id)) await tx.objectStore('ink').delete(key);
  await tx.done;
  changed();
}

// === Folders ===

/** The folder a book comes with when added, named after it. */
export const bookFolderId = (documentId: string) => `book:${documentId}`;
export const bookFolder = (document: Pick<ShelfDocument, 'id' | 'title' | 'createdAt'>, now = Date.now()): Folder => ({
  id: bookFolderId(document.id), name: document.title, parentId: null, createdAt: document.createdAt, updatedAt: now,
});

export async function listFolders(): Promise<Folder[]> {
  const db = await getDB();
  return db.getAll('folders');
}

export async function saveFolder(folder: Folder) {
  const db = await getDB();
  await db.put('folders', folder);
  changed();
}

/** Deletes a folder; what it held (folders, books, boards) moves up to its parent. */
export async function deleteFolder(id: string) {
  const db = await getDB();
  const tx = db.transaction(['folders', 'sessions', 'shelf'], 'readwrite');
  const folders = tx.objectStore('folders');
  const folder = await folders.get(id);
  if (!folder) { await tx.done; return; }
  const parent = folder.parentId;
  const now = Date.now();
  for (const child of await folders.getAll()) {
    if (child.parentId === id) await folders.put({ ...child, parentId: parent, updatedAt: now });
  }
  const shelf = tx.objectStore('shelf');
  for (const document of await shelf.getAll()) {
    if (document.folderId === id) await shelf.put({ ...document, folderId: parent, updatedAt: now });
  }
  // A board filed here moves up; one that only follows its book follows it up.
  const sessions = tx.objectStore('sessions');
  let cursor = await sessions.openCursor();
  while (cursor) {
    if (cursor.value.folderId === id) await cursor.update({ ...cursor.value, folderId: parent });
    cursor = await cursor.continue();
  }
  await folders.delete(id);
  await tx.done;
  changed();
}

// === Ink on Shelf pages ===

export const pageInkId = (documentId: string, page: number) => `${documentId}:${page}`;

/** The ink on every page of a Shelf PDF. */
export async function loadInk(documentId: string): Promise<PageInk[]> {
  const db = await getDB();
  return db.getAllFromIndex('ink', 'by-document', documentId);
}

/** Every page of ink on the Shelf, for backups. */
export async function listInk(): Promise<PageInk[]> {
  const db = await getDB();
  return db.getAll('ink');
}

/** Saves one page's ink; a page with none left has its record removed. */
export async function savePageInk(documentId: string, page: number, strokes: InkStroke[]) {
  const db = await getDB();
  const id = pageInkId(documentId, page);
  if (strokes.length) await db.put('ink', { id, documentId, page, strokes, updatedAt: Date.now() });
  else await db.delete('ink', id);
  changed();
}

// === Backup ===

type StoredSession = MathTutorDB['sessions']['value'];

/**
 * Writes restored records, each only where this device has none or an older one (by updatedAt).
 * A Shelf PDF without its file keeps this device's file, or is skipped when there is none.
 * Returns the ids written.
 */
export async function restoreRecords(
  sessions: StoredSession[],
  shelf: (Omit<ShelfDocument, 'file'> & { file: Blob | null })[],
  profile?: LearnerProfile,
  ink: PageInk[] = [],
  folders: Folder[] = [],
) {
  const db = await getDB();
  const tx = db.transaction(['sessions', 'shelf', 'settings', 'ink', 'folders'], 'readwrite');
  const written = { sessions: [] as string[], shelf: [] as string[], profile: false, ink: [] as string[], folders: [] as string[], skipped: 0, missingPdfs: [] as string[] };
  for (const folder of folders) {
    const existing = await tx.objectStore('folders').get(folder.id);
    if (existing && existing.updatedAt >= folder.updatedAt) { written.skipped += 1; continue; }
    await tx.objectStore('folders').put(folder);
    written.folders.push(folder.id);
  }
  for (const session of sessions) {
    const existing = await tx.objectStore('sessions').get(session.id);
    if (existing && existing.updatedAt >= session.updatedAt) { written.skipped += 1; continue; }
    await tx.objectStore('sessions').put(session);
    written.sessions.push(session.id);
  }
  for (const document of shelf) {
    const existing = await tx.objectStore('shelf').get(document.id);
    const file = document.file ?? existing?.file;
    if (!file) { written.missingPdfs.push(document.title); continue; }
    if (existing && existing.updatedAt >= document.updatedAt) { written.skipped += 1; continue; }
    // A book from before folders goes in its own folder, as the database upgrade put books here.
    let folderId = document.folderId;
    if (folderId === undefined) {
      folderId = existing?.folderId ?? bookFolderId(document.id);
      if (folderId === bookFolderId(document.id) && !await tx.objectStore('folders').getKey(folderId)) {
        await tx.objectStore('folders').put(bookFolder(document));
        written.folders.push(folderId);
      }
    }
    await tx.objectStore('shelf').put({ ...document, file, folderId });
    written.shelf.push(document.id);
  }
  if (profile) {
    const existing = (await tx.objectStore('settings').get(PROFILE_KEY)) as LearnerProfile | undefined;
    if (existing && existing.updatedAt >= profile.updatedAt) written.skipped += 1;
    else { await tx.objectStore('settings').put(profile, PROFILE_KEY); written.profile = true; }
  }
  // Ink only for a PDF that is on this device (now that its entry may have been restored).
  for (const page of ink) {
    if (!await tx.objectStore('shelf').getKey(page.documentId)) continue;
    const existing = await tx.objectStore('ink').get(page.id);
    if (existing && existing.updatedAt >= page.updatedAt) { written.skipped += 1; continue; }
    await tx.objectStore('ink').put(page);
    written.ink.push(page.id);
  }
  await tx.done;
  if (written.sessions.length || written.shelf.length || written.profile || written.ink.length || written.folders.length) changed();
  return written;
}

// === Tutor memory ===

const PROFILE_KEY = 'learnerProfile';

/** The student's tutor memory, if they have saved one. */
export async function loadProfile(): Promise<LearnerProfile | undefined> {
  const db = await getDB();
  return (await db.get('settings', PROFILE_KEY)) as LearnerProfile | undefined;
}

export async function saveProfile(profile: LearnerProfile) {
  const db = await getDB();
  await db.put('settings', profile, PROFILE_KEY);
  changed();
}

/**
 * Changes the tutor memory as one read-modify-write transaction, so writers (a reply's notes, a
 * favorite, the memory page, another tab) never undo each other. `change` must not await.
 */
export async function updateProfile(change: (current: LearnerProfile | undefined) => LearnerProfile): Promise<LearnerProfile> {
  const db = await getDB();
  const tx = db.transaction('settings', 'readwrite');
  const current = (await tx.store.get(PROFILE_KEY)) as LearnerProfile | undefined;
  const next = change(current);
  if (next !== current) await tx.store.put(next, PROFILE_KEY);
  await tx.done;
  if (next !== current) changed();
  return next;
}

/** Whether anything is saved yet: a board, a Shelf PDF, a folder or the tutor memory. */
export async function hasSavedWork() {
  const db = await getDB();
  return (await db.count('sessions')) + (await db.count('shelf')) + (await db.count('folders')) + (await db.count('settings', PROFILE_KEY)) > 0;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return (await db.get('settings', key)) as T | undefined;
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDB();
  if (value === undefined) await db.delete('settings', key);
  else await db.put('settings', value, key);
}
