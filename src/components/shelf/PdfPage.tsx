'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '@/lib/pdf';
import type { PageRect, ShelfExercise } from '@/types';

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** Exercises marked on this page. */
  marks: ShelfExercise[];
  solvedIds: string[];
  activeId: string | null;
  /** While true, dragging on the page draws a box instead of scrolling. */
  marking: boolean;
  /** A box drawn but not saved yet; it stays on the page with `pendingForm` beside it. */
  pending: PageRect | null;
  pendingForm: ReactNode;
  onMark: (rect: PageRect) => void;
  onOpenMark: (exercise: ShelfExercise) => void;
}

// A box smaller than this (as a fraction of the page) is a stray tap, not a mark.
const MIN_MARK = 0.02;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const box = (a: { x: number; y: number }, b: { x: number; y: number }): PageRect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
});
// Room the form needs below a box, and (more, since it may wrap on a narrow page) above it.
const ROOM_BELOW = 0.1;
const ROOM_ABOVE = 0.25;

// Below the box, or above it when it reaches the foot of the page and there is room above (past
// the page's foot the reader scrolls on; past its top it can't). Lined up with whichever side has room.
const formPosition = (rect: PageRect): React.CSSProperties => ({
  ...(1 - rect.y - rect.height < ROOM_BELOW && rect.y >= ROOM_ABOVE ? { bottom: `${(1 - rect.y) * 100}%` } : { top: `${(rect.y + rect.height) * 100}%` }),
  ...(rect.x > 0.5 ? { right: `${(1 - rect.x - rect.width) * 100}%` } : { left: `${rect.x * 100}%` }),
});
const percent = (rect: PageRect) => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

/** One PDF page, fit to its container's width, with marked exercises drawn over it. */
export default function PdfPage({ pdf, pageNumber, marks, solvedIds, activeId, marking, pending, pendingForm, onMark, onOpenMark }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PageRect | null>(null);
  const form = useRef<HTMLDivElement>(null);

  // The page may be scrolled: bring the form into view and put the cursor in its name field.
  useEffect(() => {
    if (!pending) return;
    form.current?.scrollIntoView?.({ block: 'nearest' });
    form.current?.querySelector('input')?.focus({ preventScroll: true });
  }, [pending]);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!width || !canvas.current) return;
    let cancelled = false;
    let task: ReturnType<typeof renderPage> | null = null;
    pdf.getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvas.current) return;
        task = renderPage(page, canvas.current, width);
        return task.promise;
      })
      .then(() => { if (!cancelled) setFailed(false); })
      .catch((error: unknown) => {
        if (!cancelled && (error as { name?: string })?.name !== 'RenderingCancelledException') setFailed(true);
      });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, width]);

  const point = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
  };

  const shown = draft ?? pending;

  return (
    <div ref={container} className="w-full">
      <div className="relative inline-block align-top bg-white shadow-sm">
        <canvas ref={canvas} aria-label={`Page ${pageNumber}`} className="block" />
        {failed && <p className="absolute inset-0 grid place-items-center text-sm text-red-600">This page could not be shown.</p>}
        <div
          className={`absolute inset-0 ${marking ? 'cursor-crosshair touch-none' : 'pointer-events-none'}`}
          data-testid="page-overlay"
          onPointerDown={(event) => {
            if (!marking) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = point(event);
            setDraft({ ...start.current, width: 0, height: 0 });
          }}
          onPointerMove={(event) => { if (start.current) setDraft(box(start.current, point(event))); }}
          onPointerUp={(event) => {
            if (!start.current) return;
            const rect = box(start.current, point(event));
            start.current = null;
            setDraft(null);
            if (rect.width >= MIN_MARK && rect.height >= MIN_MARK) onMark(rect);
          }}
          onPointerCancel={() => { start.current = null; setDraft(null); }}
        >
          {marks.map((mark) => {
            const solved = solvedIds.includes(mark.id);
            const active = mark.id === activeId;
            return (
              <button
                key={mark.id}
                onClick={() => onOpenMark(mark)}
                aria-label={`Open ${mark.label}`}
                style={percent(mark.rect)}
                // Ink only, so marks read on e-ink: the open one is heavier, a solved one has a filled label.
                className={`absolute rounded border-gray-900 ${active ? 'border-[3px] bg-gray-900/10' : 'border-2'} ${marking ? 'pointer-events-none' : 'pointer-events-auto'} hover:bg-gray-900/10`}
              >
                <span className={`absolute bottom-full left-0 mb-0.5 px-1.5 rounded border border-gray-900 text-[11px] leading-5 font-medium whitespace-nowrap ${solved || active ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
                  {solved ? '✓ ' : ''}{mark.label}
                </span>
              </button>
            );
          })}
          {shown && <div style={percent(shown)} className="absolute border-2 border-dashed border-gray-900 bg-gray-900/10" />}
          {pending && !draft && (
            <div
              ref={form}
              style={formPosition(pending)}
              className="absolute z-10 my-1 cursor-auto"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {pendingForm}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
