import { Capacitor, registerPlugin } from '@capacitor/core';
import { listFolders, listInk, listSessions, listShelf, loadProfile, restoreRecords } from '@/lib/db';
import { readZip, writeZip } from '@/lib/zip';
import { writeInChunks } from '@/lib/nativeFiles';
import { MAX_NOTEBOOK, RATINGS, favoriteEntry } from '@/lib/learnerProfile';
import type { BackupManifest, BackupSession, FavoriteProblem, Folder, InkStroke, LearnerProfile, PageInk, ProfileTopic, RestoreResult, SaveFilePlugin, Session, ShelfDocument, TopicRating, TutorNote } from '@/types';

const TOPIC_RATINGS: (TopicRating | null)[] = RATINGS.map((option) => option.rating);

// A backup is backup.json (every Shelf entry with its cover, marks and the ink on its pages, the
// folders, the tutor memory, and a list of the boards), each board as boards/<id>.json (with its thumbnail and
// problem picture), and each Shelf PDF as pdfs/<id>.pdf. Boards are files of their own so that a
// folder backup rewrites only the boards that changed (see autoBackup.ts), however many there are.
// The download is all of it in one ZIP; a backup folder holds the same files side by side, so
// restoring a folder is restoring its files. Version 1 backups (boards inline in backup.json) still restore.
export const MANIFEST_NAME = 'backup.json';
export const PDF_FOLDER = 'pdfs';
export const BOARD_FOLDER = 'boards';
export const pdfPath = (id: string) => `${PDF_FOLDER}/${id}.pdf`;
// Board ids hold ':' (Shelf boards), which Windows doesn't allow in a file name.
const fileSafe = (id: string) => encodeURIComponent(id).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const boardPath = (id: string) => `${BOARD_FOLDER}/${fileSafe(id)}.json`;

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) throw new Error('Not a data URL');
  if (!match[2]) return new Blob([decodeURIComponent(match[3])], { type: match[1] });
  const binary = atob(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}

/** A board as it goes in a backup: the thumbnail Blob as a data URL. */
export async function boardRecord({ canvasImageBlob, ...session }: Session): Promise<BackupSession> {
  return { ...session, canvasImage: canvasImageBlob ? await blobToDataUrl(canvasImageBlob) : null };
}

export const boardFile = async (session: Session) => new Blob([JSON.stringify(await boardRecord(session))], { type: 'application/json' });

/** backup.json for these records; the boards' own files are made with boardFile. */
export async function backupIndex(sessions: Pick<Session, 'id'>[], shelf: ShelfDocument[], profile?: LearnerProfile, ink: PageInk[] = [], folders: Folder[] = [], now = Date.now()): Promise<BackupManifest> {
  return {
    app: 'math-tutor',
    version: 2,
    createdAt: now,
    boards: sessions.map(({ id }) => ({ id, file: boardPath(id) })),
    shelf: await Promise.all(shelf.map(async (document) => {
      const { file, cover, ...rest } = document;
      void file; // The PDF goes beside backup.json, not in it.
      return { ...rest, cover: cover ? await blobToDataUrl(cover) : null };
    })),
    ...(profile ? { profile } : {}),
    ...(ink.length ? { ink } : {}),
    ...(folders.length ? { folders } : {}),
  };
}

/** The backup of these records: backup.json's contents, and the boards' and PDFs' files by path. */
export async function buildBackup(sessions: Session[], shelf: ShelfDocument[], profile?: LearnerProfile, ink: PageInk[] = [], folders: Folder[] = [], now = Date.now()) {
  const manifest = await backupIndex(sessions, shelf, profile, ink, folders, now);
  const boards = new Map(await Promise.all(sessions.map(async (session) => [boardPath(session.id), await boardFile(session)] as const)));
  const pdfs = new Map(shelf.map((document) => [pdfPath(document.id), document.file] as const));
  return { manifest, boards, pdfs };
}

/** Everything saved on this device. */
export async function collectBackup() {
  const [sessions, shelf, profile, ink, folders] = await Promise.all([listSessions(), listShelf(), loadProfile(), listInk(), listFolders()]);
  return buildBackup(sessions, shelf, profile, ink, folders);
}

