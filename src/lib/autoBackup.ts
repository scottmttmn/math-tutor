import { getSetting, hasSavedWork, listFolders, listSessions, listInk, listShelf, loadProfile, onDataChange, setSetting } from '@/lib/db';
import { BOARD_FOLDER, MANIFEST_NAME, PDF_FOLDER, backupFingerprint, backupIndex, boardFile, boardPath, boardStamp } from '@/lib/backup';
import { androidDirectory, androidFolderAllowed, androidFolders, browserDirectory, pickAndroidFolder, releaseAndroidFolder } from '@/lib/backupFolder';
import type { BackupDirectory, BackupStatus } from '@/types';

// Automatic backup to a folder the student picks (say, in Dropbox): the backup's files are written
// into a "Math Tutor backup" folder there shortly after each change. In Chromium, and in the Android
// app through Android's folder picker (src/lib/backupFolder.ts); elsewhere the Backup settings
// offer a download instead. State lives here, outside React, so every page's top
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

const dayName = (at: number) => {
  const day = new Date(at);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** What is kept of the chosen folder: the browser's handle, or the Android app's picked tree. */
type ChosenFolder = FileSystemDirectoryHandle | { android: string; name: string };

let status: BackupStatus = {
  folderSupported: false, androidFolder: false, folderName: null, state: 'off', lastBackupAt: null, lastDownloadAt: null,
  error: null, persisted: null, hasWork: false,
};
const SERVER_STATUS = status;
const listeners = new Set<() => void>();
let saved: SavedState = { lastBackupAt: null, lastDownloadAt: null, fingerprint: null };
let chosen: ChosenFolder | null = null;
let folder: BackupDirectory | null = null;
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
  const android = androidFolders();
  update({ folderSupported: android || typeof window.showDirectoryPicker === 'function', androidFolder: android });
  void init();
}

async function init() {
  void requestPersistentStorage();
  try {
    saved = { ...saved, ...(await getSetting<SavedState>(STATE_KEY)) };
    setFolder((await getSetting<ChosenFolder>(FOLDER_KEY)) ?? null);
    update({ lastBackupAt: saved.lastBackupAt, lastDownloadAt: saved.lastDownloadAt, folderName: folder?.name ?? null, hasWork: await hasSavedWork() });
  } catch { return; /* No IndexedDB: nothing saved to back up. */ }
  onDataChange(() => { update({ hasWork: true }); schedule(BACKUP_DELAY_MS); });
  // Leaving the page: write what is pending now rather than wait for a next visit.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && timer) schedule(0); });
  if (!chosen) return;
  if (status.folderSupported && await allowed(chosen)) {
    update({ state: 'ok' });
    schedule(0);
  } else update({ state: 'paused' });
}

const isAndroid = (kept: ChosenFolder): kept is { android: string; name: string } => typeof (kept as { android?: unknown }).android === 'string';

function setFolder(kept: ChosenFolder | null) {
  chosen = kept;
  folder = !kept ? null : isAndroid(kept) ? androidDirectory(kept.android, kept.name) : browserDirectory(kept);
}

async function allowed(kept: ChosenFolder) {
  if (isAndroid(kept)) return status.androidFolder && androidFolderAllowed(kept.android);
  return (await kept.queryPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted';
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

async function writeBackup(force: boolean) {
  if (!folder || status.state === 'paused' || status.state === 'off') return;
  try {
    const [sessions, shelf, profile, ink, folders] = await Promise.all([listSessions(), listShelf(), loadProfile(), listInk(), listFolders()]);
    const fingerprint = backupFingerprint(sessions, shelf, profile, ink, folders);
    if (!force && fingerprint === saved.fingerprint) { if (status.state !== 'ok') update({ state: 'ok', error: null }); return; }
    update({ state: 'writing' });
    const target = folder.name === BACKUP_FOLDER_NAME ? folder : await folder.directory(BACKUP_FOLDER_NAME);
    const now = Date.now();
    const day = dayName(now);

    // Boards first, then PDFs, so backup.json never lists a file that isn't there yet. Only boards
    // that changed since the last backup (or whose file is gone) are written.
    const boardFolder = await target.directory(BOARD_FOLDER);
    const present = new Set(await boardFolder.names());
    let dayFolder: BackupDirectory | undefined;
    const stamps: Record<string, string> = {};
    for (const session of sessions) {
      const name = fileName(boardPath(session.id));
      const stamp = boardStamp(session);
      stamps[session.id] = stamp;
      if (saved.boards?.[session.id] === stamp && present.has(name)) continue;
      const file = await boardFile(session);
      await boardFolder.write(name, file);
      dayFolder ??= await (await target.directory(HISTORY_FOLDER)).directory(day);
      await dayFolder.write(name, file);
    }
    // PDFs never change, so only new ones are written.
    const pdfFolder = await target.directory(PDF_FOLDER);
    for (const document of shelf) {
      const name = `${document.id}.pdf`;
      if (await pdfFolder.size(name) !== document.file.size) await pdfFolder.write(name, document.file);
    }
    const manifest = await backupIndex(sessions, shelf, profile, ink, folders, now);
    const json = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    await target.write(MANIFEST_NAME, json);
    await target.write(`backup-${day}.json`, json);
    const copies = (await target.names()).filter((name) => DAILY_COPY.test(name));
    for (const old of copies.sort().reverse().slice(DAILY_COPIES)) await target.remove(old).catch(() => undefined);
    // A board deleted here leaves the backup too (its earlier days stay in history/). Only now that
    // backup.json no longer lists it: if a write above failed, the last backup is still whole.
    const kept = new Set(sessions.map((session) => fileName(boardPath(session.id))));
    for (const name of present) if (!kept.has(name)) await boardFolder.remove(name).catch(() => undefined);
    const history = await target.directory(HISTORY_FOLDER);
    const days = (await history.names()).filter((name) => HISTORY_DAY.test(name));
    for (const old of days.sort().reverse().slice(DAILY_COPIES)) await history.remove(old).catch(() => undefined);

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
  let picked: ChosenFolder;
  if (status.androidFolder) {
    const tree = await pickAndroidFolder();
    if (!tree) return false;
    if (chosen && isAndroid(chosen) && chosen.android !== tree.tree) void releaseAndroidFolder(chosen.android);
    picked = { android: tree.tree, name: tree.name };
  } else {
    if (!window.showDirectoryPicker) return false;
    try { picked = await window.showDirectoryPicker({ id: 'math-tutor-backup', mode: 'readwrite', startIn: 'documents' }); } catch { return false; }
  }
  setFolder(picked);
  await setSetting(FOLDER_KEY, picked);
  // A new folder gets every board, even one that holds an older backup's files.
  await saveState({ boards: {} });
  update({ folderName: picked.name, state: 'ok', error: null });
  await backUpNow(true);
  return true;
}

/** Asks the browser again for the folder (from a click), after it paused the backup. */
export async function resumeBackup() {
  if (!chosen) return;
  // Android doesn't ask again: the folder is picked again.
  if (isAndroid(chosen)) { await chooseBackupFolder(); return; }
  const permission = await chosen.requestPermission({ mode: 'readwrite' }).catch(() => 'denied' as PermissionState);
  if (permission !== 'granted') return;
  update({ state: 'ok', error: null });
  await backUpNow();
}

/** Stops backing up to the folder; what was written there stays. */
export async function stopBackup() {
  clearTimeout(timer);
  if (chosen && isAndroid(chosen)) void releaseAndroidFolder(chosen.android);
  setFolder(null);
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
