import { folderIndex, itemFolder, bookLocation, isWithin, folderSummary } from '@/lib/folders';
import type { Folder, HistoryItem, HistoryShow, HistorySort, Session, ShelfDocument } from '@/types';

const SHELF_ENTRY = /^shelf:([^:]+):([^:]+)$/;

// Something drawn: a shape other than the problem's own picture, which a Shelf board gets on opening.
function hasDrawing(session: Session) {
  return session.canvasStrokes.length > 0 || Object.entries(session.canvasDocument?.store ?? {}).some(([key, record]) =>
    key.startsWith('shape:') && !(record as { meta?: Record<string, unknown> } | null)?.meta?.problemImage);
}

/**
 * A saved session as Home shows it, or null for boards of the built-in workbook, which the app no
 * longer has, and (unless `untouched`, as a book's page lists them) for Shelf exercises that were only
 * opened. `favoriteIds`: the sessions the student starred.
 */
export function toHistoryItem(session: Session, favoriteIds: ReadonlySet<string> = new Set(), { untouched = false } = {}): HistoryItem | null {
  const favorite = favoriteIds.has(session.id);
  let href: string | null = null;
  let source: HistoryItem['source'] = 'board';
  let bookId: string | null = null;
  let exerciseId: string | null = null;
  let hasWork = true;
  if (session.id.startsWith('workbook:')) return null;
  if (session.id.startsWith('shelf:')) {
    // The reader saves every exercise it opens; only ones with work in them belong in the list.
    hasWork = session.chatHistory.length > 0 || hasDrawing(session) || Boolean(session.isSolved) || favorite;
    if (!untouched && !hasWork) return null;
    const shelf = SHELF_ENTRY.exec(session.id);
    if (!shelf) return null;
    source = 'shelf';
    [, bookId, exerciseId] = shelf;
    href = `/shelf/read?doc=${encodeURIComponent(bookId)}&open=${encodeURIComponent(exerciseId)}`;
  }
  const sessionType = session.sessionType ?? 'problem';
  return {
    id: session.id,
    title: session.customTitle || session.title || 'Untitled',
    problemStatement: session.problemStatement,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.chatHistory.length,
    isSolved: sessionType === 'problem' && Boolean(session.isSolved),
    sessionType,
    renamed: Boolean(session.customTitle),
    favorite,
    thumbnail: session.canvasImageBlob ?? null,
    source,
    href,
    bookId,
    exerciseId,
    folderId: session.folderId,
    hasWork,
  };
}

const SHOWN: Record<HistoryShow, (item: HistoryItem) => boolean> = {
  all: () => true,
  problems: (item) => item.sessionType === 'problem',
  inProgress: (item) => item.sessionType === 'problem' && !item.isSolved,
  solved: (item) => item.isSolved,
  notes: (item) => item.sessionType === 'note',
  favorites: (item) => item.favorite,
};

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });

// A book's boards in its order: by book, then page, then as marked; free boards after them, newest first.
const bookOrder = (books: ReadonlyMap<string, ShelfDocument>) => {
  const place = (item: HistoryItem) => {
    const book = item.bookId ? books.get(item.bookId) : undefined;
    const index = book?.exercises.findIndex((mark) => mark.id === item.exerciseId) ?? -1;
    const mark = book && index >= 0 ? book.exercises[index] : undefined;
    return mark && book ? { title: book.title, page: mark.page, at: mark.createdAt } : null;
  };
  return (a: HistoryItem, b: HistoryItem) => {
    const [pa, pb] = [place(a), place(b)];
    if (!pa || !pb) return pa ? -1 : pb ? 1 : b.updatedAt - a.updatedAt;
    return byName(pa.title, pb.title) || pa.page - pb.page || pa.at - pb.at;
  };
};

const ORDER: Record<Exclude<HistorySort, 'book'>, (a: HistoryItem, b: HistoryItem) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => byName(a.title, b.title),
};

/**
 * Items matching every word of the search (in the name or the problem) and the filter, in order.
 * Sorting in book order needs the books (by id).
 */
export function queryHistory(items: HistoryItem[], { search, show, sort }: { search: string; show: HistoryShow; sort: HistorySort }, books: ReadonlyMap<string, ShelfDocument> = new Map()) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((item) => SHOWN[show](item))
    .filter((item) => {
      const text = `${item.title}\n${item.problemStatement}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort(sort === 'book' ? bookOrder(books) : ORDER[sort]);
}

const matches = (text: string, words: string[]) => words.every((word) => text.toLowerCase().includes(word));

export interface LibraryQuery {
  /** The folder shown; null for the top level (Home). */
  folderId: string | null;
  search: string;
  show: HistoryShow;
  sort: HistorySort;
}

/**
 * What a folder (or Home, the top level) lists. Browsing (no search, showing all): its folders,
 * books and boards, a book's boards being where the book is unless moved. Searching or filtering:
 * everything inside it that matches, at any depth: boards with work in them, and, showing all,
 * folders and books by name.
 */
export function libraryView(items: HistoryItem[], books: ShelfDocument[], folders: Folder[], query: LibraryQuery) {
  const index = folderIndex(folders, books);
  const words = query.search.toLowerCase().split(/\s+/).filter(Boolean);
  const browsing = words.length === 0 && query.show === 'all';
  const here = query.folderId;
  const inside = (location: string | null) => (browsing ? location === here : isWithin(index, location, here));
  // A book or folder was last worked on when it or something in it last changed.
  const lastWorked = (book: ShelfDocument) => Math.max(book.updatedAt, ...items.filter((item) => item.bookId === book.id).map((item) => item.updatedAt));
  const folderWorked = (folder: Folder) => Math.max(folder.updatedAt,
    ...items.filter((item) => isWithin(index, itemFolder(index, item), folder.id)).map((item) => item.updatedAt),
    ...books.filter((book) => isWithin(index, bookLocation(index, book), folder.id)).map((book) => book.updatedAt));
  const bookSort: Record<HistorySort, (a: ShelfDocument, b: ShelfDocument) => number> = {
    updated: (a, b) => lastWorked(b) - lastWorked(a),
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => byName(a.title, b.title),
    book: (a, b) => byName(a.title, b.title),
  };
  const folderSort: Record<HistorySort, (a: Folder, b: Folder) => number> = {
    updated: (a, b) => folderWorked(b) - folderWorked(a),
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => byName(a.name, b.name),
    book: (a, b) => byName(a.name, b.name),
  };
  const showsAll = query.show === 'all';
  return {
    folders: showsAll ? folders.filter((folder) => folder.id !== here && (browsing ? index.parent.get(folder.id) === here : isWithin(index, index.parent.get(folder.id) ?? null, here)))
      .filter((folder) => matches(folder.name, words)).sort(folderSort[query.sort]) : [],
    books: showsAll ? books.filter((book) => inside(bookLocation(index, book)) && matches(book.title, words)).sort(bookSort[query.sort]) : [],
    boards: queryHistory(items.filter((item) => inside(itemFolder(index, item)) && (browsing || item.hasWork)), query, index.books),
  };
}

/** The card's counts for each folder listed. */
export function folderSummaries(items: HistoryItem[], books: ShelfDocument[], folders: Folder[]) {
  const index = folderIndex(folders, books);
  return new Map(folders.map((folder) => [folder.id, folderSummary(index, folder.id, items)]));
}
