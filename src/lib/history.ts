import type { HistoryItem, HistoryShow, HistorySort, Session } from '@/types';

const WORKBOOK_ENTRY = /^workbook:[^:]+:(?:exercise:([^:]+)|reading)$/;
const SHELF_ENTRY = /^shelf:([^:]+):([^:]+)$/;

function hasDrawing(session: Session) {
  return session.canvasStrokes.length > 0 || Object.keys(session.canvasDocument?.store ?? {}).some((key) => key.startsWith('shape:'));
}

/** A saved session as History shows it, or null for workbook and Shelf pages that were only opened. */
export function toHistoryItem(session: Session): HistoryItem | null {
  let href: string | null = null;
  let source: HistoryItem['source'] = 'board';
  if (session.id.startsWith('workbook:') || session.id.startsWith('shelf:')) {
    // Both save every exercise they open; only ones with work in them belong in History.
    if (session.chatHistory.length === 0 && !hasDrawing(session) && !session.isSolved) return null;
    const workbook = WORKBOOK_ENTRY.exec(session.id);
    const shelf = SHELF_ENTRY.exec(session.id);
    if (workbook) {
      source = 'workbook';
      href = `/workbook?open=${encodeURIComponent(workbook[1] ?? 'reading')}`;
    } else if (shelf) {
      source = 'shelf';
      href = `/shelf/read?doc=${encodeURIComponent(shelf[1])}&open=${encodeURIComponent(shelf[2])}`;
    } else return null;
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
