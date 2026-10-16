import { getSetting, hasSavedWork, listSessions, listInk, listShelf, loadProfile, onDataChange, setSetting } from '@/lib/db';
import { BOARD_FOLDER, MANIFEST_NAME, PDF_FOLDER, backupFingerprint, backupIndex, boardFile, boardPath } from '@/lib/backup';
import type { BackupStatus, Session } from '@/types';

// Automatic backup to a folder the student picks (say, in Dropbox): the backup's files are written
// into a "Math Tutor backup" folder there shortly after each change. Chromium only; elsewhere the
// Backup settings offer a download instead. State lives here, outside React, so every page's top
// bar and the settings share one copy (read it with useBackupStatus).

const FOLDER_KEY = 'backupFolder';
const STATE_KEY = 'backupState';
export const BACKUP_FOLDER_NAME = 'Math Tutor backup';
// Wait for a pause in the writing before backing up; autosave already ran.
const BACKUP_DELAY_MS = 30_000;
// For going back to an earlier day: one dated copy of backup.json per day, and in history/<day>/
// the boards changed that day as they were at its last backup. Kept for this many days.
const DAILY_COPIES = 7;
const DAILY_COPY = /^backup-\d{4}-\d{2}-\d{2}\.json$/;
const HISTORY_FOLDER = 'history';
const HISTORY_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** After this long without a backup, the top bar suggests one. */
export const BACKUP_DUE_MS = 7 * 24 * 60 * 60 * 1000;

interface SavedState {
  lastBackupAt: number | null;
  lastDownloadAt: number | null;
  /** What the last folder backup held (see backupFingerprint), so an unchanged app isn't written again. */
  fingerprint: string | null;
  /** Each board's boardStamp as last written to the folder, so only changed boards are written again. */
  boards?: Record<string, string>;
}

