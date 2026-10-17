'use client';

import { useMemo } from 'react';
import { sectionAt } from '@/lib/bookList';
import { MAX_MATCHES } from '@/lib/bookSearch';
import { pageName } from '@/lib/reader';
import type { ContentsEntry } from '@/lib/bookContext';
import type { BookSearchState } from '@/hooks/useBookSearch';

interface Props {
  search: BookSearchState;
  pageCount: number;
  contents: ContentsEntry[];
  labels: string[] | null;
  /** Opens a page with the matches on it lit. */
  onGoTo: (page: number) => void;
}

/** Search: every place the words are in the book, by section and page, with a line around each. */
export default function BookSearch({ search, pageCount, contents, labels, onGoTo }: Props) {
  const { query, setQuery, results, pagesRead, done, capped, noText } = search;
  const sections = useMemo(() => {
    const grouped: { key: string; title: string | null; from: number; to: number; pages: typeof results }[] = [];
    for (const result of results) {
      const section = sectionAt(contents, result.page, pageCount);
      const last = grouped[grouped.length - 1];
      if (last?.key === section.key) last.pages.push(result);
      else grouped.push({ ...section, pages: [result] });
    }
    return grouped;
  }, [results, contents, pageCount]);
  const count = results.reduce((total, result) => total + result.matches.length, 0);
  const name = (page: number) => pageName(labels, page);

  return (
    <div className="grid gap-3">
      <form role="search" onSubmit={(event) => event.preventDefault()} className="flex gap-2">
        <input type="search" aria-label="Search this text" placeholder="Search this text" value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="flex-1 min-w-0 min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
        {query && (
          <button type="button" onClick={() => setQuery('')} className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Clear</button>
        )}
      </form>

      {query.trim() && (
        <p className="text-xs text-gray-600" aria-live="polite">
          {done && noText ? 'This PDF is a scan, so its text can’t be searched.'
            : !done ? `Searching… page ${name(Math.max(1, pagesRead))} of ${pageCount}${count ? `, ${count} found` : ''}`
            : count === 0 ? 'Not found in this text.'
            : capped ? `The first ${MAX_MATCHES} matches, up to p. ${name(pagesRead)}.`
            : `${count} ${count === 1 ? 'match' : 'matches'} on ${results.length} ${results.length === 1 ? 'page' : 'pages'}.`}
        </p>
      )}

      {sections.map((section) => (
        <section key={section.key} aria-label={section.title ?? `Pages ${name(section.from)}–${name(section.to)}`}>
          <h3 className="px-2 pb-1 border-b border-gray-200 text-sm font-semibold text-gray-900 truncate">
            {section.title ?? (section.from === section.to ? `Page ${name(section.from)}` : `Pages ${name(section.from)}–${name(section.to)}`)}
          </h3>
          <ul className="grid mt-1">
            {section.pages.flatMap(({ page, matches }) => matches.map((match, index) => (
              <li key={`${page}-${index}`}>
                <button onClick={() => onGoTo(page)} className="w-full min-h-11 flex items-baseline gap-2 px-2 py-2 text-left text-sm rounded-lg hover:bg-gray-100">
                  <span className="flex-1 min-w-0 text-gray-700">
                    {match.before}<mark className="bg-gray-200 text-gray-900 font-semibold underline">{match.match}</mark>{match.after}
                  </span>
                  <span className="text-xs text-gray-500 tabular-nums">p. {name(page)}</span>
                </button>
              </li>
            )))}
          </ul>
        </section>
      ))}
    </div>
  );
}
