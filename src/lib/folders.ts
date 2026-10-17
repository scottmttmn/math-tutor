import type { Folder, FolderSummary, HistoryItem, ShelfDocument } from '@/types';

/**
 * The library's folders by id, each one's parent (null: the top level), and the books by id.
 * A parent that is gone, or that would make a loop (only a damaged restore could), counts as the top level.
 */
export interface FolderIndex {
  folders: ReadonlyMap<string, Folder>;
  parent: ReadonlyMap<string, string | null>;
  books: ReadonlyMap<string, ShelfDocument>;
}

export function folderIndex(folders: Folder[], books: ShelfDocument[] = []): FolderIndex {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const parent = new Map<string, string | null>();
  for (const folder of folders) {
    let next = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    // Walk up: reaching this folder again is a loop.
    const seen = new Set([folder.id]);
    for (let up = next; up; up = byId.get(up)?.parentId ?? null) {
      if (seen.has(up)) { next = null; break; }
      seen.add(up);
    }
    parent.set(folder.id, next);
  }
  return { folders: byId, parent, books: new Map(books.map((book) => [book.id, book])) };
}

const known = (index: FolderIndex, id: string | null | undefined) => (id && index.folders.has(id) ? id : null);

/** The folder a book is in; null: the top level. */
export const bookLocation = (index: FolderIndex, book: Pick<ShelfDocument, 'folderId'>) => known(index, book.folderId);

/** The folder a board is in: where it was filed, else a Shelf board's book's folder, else the top level. */
export function itemFolder(index: FolderIndex, item: Pick<HistoryItem, 'folderId' | 'bookId'>): string | null {
  if (item.folderId === null) return null;
  const filed = known(index, item.folderId);
  if (filed) return filed;
  const book = item.bookId ? index.books.get(item.bookId) : undefined;
  return book ? bookLocation(index, book) : null;
}

/** Whether `location` is the folder `ancestor` or inside it, at any depth; everything is inside the top level (null). */
export function isWithin(index: FolderIndex, location: string | null, ancestor: string | null) {
  if (ancestor === null) return true;
  for (let at = location; at; at = index.parent.get(at) ?? null) if (at === ancestor) return true;
  return false;
}

/** The folders from the top level down to `id`, itself last. */
export function folderPath(index: FolderIndex, id: string | null): Folder[] {
  const path: Folder[] = [];
  for (let at = known(index, id); at; at = index.parent.get(at) ?? null) path.unshift(index.folders.get(at)!);
  return path;
}

/** Every folder in order, each after its parent and indented by `depth`, sorted by name within a folder (for Move to). */
export function folderTree(index: FolderIndex): { folder: Folder; depth: number }[] {
  const children = new Map<string | null, Folder[]>();
  for (const folder of index.folders.values()) {
    const parent = index.parent.get(folder.id) ?? null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const tree: { folder: Folder; depth: number }[] = [];
  const add = (parent: string | null, depth: number) => {
    const list = (children.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    for (const folder of list) { tree.push({ folder, depth }); add(folder.id, depth + 1); }
  };
  add(null, 0);
  return tree;
}

/** What a folder holds at any depth: folders, books, and its problems (solved ones too) and notes. */
export function folderSummary(index: FolderIndex, id: string, items: HistoryItem[]): FolderSummary {
  const summary: FolderSummary = { folders: 0, books: 0, problems: 0, notes: 0, solved: 0 };
  for (const folder of index.folders.keys()) if (folder !== id && isWithin(index, folder, id)) summary.folders += 1;
  for (const book of index.books.values()) if (isWithin(index, bookLocation(index, book), id)) summary.books += 1;
  for (const item of items) {
    if (!isWithin(index, itemFolder(index, item), id)) continue;
    if (item.sessionType === 'note') summary.notes += 1;
    else if (item.problems) { summary.problems += item.problems.total; summary.solved += item.problems.solved; }
    else { summary.problems += 1; if (item.isSolved) summary.solved += 1; }
  }
  return summary;
}

/** Where a folder's page is; Home for the top level. */
export const folderHref = (id: string | null | undefined) => (id ? `/folder?id=${encodeURIComponent(id)}` : '/');
