import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { InkStroke, ShelfExercise } from '@/types';
import type { ContentsEntry } from '@/lib/bookContext';
import { HIGHLIGHTER_WIDTH } from '@/lib/ink';

// Without bookmarks, the list groups the pages ten at a time.
export const PAGES_PER_GROUP = 10;

/** One row of a book's list: a marked exercise or note page, a highlight, or the section's pen ink. */
export type BookListRow =
  | { kind: 'mark'; mark: ShelfExercise; solved: boolean }
  | { kind: 'highlight'; page: number; stroke: InkStroke }
  | { kind: 'ink'; pages: number[] };

/** A section of the book (a bookmark, or a run of pages) and what the student made in it. */
export interface BookListSection {
  key: string;
  /** The bookmark's title; null for a run of pages without one (shown as "Pages from–to"). */
  title: string | null;
  from: number;
  to: number;
  /** Exercises marked in it, and how many of those are solved (note pages aren't counted). */
  exercises: number;
  solved: number;
  rows: BookListRow[];
}

// The top of a stroke, so a highlight sorts among the marks by where it is on the page.
const strokeTop = (stroke: InkStroke) => {
  let top = 1;
  for (let i = 1; i < stroke.points.length; i += 3) top = Math.min(top, stroke.points[i]);
  return top;
};

/**
 * Everything made in a book, by section, in page order: marks and highlights each get a row, and a
 * section's pen ink gets one row listing its pages. Only sections with something in them are listed.
 * Sections are the bookmarks (an item belongs to the last one at or before its page); without
 * bookmarks, runs of PAGES_PER_GROUP pages.
 */
export function bookList(marks: ShelfExercise[], solvedIds: string[], ink: Record<number, InkStroke[]>, contents: ContentsEntry[], pageCount: number): BookListSection[] {
  const sectionOf = (page: number): Omit<BookListSection, 'exercises' | 'solved' | 'rows'> => {
    if (!contents.length) {
      const from = Math.floor((page - 1) / PAGES_PER_GROUP) * PAGES_PER_GROUP + 1;
      return { key: `pages-${from}`, title: null, from, to: Math.min(pageCount, from + PAGES_PER_GROUP - 1) };
    }
    let found = -1;
    contents.forEach((entry, index) => { if (entry.page <= page && (found < 0 || entry.page >= contents[found].page)) found = index; });
    if (found < 0) return { key: 'before', title: null, from: 1, to: Math.max(1, contents[0].page - 1) };
    const next = contents.find((entry) => entry.page > contents[found].page);
    return { key: `section-${found}`, title: contents[found].title, from: contents[found].page, to: next ? Math.max(contents[found].page, next.page - 1) : pageCount };
  };

  type Placed = { page: number; y: number; row: BookListRow };
  const sections = new Map<string, BookListSection & { placed: Placed[]; inkPages: number[] }>();
  const sectionFor = (page: number) => {
    const where = sectionOf(page);
    let section = sections.get(where.key);
    if (!section) {
      section = { ...where, exercises: 0, solved: 0, rows: [], placed: [], inkPages: [] };
      sections.set(where.key, section);
    }
    return section;
  };

  for (const mark of marks) {
    const section = sectionFor(mark.page);
    const solved = solvedIds.includes(mark.id);
    if (mark.kind !== 'note') { section.exercises += 1; if (solved) section.solved += 1; }
    section.placed.push({ page: mark.page, y: mark.rect.y, row: { kind: 'mark', mark, solved } });
  }
  for (const [key, strokes] of Object.entries(ink)) {
    const page = Number(key);
    if (!strokes.length) continue;
    const section = sectionFor(page);
    for (const stroke of strokes) {
      if (stroke.tool === 'highlighter') section.placed.push({ page, y: strokeTop(stroke), row: { kind: 'highlight', page, stroke } });
    }
    if (strokes.some((stroke) => stroke.tool === 'pen')) section.inkPages.push(page);
  }

  return [...sections.values()]
    .sort((a, b) => a.from - b.from || a.key.localeCompare(b.key))
    .map(({ placed, inkPages, ...section }) => ({
      ...section,
      rows: [
        ...placed.sort((a, b) => a.page - b.page || a.y - b.y).map((item) => item.row),
        ...(inkPages.length ? [{ kind: 'ink' as const, pages: inkPages.sort((a, b) => a - b) }] : []),
      ],
    }));
}

/** A run of text on a PDF page, as fractions of the page: left, top, width, height. */
export interface TextBox {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The words a highlight covers, from the page's text boxes (`aspect` is the page's height over its
 * width, to turn the highlighter's width into a height). A box counts when the highlight runs along
 * its line; only the part it spans is kept, widened to whole words. '' when it covers no text.
 */
export function textUnder(stroke: InkStroke, boxes: TextBox[], aspect: number): string {
  const halfX = HIGHLIGHTER_WIDTH / 2;
  const halfY = halfX / aspect;
  const { points } = stroke;
  const parts: string[] = [];
  for (const box of boxes) {
    if (!box.text.trim() || box.width <= 0) continue;
    const middle = box.y + box.height / 2;
    const reach = Math.max(box.height / 2, halfY);
    let from = Infinity;
    let to = -Infinity;
    for (let i = 0; i < points.length; i += 3) {
      const j = Math.max(0, i - 3);
      if (Math.abs(points[i + 1] - middle) > reach || Math.abs(points[j + 1] - middle) > reach) continue;
      from = Math.min(from, points[i] - halfX, points[j] - halfX);
      to = Math.max(to, points[i] + halfX, points[j] + halfX);
    }
    from = Math.max(from, box.x);
    to = Math.min(to, box.x + box.width);
    if (to <= from) continue;
    const { text } = box;
    let start = Math.floor(((from - box.x) / box.width) * text.length);
    let end = Math.ceil(((to - box.x) / box.width) * text.length);
    while (start > 0 && /\S/.test(text[start - 1])) start -= 1;
    while (end < text.length && /\S/.test(text[end])) end += 1;
    parts.push(text.slice(start, end));
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

const pageBoxes = new WeakMap<PDFDocumentProxy, Map<number, Promise<{ boxes: TextBox[]; aspect: number }>>>();

/** A page's text as boxes in page fractions (kept for the open PDF); none on a scan. */
export function pageTextBoxes(pdf: PDFDocumentProxy, pageNumber: number): Promise<{ boxes: TextBox[]; aspect: number }> {
  let pages = pageBoxes.get(pdf);
  if (!pages) { pages = new Map(); pageBoxes.set(pdf, pages); }
  let found = pages.get(pageNumber);
  if (!found) {
    found = pdf.getPage(pageNumber).then(async (page) => {
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const boxes: TextBox[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const height = item.height || Math.hypot(item.transform[2], item.transform[3]);
        const [left, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        boxes.push({ text: item.str, x: left / viewport.width, y: (baseline - height) / viewport.height, width: item.width / viewport.width, height: height / viewport.height });
      }
      return { boxes, aspect: viewport.height / viewport.width };
    }).catch(() => ({ boxes: [], aspect: 1 }));
    pages.set(pageNumber, found);
  }
  return found;
}
