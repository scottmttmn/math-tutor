import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { CanvasDocument, Stroke, ChatMessage, SessionType, ShelfDocument } from '@/types';

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
}

const DB_NAME = 'math-tutor';
const DB_VERSION = 2;

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
      },
    });
  }
  return dbPromise;
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
}

export async function loadSession(id: string) {
  const db = await getDB();
  return db.get('sessions', id);
}

export async function deleteSession(id: string) {
  const db = await getDB();
  await db.delete('sessions', id);
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
}

/** Removes a PDF and the boards of every exercise marked on it. */
export async function deleteShelfDocument(id: string) {
  const db = await getDB();
  const tx = db.transaction(['shelf', 'sessions'], 'readwrite');
  await tx.objectStore('shelf').delete(id);
  const prefix = `shelf:${id}:`;
  await tx.objectStore('sessions').delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  await tx.done;
}
