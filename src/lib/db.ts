import { openDB, type IDBPDatabase, type IDBPTransaction, type DBSchema } from 'idb';
import type { BoardInk, CanvasDocument, Stroke, ChatMessage, Folder, InkStroke, LearnerProfile, PageInk, QuietCheck, SessionType, ShelfDocument } from '@/types';

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
      ink?: BoardInk | null;
      canvasImageBlob: Blob | null;
      chatHistory: ChatMessage[];
      createdAt: number;
      updatedAt: number;
      isSolved?: boolean;
      sessionType?: SessionType;
      customTitle?: string;
      folderId?: string | null;
      filedAt?: number;
      quietChecks?: Record<string, QuietCheck>;
    };
    indexes: {
      'by-updated': number;
    };
  };
  /**
   * The pictures on boards (data URLs), one record per picture under [session id, image id]. A
   * stored session's ink names its pictures with an empty `src`: they are most of a board's size,
   * and kept inside the session every save of a stroke read and rewrote all of them.
   */
  pictures: {
    key: [string, string];
    value: string;
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
const DB_VERSION = 6;

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
        // Boards saved before keep their pictures inside them until their next save.
        if (oldVersion < 6) db.createObjectStore('pictures');
      },
    });
  }
  return dbPromise;
}

// Writes to sessions, the Shelf (its ink too), folders or the tutor memory, so automatic backup knows when to run.
/** What a backup needs to know of a board to tell whether its file is current (see boardStamp). */
export type BoardStampFields = Pick<StoredSession, 'id' | 'updatedAt' | 'customTitle' | 'folderId' | 'filedAt' | 'quietChecks'>;
/** One board saved as it now is, or deleted; absent for any other write. */
export type DataChange = { saved: BoardStampFields } | { deleted: string };
const changeListeners = new Set<(change?: DataChange) => void>();
const changed = (change?: DataChange) => changeListeners.forEach((listener) => listener(change));
const stampFields = ({ id, updatedAt, customTitle, folderId, filedAt, quietChecks }: BoardStampFields): BoardStampFields => ({ id, updatedAt, customTitle, folderId, filedAt, quietChecks });

/**
 * Calls `listener` after every write to sessions, the Shelf or the tutor memory; returns the
 * unsubscribe. A board's own save or delete says which board (`DataChange`).
 */
