'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPage } from '@/lib/pdf';
import { toPage, toShown } from '@/lib/reader';
import { ERASER_RADIUS, drawStroke, drawStrokes, eraseAt, inkPoint, pageScale } from '@/lib/ink';
import type { InkStroke, InkTool, PageRect, ShelfExercise } from '@/types';
import { NotesIcon } from '@/components/common/Icons';

interface Props {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  /** Exercises and note pages marked on this page. */
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
  /** The ink on this page, and the tool writing with it (null: none, the page is only read). */
  ink: InkStroke[];
  tool: InkTool | null;
  /** The page's ink after a stroke is written or rubbed out. */
  onInk: (strokes: InkStroke[]) => void;
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
export default function PdfPage({ pdf, pageNumber, marks, solvedIds, activeId, marking, pending, pendingForm, onMark, onOpenMark, crop, onTurn, onTapMiddle, ink, tool, onInk }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PageRect | null>(null);
  const form = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number; id: number } | null>(null);
  const overlay = useRef<HTMLDivElement>(null);
  // Ink: the saved strokes on one canvas, the one being written on another above it.
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  const [shownSize, setShownSize] = useState<{ width: number; height: number } | null>(null);
  // The stroke being written, or the strokes left so far by the eraser.
  const writing = useRef<{ id: number; tool: InkTool; points: number[]; strokes: InkStroke[]; last?: { x: number; y: number } } | null>(null);

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

