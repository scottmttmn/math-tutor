import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { CanvasDocument, Stroke, ChatMessage, InkStroke, LearnerProfile, PageInk, SessionType, ShelfDocument } from '@/types';

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
    };
    indexes: {
      'by-updated': number;
    };
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
const DB_VERSION = 4;

let dbPromise: Promise<IDBPDatabase<MathTutorDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MathTutorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MathTutorDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore('sessions', { keyPath: 'id' });
          store.createIndex('by-updated', 'updatedAt');
        }
        if (oldVersion < 2) db.createObjectStore('shelf', { keyPath: 'id' });
        if (oldVersion < 3) db.createObjectStore('settings');
        if (oldVersion < 4) db.createObjectStore('ink', { keyPath: 'id' }).createIndex('by-document', 'documentId');
      },
    });
  }
  return dbPromise;
}

// Writes to sessions, the Shelf (its ink too) or the tutor memory, so automatic backup knows when to run.
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
  // Names are given in History, not by the page that autosaves, so a save without one keeps it.
  if (session.customTitle === undefined) {
    const existing = await tx.store.get(session.id);
    if (existing?.customTitle) session = { ...session, customTitle: existing.customTitle };
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
) {
  const db = await getDB();
  const tx = db.transaction(['sessions', 'shelf', 'settings', 'ink'], 'readwrite');
  const written = { sessions: [] as string[], shelf: [] as string[], profile: false, ink: [] as string[], skipped: 0, missingPdfs: [] as string[] };
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
    await tx.objectStore('shelf').put({ ...document, file });
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
  if (written.sessions.length || written.shelf.length || written.profile || written.ink.length) changed();
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

/** Whether anything is saved yet: a board, a Shelf PDF or the tutor memory. */
export async function hasSavedWork() {
  const db = await getDB();
  return (await db.count('sessions')) + (await db.count('shelf')) + (await db.count('settings', PROFILE_KEY)) > 0;
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