/** Changes whenever a board, Shelf entry, folder or page of ink is added, changed, renamed, moved or removed. */
export function backupFingerprint(
  sessions: Pick<Session, 'id' | 'updatedAt' | 'customTitle' | 'folderId' | 'filedAt'>[],
  shelf: Pick<ShelfDocument, 'id' | 'updatedAt' | 'folderId'>[],
  profile?: Pick<LearnerProfile, 'updatedAt'>,
  ink: Pick<PageInk, 'id' | 'updatedAt'>[] = [],
  folders: Pick<Folder, 'id' | 'updatedAt'>[] = [],
) {
  return [
    ...sessions.map((session) => `s ${session.id} ${boardStamp(session)}`),
    ...shelf.map((document) => `p ${document.id} ${document.updatedAt} ${document.folderId ?? ''}`),
    ...(profile ? [`m ${profile.updatedAt}`] : []),
    ...ink.map((page) => `i ${page.id} ${page.updatedAt}`),
    ...folders.map((folder) => `f ${folder.id} ${folder.updatedAt}`),
  ].sort().join('\n');
}

/** Changes when a board's file would: it was saved, renamed or moved. */
export const boardStamp = (session: Pick<Session, 'updatedAt' | 'customTitle' | 'folderId' | 'filedAt'>) =>
  `${session.updatedAt} ${session.customTitle ?? ''} ${session.folderId === undefined ? '' : session.folderId ?? '/'} ${session.filedAt ?? ''}`;

export const backupFileName = (date = new Date()) =>
  `math-tutor-backup-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.zip`;

/** One ZIP of everything: backup.json, the boards and the Shelf's PDFs. */
export async function backupZip(): Promise<Blob> {
  const { manifest, boards, pdfs } = await collectBackup();
  const files = new Map<string, Blob>([[MANIFEST_NAME, new Blob([JSON.stringify(manifest)], { type: 'application/json' })], ...boards, ...pdfs]);
  return writeZip(files);
}

export function parseManifest(text: string): BackupManifest {
  let manifest: BackupManifest;
  try { manifest = JSON.parse(text); } catch { throw new Error('The backup file is damaged.'); }
  if (manifest?.app !== 'math-tutor' || !(Array.isArray(manifest.sessions) || Array.isArray(manifest.boards)) || !Array.isArray(manifest.shelf)) {
    throw new Error('This is not a Math Tutor backup.');
  }
  if (manifest.version > 2) throw new Error('This backup is from a newer version of the app. Update it, then restore.');
  return manifest;
}

/** The backup's boards: inline (version 1) or read from their files, which `files` holds by path. */
async function backupBoards(manifest: BackupManifest, files: Map<string, Blob>) {
  if (!manifest.boards) return { boards: manifest.sessions ?? [], missing: 0 };
  const boards: BackupSession[] = [];
  let missing = 0;
  for (const entry of manifest.boards) {
    const file = entry && typeof entry.id === 'string' ? files.get(boardPath(entry.id)) : undefined;
    let board: BackupSession | undefined;
    try { board = file ? JSON.parse(await file.text()) : undefined; } catch { board = undefined; }
    // A damaged board file is left out, not the whole restore.
    if (board?.id === entry?.id && Number.isFinite(board.updatedAt)) boards.push(board);
    else missing += 1;
  }
  return { boards, missing };
}

/** Puts a backup's records on this device; newer copies already here are kept. */
export async function restoreManifest(manifest: BackupManifest, files: Map<string, Blob>): Promise<RestoreResult> {
  const { boards, missing } = await backupBoards(manifest, files);
  // Only backup.json was picked: say so, rather than restore everything but the boards. A board
  // file that is there but damaged is counted instead, and the rest restores.
  if (missing > 0 && ![...files.keys()].some((path) => path.startsWith(`${BOARD_FOLDER}/`))) {
    throw new Error('The boards weren’t with backup.json. Pick the whole backup folder, or the backup ZIP.');
  }
  const sessions = boards.map(({ canvasImage, ...session }) => ({
    ...session, canvasImageBlob: canvasImage ? dataUrlToBlob(canvasImage) : null,
  }));
  const shelf = manifest.shelf.map(({ cover, ...document }) => {
    const file = files.get(pdfPath(document.id));
    return { ...document, cover: cover ? dataUrlToBlob(cover) : null, file: file ? new Blob([file], { type: 'application/pdf' }) : null };
  });
  const ink = Array.isArray(manifest.ink) ? manifest.ink.map(validPageInk).filter((page): page is PageInk => page !== undefined) : [];
  const folders = Array.isArray(manifest.folders) ? manifest.folders.map(validFolder).filter((folder): folder is Folder => folder !== undefined) : [];
  const written = await restoreRecords(sessions, shelf, validProfile(manifest.profile), ink, folders);
  return {
    restoredSessions: written.sessions.length, restoredShelf: written.shelf.length, restoredFolders: written.folders.length,
    restoredProfile: written.profile, restoredInk: written.ink.length,
    skipped: written.skipped, missingPdfs: written.missingPdfs, missingBoards: missing,
  };
}

