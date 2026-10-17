import { v4 as uuidv4 } from 'uuid';
import { deleteFolder, loadShelfDocument, moveSession, saveFolder, saveShelfDocument } from '@/lib/db';
import { bookLocation, isWithin, type FolderIndex } from '@/lib/folders';
import type { Folder, HistoryItem, ShelfDocument } from '@/types';

// Making, renaming and moving folders, and moving boards and books between them (the reading of them is folders.ts).

/** Makes a folder named `name` (or "New folder") inside `parentId` (null: the top level). */
export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const now = Date.now();
  const folder: Folder = { id: uuidv4(), name: name.trim() || 'New folder', parentId, createdAt: now, updatedAt: now };
  await saveFolder(folder);
  return folder;
}

export async function renameFolder(folder: Folder, name: string): Promise<Folder> {
  const renamed = { ...folder, name: name.trim() || folder.name, updatedAt: Date.now() };
  await saveFolder(renamed);
  return renamed;
}

/** Moves a folder into another (null: the top level); never into itself or one inside it. */
export async function moveFolder(index: FolderIndex, folder: Folder, parentId: string | null): Promise<Folder> {
  if (parentId !== null && isWithin(index, parentId, folder.id)) throw new Error('A folder can’t go inside itself.');
  const moved = { ...folder, parentId, updatedAt: Date.now() };
  await saveFolder(moved);
  return moved;
}

/**
 * Files a board in a folder (null: the top level). A Shelf board moved to where its book is goes
 * back to following its book, so it moves with the book.
 */
export async function moveBoard(index: FolderIndex, item: Pick<HistoryItem, 'id' | 'bookId'>, folderId: string | null) {
  const book = item.bookId ? index.books.get(item.bookId) : undefined;
  // Unset is where a board belongs by default: with its book, or (a free board) at the top level.
  const byDefault = book ? bookLocation(index, book) === folderId : folderId === null;
  await moveSession(item.id, byDefault ? undefined : folderId);
}

/** Moves a book (and the boards that follow it) into a folder (null: the top level). */
export async function moveBook(book: ShelfDocument, folderId: string | null): Promise<ShelfDocument> {
  const latest = (await loadShelfDocument(book.id)) ?? book;
  const moved = { ...latest, folderId, updatedAt: Date.now() };
  await saveShelfDocument(moved);
  return moved;
}

export { deleteFolder };
