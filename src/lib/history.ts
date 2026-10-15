import type { HistoryItem, HistoryShow, HistorySort, Session } from '@/types';

const SHELF_ENTRY = /^shelf:([^:]+):([^:]+)$/;

function hasDrawing(session: Session) {
  return session.canvasStrokes.length > 0 || Object.keys(session.canvasDocument?.store ?? {}).some((key) => key.startsWith('shape:'));
}

/**
 * A saved session as History shows it, or null for Shelf exercises that were only opened
 * and for boards of the built-in workbook, which the app no longer has.
 */
export function toHistoryItem(session: Session): HistoryItem | null {
  let href: string | null = null;
  let source: HistoryItem['source'] = 'board';
  if (session.id.startsWith('workbook:')) return null;
  if (session.id.startsWith('shelf:')) {
    // The reader saves every exercise it opens; only ones with work in them belong in History.
    if (session.chatHistory.length === 0 && !hasDrawing(session) && !session.isSolved) return null;
    const shelf = SHELF_ENTRY.exec(session.id);
    if (!shelf) return null;
    source = 'shelf';
    href = `/shelf/read?doc=${encodeURIComponent(shelf[1])}&open=${encodeURIComponent(shelf[2])}`;
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
    thumbnail: session.canvasImageBlob ?? null,
    source,
    href,
  };
}

const SHOWN: Record<HistoryShow, (item: HistoryItem) => boolean> = {
  all: () => true,
  problems: (item) => item.sessionType === 'problem',
  inProgress: (item) => item.sessionType === 'problem' && !item.isSolved,
  solved: (item) => item.isSolved,
  notes: (item) => item.sessionType === 'note',
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