// The tutor memory is sent with every question, so only a well-formed one is restored.
function validProfile(profile: unknown): LearnerProfile | undefined {
  const candidate = profile as LearnerProfile | undefined;
  if (!candidate || typeof candidate.aboutMe !== 'string' || !Array.isArray(candidate.topics) || !Number.isFinite(candidate.updatedAt)) return undefined;
  // A malformed topic is dropped rather than losing the rest.
  const topics = (candidate.topics as unknown[]).filter((topic): topic is ProfileTopic => {
    const t = topic as ProfileTopic | null;
    return !!t && typeof t.id === 'string' && typeof t.name === 'string' && typeof t.area === 'string'
      && (t.rating === null || TOPIC_RATINGS.includes(t.rating));
  }).map(({ id, name, area, rating, tutor }) => {
    const note = validTutorNote(tutor);
    return { id, name, area, rating, ...(note ? { tutor: note } : {}) };
  });
  const favorites = Array.isArray(candidate.favorites) ? (candidate.favorites as unknown[]).flatMap((item) => {
    const f = item as FavoriteProblem | null;
    return f && typeof f.id === 'string' && typeof f.title === 'string' && Number.isFinite(f.createdAt)
      ? [favoriteEntry(f.id, f.title, typeof f.problem === 'string' ? f.problem : '', typeof f.reason === 'string' ? f.reason : '', f.createdAt)] : [];
  }) : [];
  const notebook = candidate.notebook;
  const validNotebook = notebook && typeof notebook.text === 'string' && notebook.text.trim() && Number.isFinite(notebook.updatedAt)
    ? { text: notebook.text.slice(0, MAX_NOTEBOOK), updatedAt: notebook.updatedAt, ...(notebook.edited === true ? { edited: true } : {}) } : undefined;
  return {
    aboutMe: candidate.aboutMe, topics, shareWithTutor: candidate.shareWithTutor !== false, updatedAt: candidate.updatedAt,
    ...(favorites.length ? { favorites } : {}), ...(validNotebook ? { notebook: validNotebook } : {}),
  };
}

function validTutorNote(note: unknown): TutorNote | undefined {
  const t = note as TutorNote | undefined;
  if (!t || !TOPIC_RATINGS.includes(t.level) || !['low', 'medium', 'high'].includes(t.confidence)
    || typeof t.note !== 'string' || !Number.isFinite(t.updatedAt)) return undefined;
  return { level: t.level, confidence: t.confidence, note: t.note, updatedAt: t.updatedAt, ...(t.edited === true ? { edited: true } : {}) };
}

function validFolder(folder: unknown): Folder | undefined {
  const f = folder as Folder | null;
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || !(f.parentId === null || typeof f.parentId === 'string')
    || !Number.isFinite(f.createdAt) || !Number.isFinite(f.updatedAt)) return undefined;
  return { id: f.id, name: f.name, parentId: f.parentId === f.id ? null : f.parentId, createdAt: f.createdAt, updatedAt: f.updatedAt };
}

// Ink is drawn straight from these numbers, so a damaged page is left out and its stroke checked.
function validPageInk(page: unknown): PageInk | undefined {
  const p = page as PageInk | null;
  if (!p || typeof p.documentId !== 'string' || !Number.isInteger(p.page) || p.page < 1 || !Number.isFinite(p.updatedAt) || !Array.isArray(p.strokes)) return undefined;
  const strokes = (p.strokes as unknown[]).filter((stroke): stroke is InkStroke => {
    const s = stroke as InkStroke | null;
    return !!s && (s.tool === 'pen' || s.tool === 'highlighter') && Array.isArray(s.points) && s.points.length % 3 === 0
      && s.points.every((value) => Number.isFinite(value));
  }).map(({ tool, points }) => ({ tool, points }));
  return strokes.length ? { id: `${p.documentId}:${p.page}`, documentId: p.documentId, page: p.page, strokes, updatedAt: p.updatedAt } : undefined;
}

