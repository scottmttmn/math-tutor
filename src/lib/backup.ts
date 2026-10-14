import { listSessions, listShelf, loadProfile, restoreRecords } from '@/lib/db';
import { readZip, writeZip } from '@/lib/zip';
import type { BackupManifest, LearnerProfile, RestoreResult, Session, ShelfDocument } from '@/types';

// A backup is backup.json (every board, with its thumbnail and problem picture, and every Shelf
// entry with its cover and marks) plus each Shelf PDF as pdfs/<id>.pdf. The download is all of it
// in one ZIP; a backup folder holds the same files side by side (see autoBackup.ts), so restoring
// a folder is restoring its files.
export const MANIFEST_NAME = 'backup.json';
export const PDF_FOLDER = 'pdfs';
export const pdfPath = (id: string) => `${PDF_FOLDER}/${id}.pdf`;

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

/** The backup of these records: backup.json's contents, and the PDFs by path. */
export async function buildBackup(sessions: Session[], shelf: ShelfDocument[], profile?: LearnerProfile, now = Date.now()) {
  const manifest: BackupManifest = {
    app: 'math-tutor',
    version: 1,
    createdAt: now,
    sessions: await Promise.all(sessions.map(async ({ canvasImageBlob, ...session }) => ({
      ...session, canvasImage: canvasImageBlob ? await blobToDataUrl(canvasImageBlob) : null,
    }))),
    shelf: await Promise.all(shelf.map(async (document) => {
      const { file, cover, ...rest } = document;
      void file; // The PDF goes beside backup.json, not in it.
      return { ...rest, cover: cover ? await blobToDataUrl(cover) : null };
    })),
    ...(profile ? { profile } : {}),
  };
  const pdfs = new Map(shelf.map((document) => [pdfPath(document.id), document.file] as const));
  return { manifest, pdfs };
}

/** Everything saved on this device. */
export async function collectBackup() {
  const [sessions, shelf, profile] = await Promise.all([listSessions(), listShelf(), loadProfile()]);
  return buildBackup(sessions, shelf, profile);
}

/** Changes whenever a board or Shelf entry is added, changed, renamed or removed. */
export function backupFingerprint(
  sessions: Pick<Session, 'id' | 'updatedAt' | 'customTitle'>[],
  shelf: Pick<ShelfDocument, 'id' | 'updatedAt'>[],
  profile?: Pick<LearnerProfile, 'updatedAt'>,
) {
  return [
    ...sessions.map((session) => `s ${session.id} ${session.updatedAt} ${session.customTitle ?? ''}`),
    ...shelf.map((document) => `p ${document.id} ${document.updatedAt}`),
    ...(profile ? [`m ${profile.updatedAt}`] : []),
  ].sort().join('\n');
}

export const backupFileName = (date = new Date()) =>
  `math-tutor-backup-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.zip`;

/** One ZIP of everything: backup.json and the Shelf's PDFs. */
export async function backupZip(): Promise<Blob> {
  const { manifest, pdfs } = await collectBackup();
  const files = new Map<string, Blob>([[MANIFEST_NAME, new Blob([JSON.stringify(manifest)], { type: 'application/json' })], ...pdfs]);
  return writeZip(files);
}

export function parseManifest(text: string): BackupManifest {
  let manifest: BackupManifest;
  try { manifest = JSON.parse(text); } catch { throw new Error('The backup file is damaged.'); }
  if (manifest?.app !== 'math-tutor' || !Array.isArray(manifest.sessions) || !Array.isArray(manifest.shelf)) {
    throw new Error('This is not a Math Tutor backup.');
  }
  if (manifest.version > 1) throw new Error('This backup is from a newer version of the app. Update it, then restore.');
  return manifest;
}

/** Puts a backup's records on this device; newer copies already here are kept. */
export async function restoreManifest(manifest: BackupManifest, pdfs: Map<string, Blob>): Promise<RestoreResult> {
  const sessions = manifest.sessions.map(({ canvasImage, ...session }) => ({
    ...session, canvasImageBlob: canvasImage ? dataUrlToBlob(canvasImage) : null,
  }));
  const shelf = manifest.shelf.map(({ cover, ...document }) => {
    const file = pdfs.get(pdfPath(document.id));
    return { ...document, cover: cover ? dataUrlToBlob(cover) : null, file: file ? new Blob([file], { type: 'application/pdf' }) : null };
  });
  const written = await restoreRecords(sessions, shelf, validProfile(manifest.profile));
  return {
    restoredSessions: written.sessions.length, restoredShelf: written.shelf.length, restoredProfile: written.profile,
    skipped: written.skipped, missingPdfs: written.missingPdfs,
  };
}

// The tutor memory is sent with every question, so only a well-formed one is restored.
function validProfile(profile: unknown): LearnerProfile | undefined {
  const candidate = profile as LearnerProfile | undefined;
  if (!candidate || typeof candidate.aboutMe !== 'string' || !Array.isArray(candidate.topics) || !Number.isFinite(candidate.updatedAt)) return undefined;
  return { ...candidate, shareWithTutor: candidate.shareWithTutor !== false };
}

// A folder picked with <input webkitdirectory> names files from the picked folder ("Backup/pdfs/x.pdf").
const relativeName = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;

/**
 * Restores from what the student picked: the downloaded ZIP, a backup folder's files, or just its
 * backup.json (then only PDFs already on this device come back).
 */
export async function restoreFromFiles(files: File[]): Promise<RestoreResult> {
  const zip = files.find((file) => /\.zip$/i.test(file.name));
  if (zip) {
    const entries = await readZip(zip).catch(() => { throw new Error('The ZIP file could not be read.'); });
    const manifest = entries.get(MANIFEST_NAME);
    if (!manifest) throw new Error('This ZIP is not a Math Tutor backup.');
    return restoreManifest(parseManifest(await manifest.text()), entries);
  }
  // The folder's own backup.json, not a dated copy beside it, unless that is all there is.
  const manifests = files.filter((file) => /\.json$/i.test(file.name)).sort((a, b) => Number(b.name === MANIFEST_NAME) - Number(a.name === MANIFEST_NAME) || b.name.localeCompare(a.name));
  if (!manifests[0]) throw new Error('Pick the backup ZIP, or the backup folder.');
  const pdfs = new Map<string, Blob>();
  for (const file of files) {
    const match = /(?:^|\/)pdfs\/([^/]+\.pdf)$/i.exec(relativeName(file));
    if (match) pdfs.set(`${PDF_FOLDER}/${match[1]}`, file);
  }
  return restoreManifest(parseManifest(await manifests[0].text()), pdfs);
}

/** Saves a file through the browser's download. */
export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
