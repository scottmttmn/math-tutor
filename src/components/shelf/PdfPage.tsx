'use client';

import { useEffect, useRef, useState } from 'react';
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
  onMark: (rect: PageRect) => void;
  onOpenMark: (exercise: ShelfExercise) => void;
}

// A box smaller than this (as a fraction of the page) is a stray tap, not a mark.
const MIN_MARK = 0.02;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const box = (a: { x: number; y: number }, b: { x: number; y: number }): PageRect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y),
});
const percent = (rect: PageRect) => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });

/** One PDF page, fit to its container's width, with marked exercises drawn over it. */
export default function PdfPage({ pdf, pageNumber, marks, solvedIds, activeId, marking, onMark, onOpenMark }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [failed, setFailed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<PageRect | null>(null);

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
                className={`absolute rounded border-2 ${marking ? 'pointer-events-none' : 'pointer-events-auto'} ${active ? 'border-blue-600 bg-blue-500/10' : solved ? 'border-green-500 bg-green-500/5' : 'border-amber-500 bg-amber-400/5'} hover:bg-blue-500/10`}
              >
                <span className={`absolute bottom-full left-0 mb-0.5 px-1.5 rounded text-[11px] leading-5 font-medium text-white whitespace-nowrap ${active ? 'bg-blue-600' : solved ? 'bg-green-600' : 'bg-amber-600'}`}>
                  {solved ? '✓ ' : ''}{mark.label}
                </span>
              </button>
            );
          })}
          {draft && <div style={percent(draft)} className="absolute border-2 border-dashed border-blue-600 bg-blue-500/10" />}
        </div>
      </div>
    </div>
  );
}