export function onDataChange(listener: (change?: DataChange) => void) {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

type StoredSession = MathTutorDB['sessions']['value'];
type BoardStores = IDBPTransaction<MathTutorDB, ('sessions' | 'pictures')[], 'readwrite'>;

/** Every picture of one session (or, with `upTo`, of the sessions from `id` to `upTo`). */
const picturesOf = (id: string, upTo = id) => IDBKeyRange.bound([id], [upTo, []]);

// The pictures (as the objects a board holds them in) known to be stored, and for which session, so
// a save writes only the ones that are new. Weak: it keeps no picture in memory by itself.
const storedIn = new WeakMap<object, string>();

// What a save must keep from the stored record when the saver doesn't say (see saveSession), by
// session, so each save needn't read the whole board back first. Every other writer of a session
// drops it before and after its own write (`touched`), and a save keeps what it learned only if
// none ran meanwhile.
type KeptFields = Pick<StoredSession, 'customTitle' | 'folderId' | 'filedAt' | 'quietChecks'>;
const kept = new Map<string, KeptFields>();
let writes = 0;
const keptFields = ({ customTitle, folderId, filedAt, quietChecks }: KeptFields): KeptFields => ({ customTitle, folderId, filedAt, quietChecks });
/** Another writer is changing this session (or, with no id, any of them). */
const touched = (id?: string) => {
  writes += 1;
  if (id) kept.delete(id); else kept.clear();
};

/**
 * Writes a board: its pictures to their own store (only those not there yet), then the session
 * with each picture named but not held. Pictures the board no longer has are removed. Returns
 * what to call once the transaction is done.
 */
async function putBoard(tx: BoardStores, session: StoredSession): Promise<() => void> {
  const images = session.ink?.images ?? [];
  const pictures = tx.objectStore('pictures');
  // What is there now, so a picture is only skipped when it really is stored: one taken off the
  // board is removed below, and comes back as the same object when that is undone.
  const there = new Set((await pictures.getAllKeys(picturesOf(session.id))).map((key) => key[1]));
  const ids = new Set<string>();
  for (const image of images) {
    ids.add(image.id);
    // An empty src: the session came from the store without its pictures, which stay as they are.
    if (image.src && !(there.has(image.id) && storedIn.get(image) === session.id)) await pictures.put(image.src, [session.id, image.id]);
  }
  for (const id of there) if (!ids.has(id)) await pictures.delete([session.id, id]);
  const light = session.ink && images.some((image) => image.src)
    ? { ...session, ink: { ...session.ink, images: images.map((image) => (image.src ? { ...image, src: '' } : image)) } }
    : session;
  await tx.objectStore('sessions').put(light);
  return () => { for (const image of images) if (image.src) storedIn.set(image, session.id); };
}

/** A stored session with its pictures back in its ink. One whose picture is missing keeps the empty `src`. */
async function withStoredPictures<T extends Pick<StoredSession, 'id' | 'ink'>>(session: T, pictures: { get: (key: [string, string]) => Promise<string | undefined> }): Promise<T> {
  const images = session.ink?.images;
  if (!session.ink || !images?.some((image) => !image.src)) return session;
  const filled = await Promise.all(images.map(async (image) => {
    if (image.src) return image;
    const src = await pictures.get([session.id, image.id]);
    if (!src) return image;
    const whole = { ...image, src };
    storedIn.set(whole, session.id);
    return whole;
  }));
  return { ...session, ink: { ...session.ink, images: filled } };
}

/**
 * A session from `listSessions` with its pictures (see there); one that has them already, or has
 * none, is returned as it is.
 */
export async function withPictures<T extends Pick<StoredSession, 'id' | 'ink'>>(session: T): Promise<T> {
  if (!session.ink?.images.some((image) => !image.src)) return session;
  const db = await getDB();
  return withStoredPictures(session, db.transaction('pictures').store);
}

const PICTURES_APART_KEY = 'picturesApart';
let movingPictures: Promise<void> | null = null;

/**
 * Boards saved before pictures had their own store hold them inside the session. This moves them
 * out, once, a board at a time, so lists of the library (Home, the backup's check) stop reading
 * every picture ever pasted. Nothing else about a board changes (not its `updatedAt`), and a
 * board is whole at every step: its pictures and its session are written together.
 */
export function movePicturesApart(): Promise<void> {
  movingPictures ??= (async () => {
    const db = await getDB();
    if (await db.get('settings', PICTURES_APART_KEY)) return;
    for (const id of await db.getAllKeys('sessions')) {
      const tx = db.transaction(['sessions', 'pictures'], 'readwrite');
      const record = await tx.objectStore('sessions').get(id);
      if (record?.ink?.images.some((image) => image.src)) await putBoard(tx, record);
      await tx.done;
      // Leave room for the board being written on.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await db.put('settings', true, PICTURES_APART_KEY);
  })().catch(() => { movingPictures = null; });
  return movingPictures;
}

export async function saveSession(session: StoredSession) {
  const db = await getDB();
  const tx = db.transaction(['sessions', 'pictures'], 'readwrite');
  const before = writes;
  // Names are given in History, and folders chosen by Move, not by the page that autosaves, so a
  // save without one keeps it.
  if (session.customTitle === undefined || session.folderId === undefined || session.filedAt === undefined || session.quietChecks === undefined) {
    const existing = kept.get(session.id) ?? await tx.objectStore('sessions').get(session.id);
    // The tutor's quiet reads are written by saveQuietCheck, not by the board's autosave.
    if (session.quietChecks === undefined && existing?.quietChecks) session = { ...session, quietChecks: existing.quietChecks };
    if (session.customTitle === undefined && existing?.customTitle) session = { ...session, customTitle: existing.customTitle };
    if (session.folderId === undefined && existing?.folderId !== undefined) session = { ...session, folderId: existing.folderId };
    if (session.filedAt === undefined && existing?.filedAt !== undefined) session = { ...session, filedAt: existing.filedAt };
  }
  const done = await putBoard(tx, session);
  await tx.done;
  done();
  if (writes === before) kept.set(session.id, keptFields(session));
  changed({ saved: stampFields(session) });
}

/**
 * Keeps the tutor's quiet read of one problem on its saved board (see QuietCheck). Not work on the
 * board, so `updatedAt` stays; nothing is written if the board isn't saved.
 */
export async function saveQuietCheck(sessionId: string, key: string, check: QuietCheck) {
  touched(sessionId);
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(sessionId);
  if (existing) await tx.store.put({ ...existing, quietChecks: { ...existing.quietChecks, [key]: check } });
  await tx.done;
  touched(sessionId);
  changed();
}

/** Names a saved session; an empty name goes back to the title taken from the problem. */
export async function renameSession(id: string, name: string) {
  touched(id);
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    const renamed: MathTutorDB['sessions']['value'] = { ...existing, customTitle: name.trim() };
    if (!renamed.customTitle) delete renamed.customTitle;
    await tx.store.put(renamed);
  }
  await tx.done;
  touched(id);
  changed();
}

/** Files a saved session in a folder (null: the top level); undefined puts it back where it belongs by default. */
export async function moveSession(id: string, folderId: string | null | undefined) {
  touched(id);
  const db = await getDB();
  const tx = db.transaction('sessions', 'readwrite');
  const existing = await tx.store.get(id);
  if (existing) {
    // filedAt, not updatedAt: a move isn't work on the board, but a restore must still see it as newer.
    const moved: MathTutorDB['sessions']['value'] = { ...existing, folderId, filedAt: Date.now() };
    if (folderId === undefined) delete moved.folderId;
    await tx.store.put(moved);
  }
  await tx.done;
  touched(id);
  changed();
}

/** A saved session, whole: its pictures are in its ink. */
export async function loadSession(id: string) {
  const db = await getDB();
  const tx = db.transaction(['sessions', 'pictures']);
  const before = writes;
  const record = await tx.objectStore('sessions').get(id);
  if (!record) return undefined;
  const session = await withStoredPictures(record, tx.objectStore('pictures'));
  if (writes === before) kept.set(id, keptFields(session));
  return session;
}

export async function deleteSession(id: string) {
  touched(id);
  const db = await getDB();
  const tx = db.transaction(['sessions', 'pictures'], 'readwrite');
  await tx.objectStore('sessions').delete(id);
  await tx.objectStore('pictures').delete(picturesOf(id));
  await tx.done;
  touched(id);
  changed({ deleted: id });
}

/**
 * Every saved session, newest first, without the pictures on its board: each is in the ink with
 * an empty `src`, since a library's pictures together are far too much to hold at once. Lists and
 * checks don't need them; what does (a backup, the tutor reading saved work) takes one session's
 * with `withPictures`. Saving such a session leaves its stored pictures as they are.
 */
export async function listSessions() {
  const db = await getDB();
  const all = await db.getAllFromIndex('sessions', 'by-updated');
  return all.reverse(); // newest first
}

/** Every saved board's stamp fields, read one board at a time so the library is never all in memory. */
export async function listBoardStamps(): Promise<BoardStampFields[]> {
  const db = await getDB();
  const stamps: BoardStampFields[] = [];
  let cursor = await db.transaction('sessions').store.openCursor();
  while (cursor) {
    stamps.push(stampFields(cursor.value));
    cursor = await cursor.continue();
  }
  return stamps;
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
  touched();
  const db = await getDB();
  const tx = db.transaction(['shelf', 'sessions', 'pictures', 'ink'], 'readwrite');
  await tx.objectStore('shelf').delete(id);
  const prefix = `shelf:${id}:`;
  await tx.objectStore('sessions').delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
  await tx.objectStore('pictures').delete(picturesOf(prefix, `${prefix}\uffff`));
  for (const key of await tx.objectStore('ink').index('by-document').getAllKeys(id)) await tx.objectStore('ink').delete(key);
  await tx.done;
  touched();
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
  touched();
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
    if (cursor.value.folderId === id) await cursor.update({ ...cursor.value, folderId: parent, filedAt: now });
    cursor = await cursor.continue();
  }
  await folders.delete(id);
  await tx.done;
  touched();
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

/**
 * What a restore writes for a board this device may already have: the board from whichever copy was
 * worked on last, and where it is filed from whichever was moved last (a move leaves updatedAt alone).
 * Undefined when this device's copy is as new on both.
 */
export function restoredBoard(existing: StoredSession | undefined, incoming: StoredSession): StoredSession | undefined {
  if (!existing) return incoming;
  const newerWork = incoming.updatedAt > existing.updatedAt;
  const newerFiling = (incoming.filedAt ?? 0) > (existing.filedAt ?? 0);
  if (!newerWork && !newerFiling) return undefined;
  const filedBy = newerFiling ? incoming : existing;
  const record: StoredSession = { ...(newerWork ? incoming : existing), folderId: filedBy.folderId, filedAt: filedBy.filedAt };
  if (record.folderId === undefined) delete record.folderId;
  if (record.filedAt === undefined) delete record.filedAt;
  return record;
}

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
  const tx = db.transaction(['sessions', 'pictures', 'shelf', 'settings', 'ink', 'folders'], 'readwrite');
  touched();
  const stored: (() => void)[] = [];
  const written = { sessions: [] as string[], shelf: [] as string[], profile: false, ink: [] as string[], folders: [] as string[], skipped: 0, missingPdfs: [] as string[] };
  for (const folder of folders) {
    const existing = await tx.objectStore('folders').get(folder.id);
    if (existing && existing.updatedAt >= folder.updatedAt) { written.skipped += 1; continue; }
    await tx.objectStore('folders').put(folder);
    written.folders.push(folder.id);
  }
  for (const session of sessions) {
    const record = restoredBoard(await tx.objectStore('sessions').get(session.id), session);
    if (!record) { written.skipped += 1; continue; }
    // Its pictures go to their store; with only the filing restored, this device's stay as they are.
    stored.push(await putBoard(tx as unknown as BoardStores, record));
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
  touched();
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