// A folder picked with <input webkitdirectory> names files from the picked folder ("Backup/pdfs/x.pdf").
const relativeName = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

const DATED_COPY = /^backup-(\d{4}-\d{2}-\d{2})\.json$/;

/** The earlier days a picked backup folder can go back to (its dated copies), newest first. */
export function backupDays(files: File[]): string[] {
  return files.filter((file) => !/(?:^|\/)(boards|history)\//.test(relativeName(file)))
    .map((file) => DATED_COPY.exec(file.name)?.[1])
    .filter((day): day is string => day !== undefined)
    .sort().reverse();
}

/**
 * Restores from what the student picked: the downloaded ZIP, a backup folder's files, or just its
 * backup.json (then only PDFs already on this device come back; boards need their files, except
 * in a version 1 backup.json, which holds them). With `day`, a folder is restored as it was at that
 * day's last backup: its dated copy, and each board as history/ last kept it on or before that day.
 */
export async function restoreFromFiles(files: File[], day?: string): Promise<RestoreResult> {
  const zip = files.find((file) => /\.zip$/i.test(file.name));
  if (zip) {
    const entries = await readZip(zip).catch(() => { throw new Error('The ZIP file could not be read.'); });
    const manifest = entries.get(MANIFEST_NAME);
    if (!manifest) throw new Error('This ZIP is not a Math Tutor backup.');
    return restoreManifest(parseManifest(await manifest.text()), entries);
  }
  // The folder's own backup.json (or the chosen day's copy), not a dated copy beside it, unless that is all there is.
  const top = files.filter((file) => /\.json$/i.test(file.name) && !/(?:^|\/)(boards|history)\//.test(relativeName(file)));
  const manifests = day ? top.filter((file) => file.name === `backup-${day}.json`)
    : top.sort((a, b) => Number(b.name === MANIFEST_NAME) - Number(a.name === MANIFEST_NAME) || b.name.localeCompare(a.name));
  if (!manifests[0]) throw new Error('Pick the backup ZIP, or the backup folder.');
  // Each file by its path in the backup (pdfs/<id>.pdf, boards/<id>.json), as the backup wrote it.
  // A board comes from boards/ (now), or for an earlier day from the newest history/<day>/ copy up
  // to that day; either way the other is the fallback when its file is missing.
  const byPath = new Map<string, Blob>();
  const history = new Map<string, { day: string; file: File }[]>();
  for (const file of files) {
    const path = relativeName(file);
    const match = /(?:^|\/)((?:pdfs\/[^/]+\.pdf)|(?:boards\/[^/]+\.json))$/.exec(path);
    if (match) { byPath.set(match[1], file); continue; }
    const kept = /(?:^|\/)history\/(\d{4}-\d{2}-\d{2})\/([^/]+\.json)$/.exec(path);
    if (kept) history.set(kept[2], [...(history.get(kept[2]) ?? []), { day: kept[1], file }]);
  }
  for (const [name, copies] of history) {
    const path = `${BOARD_FOLDER}/${name}`;
    const usable = copies.filter((copy) => !day || copy.day <= day).sort((a, b) => b.day.localeCompare(a.day));
    if (usable[0] && (day || !byPath.has(path))) byPath.set(path, usable[0].file);
  }
  return restoreManifest(parseManifest(await manifests[0].text()), byPath);
}

/** Saves a file through the browser's download. */
export async function downloadBlob(blob: Blob, name: string): Promise<boolean> {
  // The Android app's WebView can't save a blob: link, so there the file goes through Android's
  // own Save dialog (SaveFilePlugin in android/), in pieces. False when the student cancels it.
  if (Capacitor.isNativePlatform()) {
    const { id } = await SaveFile.open({ name, mimeType: blob.type || 'application/octet-stream' });
    if (!id) return false;
    await writeInChunks(SaveFile, id, blob);
    return true;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

const SaveFile = registerPlugin<SaveFilePlugin>('SaveFile');
