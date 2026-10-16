'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '@/lib/pdf';
import { toPage, toShown } from '@/lib/reader';
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
  /** The part of the page to show (its blank margins trimmed), in fractions of the page; null for all of it. */
  crop: PageRect | null;
  /** A tap near an edge, or a sideways swipe: -1 back a page, 1 on. */
  onTurn: (direction: -1 | 1) => void;
  /** A tap in the middle of the page. */
  onTapMiddle?: () => void;
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
// A tap in the outer quarter of the page turns it; a sideways drag this long (CSS px) is a swipe.
const TURN_ZONE = 0.25;
const SWIPE = 50;
// Movement within this (CSS px) still counts as a tap.
const TAP_SLOP = 10;

const percent = (rect: PageRect) => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

/** One PDF page (or its printed part), fit to its container's width, with marked exercises drawn over it. */
export default function PdfPage({ pdf, pageNumber, marks, solvedIds, activeId, marking, pending, pendingForm, onMark, onOpenMark, crop, onTurn, onTapMiddle }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PageRect | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; id: number } | null>(null);

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
        task = renderPage(page, canvas.current, width, crop);
        return task.promise;
      })
      .then(() => { if (!cancelled) setFailed(false); })
      .catch((error: unknown) => {
        if (!cancelled && (error as { name?: string })?.name !== 'RenderingCancelledException') setFailed(true);
      });
    return () => { cancelled = true; task?.cancel(); };
  }, [pdf, pageNumber, width, crop]);

  // Where the pointer is on the page, in fractions of the whole page (not just the part shown).
  const point = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const onPage = toPage({ x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }, crop);
    return { x: clamp(onPage.x), y: clamp(onPage.y) };
  };

  // Not marking: a tap at an edge or a sideways swipe turns the page, a tap in the middle is passed
  // on. Taps on a mark open it instead, and an up-and-down drag scrolls (the browser takes it).
  const endPress = (event: React.PointerEvent) => {
    const start = press.current;
    press.current = null;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= SWIPE && Math.abs(dx) > 1.5 * Math.abs(dy)) { onTurn(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) > TAP_SLOP) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const across = (event.clientX - bounds.left) / bounds.width;
    if (across < TURN_ZONE) onTurn(-1);
    else if (across > 1 - TURN_ZONE) onTurn(1);
    else onTapMiddle?.();
  };

  const shown = draft ?? pending;
  const shownPending = pending && toShown(pending, crop);

  return (
    <div ref={container} className="w-full">
      <div className="relative inline-block align-top bg-white shadow-sm">
        <canvas ref={canvas} aria-label={`Page ${pageNumber}`} className="block" />
        {failed && <p className="absolute inset-0 grid place-items-center text-sm text-red-600">This page could not be shown.</p>}
        <div
          // Up-and-down drags still scroll the page and pinches still zoom; sideways ones are swipes.
          className={`absolute inset-0 ${marking ? 'cursor-crosshair touch-none' : 'touch-pan-y touch-pinch-zoom'}`}
          data-testid="page-overlay"
          onPointerDown={(event) => {
            if (!marking) {
              if (event.target === event.currentTarget && event.isPrimary && event.button === 0) press.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = point(event);
            setDraft({ ...start.current, width: 0, height: 0 });
          }}
          onPointerMove={(event) => { if (start.current) setDraft(box(start.current, point(event))); }}
          onPointerUp={(event) => {
            if (!start.current) { endPress(event); return; }
            const rect = box(start.current, point(event));
            start.current = null;
            setDraft(null);
            if (rect.width >= MIN_MARK && rect.height >= MIN_MARK) onMark(rect);
          }}
          onPointerCancel={() => { start.current = null; press.current = null; setDraft(null); }}
        >
          {marks.map((mark) => {
            const solved = solvedIds.includes(mark.id);
            const active = mark.id === activeId;
            return (
              <button
                key={mark.id}
                onClick={() => onOpenMark(mark)}
                aria-label={`Open ${mark.label}`}
                style={percent(toShown(mark.rect, crop))}
                // Ink only, so marks read on e-ink: the open one is heavier, a solved one has a filled label.
                className={`absolute rounded border-gray-900 ${active ? 'border-[3px] bg-gray-900/10' : 'border-2'} ${marking ? 'pointer-events-none' : ''} hover:bg-gray-900/10`}
              >
                <span className={`absolute bottom-full left-0 mb-0.5 px-1.5 rounded border border-gray-900 text-[11px] leading-5 font-medium whitespace-nowrap ${solved || active ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
                  {solved ? '✓ ' : ''}{mark.label}
                </span>
              </button>
            );
          })}
          {shown && <div style={percent(toShown(shown, crop))} className="absolute border-2 border-dashed border-gray-900 bg-gray-900/10" />}
          {shownPending && !draft && (
            <div
              ref={form}
              style={formPosition(shownPending)}
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
