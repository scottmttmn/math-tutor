import { v4 as uuidv4 } from 'uuid';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bookFolder, bookFolderId, deleteSession, deleteShelfDocument, loadSession, loadShelfDocument, saveFolder, saveSession, saveShelfDocument, shelfSessionId } from '@/lib/db';
import { cropPage, imageFileToPng, openPdf, pageImage, renderCover } from '@/lib/pdf';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import type { ChatMessage, PageRect, ShelfDocument, ShelfExercise, ShelfKind, ShelfMarkKind } from '@/types';


const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim() || 'Untitled';

/** The kinds a Shelf PDF can be, as the card names them. */
export const SHELF_KINDS: { kind: ShelfKind; label: string }[] = [
  { kind: 'textbook', label: 'Textbook' }, { kind: 'problem-set', label: 'Problem set' }, { kind: 'handout', label: 'Handout' },
];

/** Sets what a Shelf PDF is, on the stored record (the reader may have moved on since it was listed). */
export async function setShelfKind(document: ShelfDocument, kind: ShelfKind): Promise<ShelfDocument> {
  const latest = (await loadShelfDocument(document.id)) ?? document;
  const updated = { ...latest, kind, updatedAt: Date.now() };
  await saveShelfDocument(updated);
  return updated;
}

/**
 * Puts a PDF in the library, in a folder of its own named after it, inside `parentId` (null: the
 * top level). Throws when the file can't be read as a PDF.
 */
export async function addToShelf(file: File, parentId: string | null = null): Promise<ShelfDocument> {
  if (!isPdf(file)) throw new Error('Not a PDF');
  const pdf = await openPdf(file);
  try {
    const now = Date.now();
    const id = uuidv4();
    const document: ShelfDocument = {
      id, title: baseName(file.name), file, pageCount: pdf.numPages,
      cover: await renderCover(pdf).catch(() => null), lastPage: 1, exercises: [], createdAt: now, updatedAt: now, folderId: bookFolderId(id),
    };
    await saveFolder({ ...bookFolder(document, now), parentId });
    await saveShelfDocument(document);
    return document;
  } finally { void pdf.loadingTask.destroy(); }
}

/** A picture of a file for a problem board's figure: an image, or a PDF's first page (PNG, base64). */
export async function problemImageFromFile(file: File): Promise<string> {
  if (!isPdf(file)) return imageFileToPng(file);
  const pdf = await openPdf(file);
  try { return await pageImage(pdf); } finally { void pdf.loadingTask.destroy(); }
}

/** Whether a mark is a note page (a Notes board) rather than an exercise. */
export const isNote = (mark: ShelfExercise) => mark.kind === 'note';

/** The problem text, or a note page's topic (and, cut to 50 characters, the board's title); the marked region goes with it as the problem image. */
export const exerciseStatement = (document: ShelfDocument, exercise: ShelfExercise) =>
  `${exercise.label} · ${document.title}, p. ${exercise.page}`;

/**
 * Makes sure an exercise or note page has its board, creating it with a picture of the marked region
 * if needed (filed in `folderId`; unset: its book's folder).
 */
export async function ensureExerciseBoard(pdf: PDFDocumentProxy, document: ShelfDocument, exercise: ShelfExercise, chatHistory: ChatMessage[] = [], folderId?: string | null) {
  const id = shelfSessionId(document.id, exercise.id);
  if (await loadSession(id)) return id;
  const now = Date.now();
  const problemStatement = exerciseStatement(document, exercise);
  await saveSession({
    id, title: problemStatement.slice(0, 50), problemStatement, problemImage: await cropPage(pdf, exercise.page, exercise.rect),
    canvasStrokes: [], canvasDocument: null, canvasImageBlob: null, chatHistory, createdAt: now, updatedAt: now,
    isSolved: false, sessionType: isNote(exercise) ? 'note' : 'problem', ...(folderId !== undefined ? { folderId } : {}),
  });
  return id;
}

/**
 * Marks a region of a page as an exercise or a note page, with its own board (starting with
 * `chatHistory`, as when a question about the page is saved as a note page). With `folder`, the
 * board is filed there (a folder other than the book's) and the next mark starts on it. Returns the updated document.
 */
export async function markExercise(
  pdf: PDFDocumentProxy, document: ShelfDocument, page: number, rect: PageRect, label: string, kind: ShelfMarkKind = 'exercise',
  chatHistory: ChatMessage[] = [], folder?: string,
): Promise<{ document: ShelfDocument; exercise: ShelfExercise }> {
  const exercise: ShelfExercise = {
    id: uuidv4(), ...(kind === 'note' ? { kind } : {}), label: label.trim() || nextLabel(document, kind), page, rect, createdAt: Date.now(),
  };
  const ownFolder = !folder || folder === document.folderId;
  await ensureExerciseBoard(pdf, document, exercise, chatHistory, ownFolder ? undefined : folder);
  const updated: ShelfDocument = { ...document, exercises: [...document.exercises, exercise], updatedAt: Date.now() };
  if (folder !== undefined) {
    if (ownFolder) delete updated.markFolderId;
    else updated.markFolderId = folder;
  }
  await saveShelfDocument(updated);
  return { document: updated, exercise };
}

/** Sets the first page the tutor reads for an exercise (0 for none). Returns the updated document. */
export async function setReadFrom(document: ShelfDocument, exerciseId: string, readFrom: number): Promise<ShelfDocument> {
  const updated = {
    ...document, updatedAt: Date.now(),
    exercises: document.exercises.map((item) => (item.id === exerciseId ? { ...item, readFrom } : item)),
  };
  await saveShelfDocument(updated);
  return updated;
}

/** A name for the next mark: one past the highest "Exercise N" (or "Note N") so far. */
export function nextLabel(document: ShelfDocument, kind: ShelfMarkKind = 'exercise') {
  const word = kind === 'note' ? 'Note' : 'Exercise';
  const pattern = new RegExp(`^${word} (\\d+)$`);
  const numbers = document.exercises.map((item) => Number(pattern.exec(item.label)?.[1] ?? 0));
  return `${word} ${Math.max(0, ...numbers) + 1}`;
}

/** Removes a marked exercise or note page and its board. */
export async function unmarkExercise(document: ShelfDocument, exerciseId: string): Promise<ShelfDocument> {
  const updated = { ...document, exercises: document.exercises.filter((item) => item.id !== exerciseId), updatedAt: Date.now() };
  await saveShelfDocument(updated);
  const id = shelfSessionId(document.id, exerciseId);
  await deleteSession(id);
  discardRecoveryCopy(id);
  return updated;
}

/** Removes a PDF from the Shelf with every exercise board marked on it. */
export async function removeFromShelf(document: ShelfDocument) {
  await deleteShelfDocument(document.id);
  for (const exercise of document.exercises) discardRecoveryCopy(shelfSessionId(document.id, exercise.id));
}

/** Ids of the document's exercises marked solved on their boards (note pages aren't solved). */
export async function solvedExercises(document: ShelfDocument): Promise<string[]> {
  const exercises = document.exercises.filter((item) => !isNote(item));
  const sessions = await Promise.all(exercises.map((item) => loadSession(shelfSessionId(document.id, item.id))));
  return exercises.filter((_, index) => sessions[index]?.isSolved).map((item) => item.id);
}
