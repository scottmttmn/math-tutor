import { v4 as uuidv4 } from 'uuid';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { deleteSession, deleteShelfDocument, loadSession, saveSession, saveShelfDocument, shelfSessionId } from '@/lib/db';
import { cropPage, imageFileToPng, openPdf, pageImage, renderCover } from '@/lib/pdf';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import type { PageRect, Session, ShelfDocument, ShelfExercise } from '@/types';

// The key the main page reopens after a load (see useSessionAutosave).
const CURRENT_SESSION_KEY = 'math-tutor:currentSession';

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').trim() || 'Untitled';

/** Puts a PDF on the Shelf. Throws when the file can't be read as a PDF. */
export async function addToShelf(file: File): Promise<ShelfDocument> {
  if (!isPdf(file)) throw new Error('Not a PDF');
  const pdf = await openPdf(file);
  try {
    const now = Date.now();
    const document: ShelfDocument = {
      id: uuidv4(), title: baseName(file.name), file, pageCount: pdf.numPages,
      cover: await renderCover(pdf).catch(() => null), lastPage: 1, exercises: [], createdAt: now, updatedAt: now,
    };
    await saveShelfDocument(document);
    return document;
  } finally { void pdf.loadingTask.destroy(); }
}

/**
 * Starts a free-form problem with a picture of the file (an image, or a PDF's first page) as its
 * problem image, and makes it the session the main page opens next.
 */
export async function startProblemFromFile(file: File): Promise<string> {
  let image: string;
  if (isPdf(file)) {
    const pdf = await openPdf(file);
    try { image = await pageImage(pdf); } finally { void pdf.loadingTask.destroy(); }
  } else image = await imageFileToPng(file);
  const now = Date.now();
  const session: Session = {
    id: uuidv4(), title: 'Untitled', problemStatement: '', problemImage: image, canvasStrokes: [], canvasDocument: null,
    canvasImageBlob: null, chatHistory: [], createdAt: now, updatedAt: now, isSolved: false, sessionType: 'problem',
  };
  await saveSession(session);
  localStorage.setItem(CURRENT_SESSION_KEY, session.id);
  return session.id;
}

/** The problem text (and, cut to 50 characters, the board's title); the marked region goes with it as the problem image. */
export const exerciseStatement = (document: ShelfDocument, exercise: ShelfExercise) =>
  `${exercise.label} · ${document.title}, p. ${exercise.page}`;

/** Makes sure an exercise has its board, creating it with a picture of the marked region if needed. */
export async function ensureExerciseBoard(pdf: PDFDocumentProxy, document: ShelfDocument, exercise: ShelfExercise) {
  const id = shelfSessionId(document.id, exercise.id);
  if (await loadSession(id)) return id;
  const now = Date.now();
  const problemStatement = exerciseStatement(document, exercise);
  await saveSession({
    id, title: problemStatement.slice(0, 50), problemStatement, problemImage: await cropPage(pdf, exercise.page, exercise.rect),
    canvasStrokes: [], canvasDocument: null, canvasImageBlob: null, chatHistory: [], createdAt: now, updatedAt: now,
    isSolved: false, sessionType: 'problem',
  });
  return id;
}

/** Marks a region of a page as an exercise with its own board. Returns the updated document. */
export async function markExercise(pdf: PDFDocumentProxy, document: ShelfDocument, page: number, rect: PageRect, label: string): Promise<{ document: ShelfDocument; exercise: ShelfExercise }> {
  const exercise: ShelfExercise = { id: uuidv4(), label: label.trim() || nextLabel(document), page, rect, createdAt: Date.now() };
  await ensureExerciseBoard(pdf, document, exercise);
  const updated = { ...document, exercises: [...document.exercises, exercise], updatedAt: Date.now() };
  await saveShelfDocument(updated);
  return { document: updated, exercise };
}

/** A name for the next mark: one past the highest "Exercise N" so far. */
export function nextLabel(document: ShelfDocument) {
  const numbers = document.exercises.map((item) => Number(/^Exercise (\d+)$/.exec(item.label)?.[1] ?? 0));
  return `Exercise ${Math.max(0, ...numbers) + 1}`;
}

/** Removes a marked exercise and its board. */
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

/** Ids of the document's exercises marked solved on their boards. */
export async function solvedExercises(document: ShelfDocument): Promise<string[]> {
  const sessions = await Promise.all(document.exercises.map((item) => loadSession(shelfSessionId(document.id, item.id))));
  return document.exercises.filter((_, index) => sessions[index]?.isSolved).map((item) => item.id);
}
