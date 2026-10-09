import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { CanvasDocument, Stroke, ChatMessage, SessionType } from '@/types';

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
}

const DB_NAME = 'math-tutor';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<MathTutorDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<MathTutorDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MathTutorDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('sessions', { keyPath: 'id' });
        store.createIndex('by-updated', 'updatedAt');
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
