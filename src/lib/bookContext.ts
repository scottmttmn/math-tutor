import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { BookContext, ShelfDocument, ShelfExercise } from '@/types';

// The tutor reads at most this many pages (about 15k tokens of text), ending at the exercise's page.
export const MAX_BOOK_PAGES = 15;
// Pages read before the exercise when the PDF has no bookmark to start from.
const FALLBACK_PAGES = 6;
// Less text than this per page, on average, means a scan with no text layer (perhaps a stamped
// footer): the tutor reads nothing. A page of text has a couple of thousand characters.
const MIN_CHARS_PER_PAGE = 100;

/** A bookmark (outline entry) and the page it points at. */
export interface SectionStart {
  title: string;
  page: number;
}

export interface ReadingRange {
  from: number;
  to: number;
  section?: string;
}

// An "Exercises" or "Answers" bookmark is not where the material starts: it would leave the tutor
// only the exercises. Section numbers in front ("2.4 Exercises") don't change that.
const NOT_A_SECTION = /^[\d.\s]*(exercises?|problems?|problem set|homework|solutions?|answers?)\b/i;

/** The last section start at or before the page. */
export function sectionFor(starts: SectionStart[], page: number): SectionStart | undefined {
  let found: SectionStart | undefined;
  for (const start of starts) if (start.page <= page && !NOT_A_SECTION.test(start.title)) found = start;
  return found;
}

/**
 * The pages the tutor reads for an exercise: from its section's start (or the student's choice) to
 * the exercise's page, at most MAX_BOOK_PAGES, nothing after it. Null when the student turned it off.
 * Without a choice of its own, an exercise takes the latest one made for an earlier exercise in the
 * same section whose range reaches it, so a section's start is corrected once.
 */
export function readingRange(document: ShelfDocument, exercise: ShelfExercise, starts: SectionStart[]): ReadingRange | null {
  const to = exercise.page;
  const section = sectionFor(starts, to);
  let from = exercise.readFrom;
  if (from === undefined) {
    const chosen = document.exercises
      .filter((other) => other.id !== exercise.id && other.page <= to && other.readFrom && other.readFrom <= to && to - other.readFrom < MAX_BOOK_PAGES
        && sectionFor(starts, other.page) === section)
      .map((other) => other.readFrom as number);
    from = chosen.length ? Math.max(...chosen) : section ? section.page : to - FALLBACK_PAGES;
  }
  if (from === 0) return null;
  return { from: Math.min(to, Math.max(1, from, to - MAX_BOOK_PAGES + 1)), to, section: section?.title };
}

/** An entry of the PDF's contents (bookmarks): its title, the page it points at, how deeply nested. */
export interface ContentsEntry extends SectionStart {
  depth: number;
}

const outlines = new WeakMap<PDFDocumentProxy, Promise<ContentsEntry[]>>();

/** The PDF's bookmarks in their own order, with their pages; none when it has no outline. */
export function loadContents(pdf: PDFDocumentProxy): Promise<ContentsEntry[]> {
  let contents = outlines.get(pdf);
  if (!contents) {
    contents = readOutline(pdf).catch(() => []);
    outlines.set(pdf, contents);
  }
  return contents;
}

/** The PDF's bookmarks with their pages, in page order; none when it has no outline. */
export async function loadSectionStarts(pdf: PDFDocumentProxy): Promise<SectionStart[]> {
  // Stable: a chapter and its first section on one page keep their order, so the section wins.
  return (await loadContents(pdf)).map(({ title, page }) => ({ title, page })).sort((a, b) => a.page - b.page);
}

type OutlineItem = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number];

async function readOutline(pdf: PDFDocumentProxy): Promise<ContentsEntry[]> {
  const entries: ContentsEntry[] = [];
  const walk = async (items: OutlineItem[], depth: number) => {
    for (const item of items) {
      const page = await destinationPage(pdf, item.dest).catch(() => null);
      if (page) entries.push({ title: item.title.trim(), page, depth });
      if (item.items?.length) await walk(item.items, depth + 1);
    }
  };
  await walk(await pdf.getOutline() ?? [], 0);
  return entries;
}

async function destinationPage(pdf: PDFDocumentProxy, dest: OutlineItem['dest']): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  const target = explicit?.[0];
  if (target === undefined || target === null) return null;
  if (typeof target === 'number') return target + 1;
  return (await pdf.getPageIndex(target)) + 1;
}

const pageTexts = new WeakMap<PDFDocumentProxy, Map<number, Promise<string>>>();

function pageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  let pages = pageTexts.get(pdf);
  if (!pages) { pages = new Map(); pageTexts.set(pdf, pages); }
  let text = pages.get(pageNumber);
  if (!text) {
    text = pdf.getPage(pageNumber).then((page) => page.getTextContent()).then((content) => content.items
      .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
      .join('')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim());
    pages.set(pageNumber, text);
  }
  return text;
}

/** The text of the range's pages for the tutor, or null when the PDF has none (a scan). */
export async function readBookPages(pdf: PDFDocumentProxy, document: ShelfDocument, range: ReadingRange): Promise<BookContext | null> {
  const pages: string[] = [];
  for (let page = range.from; page <= range.to; page++) pages.push(await pageText(pdf, page).catch(() => ''));
  if (pages.join('').replace(/\s/g, '').length < MIN_CHARS_PER_PAGE * pages.length) return null;
  return {
    title: document.title,
    section: range.section,
    fromPage: range.from,
    toPage: range.to,
    text: pages.map((text, index) => `[Page ${range.from + index}]\n${text}`).join('\n\n'),
  };
}
