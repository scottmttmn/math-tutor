import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { Stroke, ChatMessage } from '@/types';

interface MathTutorDB extends DBSchema {
  sessions: {
    key: string;
    value: {
      id: string;
      title: string;
      problemStatement: string;
      canvasStrokes: Stroke[];
      canvasImageBlob: Blob | null;
      chatHistory: ChatMessage[];
      createdAt: number;
      updatedAt: number;
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
  await db.put('sessions', session);
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
