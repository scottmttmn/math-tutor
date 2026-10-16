import type { HistoryItem, HistoryShow, HistorySort, Session, ShelfDocument } from '@/types';

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
  if (session.id.startsWith('workbook:')) return null;
  if (session.id.startsWith('shelf:')) {
    // The reader saves every exercise it opens; only ones with work in them belong in the list.
    if (!untouched && session.chatHistory.length === 0 && !hasDrawing(session) && !session.isSolved && !favorite) return null;
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

const ORDER: Record<HistorySort, (a: HistoryItem, b: HistoryItem) => number> = {
  updated: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
};

/** Items matching every word of the search (in the name or the problem) and the filter, in order. */
export function queryHistory(items: HistoryItem[], { search, show, sort }: { search: string; show: HistoryShow; sort: HistorySort }) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return items
    .filter((item) => SHOWN[show](item))
    .filter((item) => {
      const text = `${item.title}\n${item.problemStatement}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort(ORDER[sort]);
}

const matches = (text: string, words: string[]) => words.every((word) => text.toLowerCase().includes(word));

/**
 * What Home lists. Browsing (no search, showing all): every book (Shelf PDF) and the free-form boards,
 * since a book's boards are listed on its own page. Searching or filtering: matching boards from
 * everywhere, book exercises included, and, showing all, the books whose title matches.
 */
export function libraryView(items: HistoryItem[], books: ShelfDocument[], query: { search: string; show: HistoryShow; sort: HistorySort }) {
  const words = query.search.toLowerCase().split(/\s+/).filter(Boolean);
  const browsing = words.length === 0 && query.show === 'all';
  // A book was last worked on when it or one of its boards last changed.
  const lastWorked = (book: ShelfDocument) => Math.max(book.updatedAt, ...items.filter((item) => item.bookId === book.id).map((item) => item.updatedAt));
  const bookOrder: Record<HistorySort, (a: ShelfDocument, b: ShelfDocument) => number> = {
    updated: (a, b) => lastWorked(b) - lastWorked(a),
    created: (a, b) => b.createdAt - a.createdAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }),
  };
  return {
    books: query.show === 'all' ? books.filter((book) => matches(book.title, words)).sort(bookOrder[query.sort]) : [],
    boards: queryHistory(browsing ? items.filter((item) => item.source === 'board') : items, query),
  };
}