const boardStamp = (session: Pick<Session, 'updatedAt' | 'customTitle'>) => `${session.updatedAt} ${session.customTitle ?? ''}`;
const dayName = (at: number) => {
  const day = new Date(at);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

let status: BackupStatus = {
  folderSupported: false, folderName: null, state: 'off', lastBackupAt: null, lastDownloadAt: null,
  error: null, persisted: null, hasWork: false,
};
const SERVER_STATUS = status;
const listeners = new Set<() => void>();
let saved: SavedState = { lastBackupAt: null, lastDownloadAt: null, fingerprint: null };
let folder: FileSystemDirectoryHandle | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> = Promise.resolve();
let started = false;

function update(patch: Partial<BackupStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((listener) => listener());
}

export function subscribeBackup(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getBackupStatus = () => status;
export const getServerBackupStatus = () => SERVER_STATUS;

async function saveState(patch: Partial<SavedState>) {
  saved = { ...saved, ...patch };
  await setSetting(STATE_KEY, saved).catch(() => undefined);
}

/** Loads the saved folder and starts watching for changes. Runs once per page load. */
export function startAutoBackup() {
  if (started || typeof window === 'undefined') return;
  started = true;
  update({ folderSupported: typeof window.showDirectoryPicker === 'function' });
  void init();
}

async function init() {
  void requestPersistentStorage();
  try {
    saved = { ...saved, ...(await getSetting<SavedState>(STATE_KEY)) };
    folder = (await getSetting<FileSystemDirectoryHandle>(FOLDER_KEY)) ?? null;
    update({ lastBackupAt: saved.lastBackupAt, lastDownloadAt: saved.lastDownloadAt, folderName: folder?.name ?? null, hasWork: await hasSavedWork() });
  } catch { return; /* No IndexedDB: nothing saved to back up. */ }
  onDataChange(() => { update({ hasWork: true }); schedule(BACKUP_DELAY_MS); });
  // Leaving the page: write what is pending now rather than wait for a next visit.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) schedule(0); });
  if (!folder) return;
  if (status.folderSupported && (await folder.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted') {
    update({ state: 'ok' });
    schedule(0);
  } else update({ state: 'paused' });
}

async function requestPersistentStorage() {
  const storage = navigator.storage;
  if (!storage?.persisted) return;
  try {
    let persisted = await storage.persisted();
    // Chromium decides by itself (no prompt); Firefox asks.
    if (!persisted && storage.persist) persisted = await storage.persist();
    update({ persisted });
  } catch { /* Unknown; Backup settings say nothing about it. */ }
}

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => { timer = undefined; void backUpNow(); }, delay);
}

/** Writes the backup to the folder if anything changed since the last one (or always, when forced); either way only changed boards are rewritten. */
export function backUpNow(force = false): Promise<void> {
  running = running.then(() => writeBackup(force));
  return running;
}

async function writeFile(directory: FileSystemDirectoryHandle, name: string, contents: Blob) {
  const file = await directory.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try { await writable.write(contents); } catch (error) { await writable.abort().catch(() => undefined); throw error; }
  await writable.close();
}

async function writeBackup(force: boolean) {
  if (!folder || status.state === 'paused' || status.state === 'off') return;
  try {
    const [sessions, shelf, profile, ink] = await Promise.all([listSessions(), listShelf(), loadProfile(), listInk()]);
    const fingerprint = backupFingerprint(sessions, shelf, profile, ink);
    if (!force && fingerprint === saved.fingerprint) { if (status.state !== 'ok') update({ state: 'ok', error: null }); return; }
    update({ state: 'writing' });
    const target = folder.name === BACKUP_FOLDER_NAME ? folder : await folder.getDirectoryHandle(BACKUP_FOLDER_NAME, { create: true });
    const now = Date.now();
    const day = dayName(now);

    // Boards first, then PDFs, so backup.json never lists a file that isn't there yet. Only boards
    // that changed since the last backup (or whose file is gone) are written.
    const boardFolder = await target.getDirectoryHandle(BOARD_FOLDER, { create: true });
    const present = new Set<string>();
    for await (const name of boardFolder.keys()) present.add(name);
    let dayFolder: FileSystemDirectoryHandle | undefined;
    const stamps: Record<string, string> = {};
    for (const session of sessions) {
      const name = fileName(boardPath(session.id));
      const stamp = boardStamp(session);
      stamps[session.id] = stamp;
      if (saved.boards?.[session.id] === stamp && present.has(name)) continue;
      const file = await boardFile(session);
      await writeFile(boardFolder, name, file);
      dayFolder ??= await (await target.getDirectoryHandle(HISTORY_FOLDER, { create: true })).getDirectoryHandle(day, { create: true });
      await writeFile(dayFolder, name, file);
    }
    // A board deleted here leaves the backup too (its earlier days stay in history/).
    const kept = new Set(sessions.map((session) => fileName(boardPath(session.id))));
    for (const name of present) if (!kept.has(name)) await boardFolder.removeEntry(name).catch(() => undefined);

    // PDFs never change, so only new ones are written.
    const pdfFolder = await target.getDirectoryHandle(PDF_FOLDER, { create: true });
    for (const document of shelf) {
      const name = `${document.id}.pdf`;
      const existing = await pdfFolder.getFileHandle(name).then((handle) => handle.getFile()).catch(() => null);
      if (existing?.size !== document.file.size) await writeFile(pdfFolder, name, document.file);
    }
    const manifest = await backupIndex(sessions, shelf, profile, ink, now);
    const json = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    await writeFile(target, MANIFEST_NAME, json);
    await writeFile(target, `backup-${day}.json`, json);
    const copies: string[] = [];
    for await (const name of target.keys()) if (DAILY_COPY.test(name)) copies.push(name);
    for (const old of copies.sort().reverse().slice(DAILY_COPIES)) await target.removeEntry(old).catch(() => undefined);
    const history = await target.getDirectoryHandle(HISTORY_FOLDER, { create: true });
    const days: string[] = [];
    for await (const name of history.keys()) if (HISTORY_DAY.test(name)) days.push(name);
    for (const old of days.sort().reverse().slice(DAILY_COPIES)) await history.removeEntry(old, { recursive: true }).catch(() => undefined);

    await saveState({ lastBackupAt: manifest.createdAt, fingerprint, boards: stamps });
    update({ state: 'ok', error: null, lastBackupAt: manifest.createdAt });
  } catch (error) {
    // Permission was taken back (or expired): wait for the student to allow it again.
    if ((error as DOMException)?.name === 'NotAllowedError') update({ state: 'paused' });
    else update({ state: 'error', error: error instanceof Error ? error.message : 'The backup could not be written.' });
  }
}

/** Asks for a folder (from a click) and backs up to it right away. False if the student cancelled. */
export async function chooseBackupFolder(): Promise<boolean> {
  if (!window.showDirectoryPicker) return false;
  let picked: FileSystemDirectoryHandle;
  try { picked = await window.showDirectoryPicker({ id: 'math-tutor-backup', mode: 'readwrite', startIn: 'documents' }); } catch { return false; }
  folder = picked;
  await setSetting(FOLDER_KEY, picked);
  // A new folder gets every board, even one that holds an older backup's files.
  await saveState({ boards: {} });
  update({ folderName: picked.name, state: 'ok', error: null });
  await backUpNow(true);
  return true;
}

/** Asks the browser again for the folder (from a click), after it paused the backup. */
export async function resumeBackup() {
  if (!folder) return;
  const permission = await folder.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as PermissionState);
  if (permission !== 'granted') return;
  update({ state: 'ok', error: null });
  await backUpNow();
}

/** Stops backing up to the folder; what was written there stays. */
export async function stopBackup() {
  clearTimeout(timer);
  folder = null;
  await setSetting(FOLDER_KEY, undefined);
  await saveState({ fingerprint: null, boards: {} });
  update({ folderName: null, state: 'off', error: null });
}

/** Notes that a backup was downloaded, for the "last backup" line and the reminder. */
export async function recordDownload(at = Date.now()) {
  await saveState({ lastDownloadAt: at });
  update({ lastDownloadAt: at });
}

/** True when there is work and no backup of it (folder or download) in the last week. */
export function backupDue(current: BackupStatus, now = Date.now()) {
  if (!current.hasWork || current.state === 'ok' || current.state === 'writing') return false;
  const last = Math.max(current.lastBackupAt ?? 0, current.lastDownloadAt ?? 0);
  return now - last > BACKUP_DUE_MS;
}
