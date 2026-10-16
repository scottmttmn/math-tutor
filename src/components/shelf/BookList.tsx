'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { bookList, pageTextBoxes, textUnder } from '@/lib/bookList';
import { pageName } from '@/lib/reader';
import type { ContentsEntry } from '@/lib/bookContext';
import type { InkStroke, ShelfExercise } from '@/types';
import { NotesIcon, SolvedCheck, UnsolvedCheck } from '@/components/common/Icons';

interface Props {
  pdf: PDFDocumentProxy;
  marks: ShelfExercise[];
  solvedIds: string[];
  ink: Record<number, InkStroke[]>;
  contents: ContentsEntry[];
  labels: string[] | null;
  /** Opens an exercise or note page on its board. */
  onOpen: (mark: ShelfExercise) => void;
  onGoTo: (page: number) => void;
  disabled: boolean;
}

/** Your list: everything made in this book (exercises, note pages, highlights, ink) by section. */
export default function BookList({ pdf, marks, solvedIds, ink, contents, labels, onOpen, onGoTo, disabled }: Props) {
  const sections = useMemo(() => bookList(marks, solvedIds, ink, contents, pdf.numPages), [marks, solvedIds, ink, contents, pdf]);

  // The words under each highlight, read from the page's text once per stroke.
  const [quotes, setQuotes] = useState(() => new Map<InkStroke, string>());
  useEffect(() => {
    let active = true;
    const missing = sections.flatMap((section) => section.rows)
      .flatMap((row) => (row.kind === 'highlight' && !quotes.has(row.stroke) ? [row] : []));
    if (!missing.length) return;
    void Promise.all(missing.map(async ({ page, stroke }) => {
      const { boxes, aspect } = await pageTextBoxes(pdf, page);
      return [stroke, textUnder(stroke, boxes, aspect)] as const;
    })).then((found) => { if (active) setQuotes((current) => new Map([...current, ...found])); });
    return () => { active = false; };
  }, [sections, pdf, quotes]);

  if (!sections.length) {
    return (
      <p className="text-sm text-gray-500">
        Nothing here yet. Tap <strong>Mark</strong> and drag a box around an exercise, or around a passage to take notes on. Each one opens on its own board, and stays marked on the page. Your highlights and ink are listed here too.
      </p>
    );
  }

  const name = (page: number) => pageName(labels, page);
  const row = 'w-full min-h-11 flex items-center gap-2 px-2 py-2 text-left text-sm rounded-lg hover:bg-gray-100 disabled:opacity-50';
  return (
    <div className="grid gap-4">
      {sections.map((section) => (
        <section key={section.key} aria-label={section.title ?? `Pages ${name(section.from)}–${name(section.to)}`}>
          <h3 className="flex items-baseline gap-2 px-2 pb-1 border-b border-gray-200 text-sm font-semibold text-gray-900">
            <span className="flex-1 min-w-0 truncate">{section.title ?? (section.from === section.to ? `Page ${name(section.from)}` : `Pages ${name(section.from)}–${name(section.to)}`)}</span>
            {section.exercises > 0 && <span className="text-xs font-normal text-gray-600 tabular-nums">{section.solved} of {section.exercises} solved</span>}
          </h3>
          <ul className="grid mt-1">
            {section.rows.map((item, index) => (
              <li key={item.kind === 'mark' ? item.mark.id : `${item.kind}-${index}`}>
                {item.kind === 'mark' ? (
                  <button onClick={() => onOpen(item.mark)} disabled={disabled} className={row}>
                    {item.mark.kind === 'note' ? <NotesIcon /> : item.solved ? <SolvedCheck /> : <UnsolvedCheck />}
                    <span className="flex-1 min-w-0 truncate font-medium text-gray-900">{item.mark.label}</span>
                    {item.solved && <span className="text-xs font-semibold text-gray-900">Solved</span>}
                    <span className="text-xs text-gray-500 tabular-nums">p. {name(item.mark.page)}</span>
                  </button>
                ) : item.kind === 'highlight' ? (
                  <button onClick={() => onGoTo(item.page)} className={row}>
                    <span aria-hidden="true" className="shrink-0 w-4 h-2.5 bg-gray-300 border border-gray-400" />
                    <span className="flex-1 min-w-0 truncate text-gray-700">
                      {quotes.get(item.stroke) ? `“${quotes.get(item.stroke)}”` : 'Highlight'}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">p. {name(item.page)}</span>
                  </button>
                ) : (
                  <button onClick={() => onGoTo(item.pages[0])} className={row}>
                    <span aria-hidden="true" className="shrink-0 w-4 text-center text-gray-700">✎</span>
                    <span className="flex-1 min-w-0 truncate text-gray-700">
                      Your ink, {item.pages.length === 1 ? `p. ${name(item.pages[0])}` : `${item.pages.length} pages`}
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">p. {name(item.pages[0])}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