  // The ink canvases match the page as it is shown.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width: shownWidth, height: shownHeight } = element.getBoundingClientRect();
      setShownSize((current) => (current?.width === shownWidth && current?.height === shownHeight ? current : { width: shownWidth, height: shownHeight }));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Draw the saved ink whenever it, or the page's size, changes; the stroke just finished is in it now.
  useEffect(() => {
    const target = inkCanvas.current;
    if (!shownSize || !target) return;
    const ratio = window.devicePixelRatio || 1;
    for (const layer of [target, liveCanvas.current]) {
      if (!layer) continue;
      layer.width = Math.round(shownSize.width * ratio);
      layer.height = Math.round(shownSize.height * ratio);
      layer.getContext('2d')?.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    const context = target.getContext('2d');
    if (context) drawStrokes(context, writing.current?.tool === 'eraser' ? writing.current.strokes : ink, pageScale(shownSize.width, shownSize.height, crop), crop);
  }, [ink, shownSize, crop]);

  // A pen on the page writes rather than scrolling it: its touch events (browsers send them for a
  // pen too) are cancelled, while fingers still scroll and pinch.
  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    const onTouch = (event: TouchEvent) => { if (writing.current) event.preventDefault(); };
    element.addEventListener('touchstart', onTouch, { passive: false });
    element.addEventListener('touchmove', onTouch, { passive: false });
    return () => {
      element.removeEventListener('touchstart', onTouch);
      element.removeEventListener('touchmove', onTouch);
    };
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

  const scale = () => pageScale(shownSize?.width ?? 1, shownSize?.height ?? 1, crop);
  const redraw = (strokes: InkStroke[]) => {
    const context = inkCanvas.current?.getContext('2d');
    if (!context || !shownSize) return;
    context.clearRect(0, 0, shownSize.width, shownSize.height);
    drawStrokes(context, strokes, scale(), crop);
  };
  const clearLive = () => {
    const context = liveCanvas.current?.getContext('2d');
    if (context && shownSize) context.clearRect(0, 0, shownSize.width, shownSize.height);
  };

  // Adds the event's samples (all of them, not just the last, so fast writing stays smooth) to the stroke.
  const continueInk = (event: React.PointerEvent) => {
    const current = writing.current;
    if (!current || current.id !== event.pointerId) return;
    const native = event.nativeEvent;
    const samples = native.getCoalescedEvents?.() ?? [];
    const size = scale();
    const bounds = event.currentTarget.getBoundingClientRect();
    for (const sample of samples.length ? samples : [native]) {
      const onPage = toPage({ x: (sample.clientX - bounds.left) / bounds.width, y: (sample.clientY - bounds.top) / bounds.height }, crop);
      if (current.tool === 'eraser') {
        // From where the eraser was at the last sample, so a fast sweep misses nothing in between.
        const left = eraseAt(current.strokes, onPage, ERASER_RADIUS, size, current.last);
        current.last = onPage;
        if (left !== current.strokes) { current.strokes = left; redraw(left); }
        continue;
      }
      const [x, y, pressure] = inkPoint(clamp(onPage.x), clamp(onPage.y), sample.pressure);
      const last = current.points.length - 3;
      // Samples closer than half a pixel add nothing but size.
      if (last >= 0 && Math.hypot((x - current.points[last]) * size.x, (y - current.points[last + 1]) * size.y) < 0.5) continue;
      current.points.push(x, y, pressure);
    }
    if (current.tool === 'eraser') return;
    const context = liveCanvas.current?.getContext('2d');
    if (!context || !shownSize) return;
    // Redrawn whole each time: cheap for one stroke, and a highlight stays even where it overlaps itself.
    context.clearRect(0, 0, shownSize.width, shownSize.height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    drawStroke(context, { tool: current.tool, points: current.points }, size, (crop?.x ?? 0) * size.x, (crop?.y ?? 0) * size.y);
  };

  const startInk = (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    press.current = null;
    // The pen's eraser end (button 5) rubs out, whatever the tool.
    writing.current = { id: event.pointerId, tool: event.button === 5 ? 'eraser' : tool ?? 'pen', points: [], strokes: ink };
    continueInk(event);
  };

  const endInk = (event: React.PointerEvent, cancelled = false) => {
    const current = writing.current;
    if (!current || current.id !== event.pointerId) return;
    if (!cancelled) continueInk(event);
    writing.current = null;
    if (current.tool === 'eraser') {
      if (current.strokes !== ink) onInk(current.strokes);
      return;
    }
    if (!cancelled && current.points.length) onInk([...ink, { tool: current.tool, points: current.points }]);
    else clearLive();
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
        {/* Ink sits over the print and under the marks; the overlay above takes the pointer. */}
        <canvas ref={inkCanvas} data-testid="page-ink" className="absolute inset-0 w-full h-full pointer-events-none" />
        <canvas ref={liveCanvas} className="absolute inset-0 w-full h-full pointer-events-none" />
        {failed && <p className="absolute inset-0 grid place-items-center text-sm text-red-600">This page could not be shown.</p>}
        <div
          // Up-and-down drags still scroll the page and pinches still zoom; sideways ones are swipes.
          ref={overlay}
          className={`absolute inset-0 ${marking ? 'cursor-crosshair touch-none' : 'touch-pan-y touch-pinch-zoom'} ${tool && !marking ? 'cursor-crosshair' : ''}`}
          data-testid="page-overlay"
          onContextMenu={(event) => { if (tool) event.preventDefault(); }}
          onPointerDown={(event) => {
            // With a tool on, the pen (or mouse) writes; a finger still turns, scrolls and zooms.
            if (tool && !marking && event.pointerType !== 'touch' && (event.button === 0 || event.button === 5)) { startInk(event); return; }
            // A palm resting while the pen writes does nothing.
            if (writing.current) return;
            if (!marking) {
              if (event.target === event.currentTarget && event.isPrimary && event.button === 0) press.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
              return;
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = point(event);
            setDraft({ ...start.current, width: 0, height: 0 });
          }}
          onPointerMove={(event) => {
            if (writing.current) continueInk(event);
            else if (start.current) setDraft(box(start.current, point(event)));
          }}
          onPointerUp={(event) => {
            if (writing.current) { endInk(event); return; }
            if (!start.current) { endPress(event); return; }
            const rect = box(start.current, point(event));
            start.current = null;
            setDraft(null);
            if (rect.width >= MIN_MARK && rect.height >= MIN_MARK) onMark(rect);
          }}
          onPointerCancel={(event) => { endInk(event, true); start.current = null; press.current = null; setDraft(null); }}
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
                // Ink only, so marks read on e-ink: the open one is heavier, a solved one has a filled
                // label, and a note page's box is dotted with its icon on the label.
                className={`absolute rounded border-gray-900 ${mark.kind === 'note' ? 'border-dotted' : ''} ${active ? 'border-[3px] bg-gray-900/10' : 'border-2'} ${marking || tool ? 'pointer-events-none' : ''} hover:bg-gray-900/10`}
              >
                <span className={`absolute bottom-full left-0 mb-0.5 px-1.5 flex items-center gap-1 rounded border border-gray-900 text-[11px] leading-5 font-medium whitespace-nowrap ${solved || active ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}>
                  {mark.kind === 'note' && <NotesIcon size={12} />}{solved ? '✓ ' : ''}{mark.label}
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
