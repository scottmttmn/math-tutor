'use client';

import { useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageTextBoxes } from '@/lib/bookList';
import { MAX_MATCHES, findOnPage, searchTerm, type PageMatch } from '@/lib/bookSearch';

// Wait this long after the last keystroke before reading the book.
const TYPING_PAUSE_MS = 400;
const NONE: BookSearchState['results'] = [];

export interface BookSearchState {
  query: string;
  setQuery: (query: string) => void;
  /** Matches by page, in page order, as far as the search has read. */
  results: { page: number; matches: PageMatch[] }[];
  /** Pages read so far (all of them once it is done). */
  pagesRead: number;
  done: boolean;
  /** It stopped at MAX_MATCHES. */
  capped: boolean;
  /** No page read so far had any text: a scan. */
  noText: boolean;
}

/** Searches a PDF's text page by page as the student types; the results grow as pages are read. */
export function useBookSearch(pdf: PDFDocumentProxy | null): BookSearchState {
  const [query, setQuery] = useState('');
  // What has been found, and for which term (a newer term's search hasn't reported yet).
  const [found, setFound] = useState<Omit<BookSearchState, 'query' | 'setQuery'> & { term: string; pdf: PDFDocumentProxy | null }>(
    { term: '', pdf: null, results: [], pagesRead: 0, done: true, capped: false, noText: false });
  const term = searchTerm(query);

  useEffect(() => {
    if (!pdf || !term) return;
    let active = true;
    const timer = setTimeout(async () => {
      const results: BookSearchState['results'] = [];
      let count = 0;
      let anyText = false;
      for (let page = 1; page <= pdf.numPages && active; page += 1) {
        const { boxes, aspect } = await pageTextBoxes(pdf, page);
        if (!active) return;
        if (boxes.length) anyText = true;
        const matches = findOnPage(boxes, term, aspect).slice(0, MAX_MATCHES - count);
        if (matches.length) { results.push({ page, matches }); count += matches.length; }
        const capped = count >= MAX_MATCHES;
        const done = capped || page === pdf.numPages;
        // Show progress every few pages, and every page with a match.
        if (done || matches.length || page % 10 === 0) {
          setFound({ term, pdf, results: [...results], pagesRead: page, done, capped, noText: !anyText });
        }
        if (capped) return;
      }
    }, TYPING_PAUSE_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [pdf, term]);

  const { term: foundTerm, pdf: foundPdf, ...rest } = found;
  if (!pdf || !term) return { query, setQuery, results: NONE, pagesRead: 0, done: true, capped: false, noText: false };
  if (foundTerm !== term || foundPdf !== pdf) return { query, setQuery, results: NONE, pagesRead: 0, done: false, capped: false, noText: false };
  return { query, setQuery, ...rest };
}
