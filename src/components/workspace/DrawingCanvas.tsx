'use client';

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle, type PointerEvent as ReactPointerEvent } from 'react';
import { useCanvas } from '@/hooks/useCanvas';
import { useSelection } from '@/hooks/useSelection';
import { useCanvasState } from '@/context/CanvasContext';
import { CANVAS_HEIGHT } from '@/lib/constants';
import type { SelectionRect } from '@/types';

export interface DrawingCanvasHandle {
  captureFullCanvas: () => string;
  captureRegion: (rect: SelectionRect) => string;
  getCanvas: () => HTMLCanvasElement | null;
}

const DrawingCanvas = forwardRef<DrawingCanvasHandle>(function DrawingCanvas(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [resizeKey, setResizeKey] = useState(0);
  const { toolSettings, strokes, selection } = useCanvasState();

  const {
    onPointerDown: drawPointerDown,
    onPointerMove: drawPointerMove,
    onPointerUp: drawPointerUp,
    captureFullCanvas,
    captureRegion,
    replayStrokes,
  } = useCanvas(canvasRef);

  const {
    onPointerDown: selectPointerDown,
    onPointerMove: selectPointerMove,
    onPointerUp: selectPointerUp,
  } = useSelection(overlayRef, canvasRef);

  useImperativeHandle(ref, () => ({
    captureFullCanvas,
    captureRegion,
    getCanvas: () => canvasRef.current,
  }));

  const resizeCanvas = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!container || !canvas || !overlay) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = CANVAS_HEIGHT * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;

    overlay.width = rect.width * dpr;
    overlay.height = CANVAS_HEIGHT * dpr;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${CANVAS_HEIGHT}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      const overlayCtx = overlay.getContext('2d');
      if (overlayCtx) overlayCtx.scale(dpr, dpr);
    }

    // Trigger replay via resizeKey change
    setResizeKey((k) => k + 1);
  }, []);

  useEffect(() => {
    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay strokes whenever strokes change or canvas is resized
  useEffect(() => {
    replayStrokes(strokes);
  }, [strokes, resizeKey, replayStrokes]);

  // Clear the overlay when the selection is cleared from state (ERASE_SELECTION,
  // Delete key). The selection pointer handlers repaint the overlay themselves,
  // so without this the dashed rect lingers after a state-only clear.
  useEffect(() => {
    if (selection) return;
    const overlay = overlayRef.current;
    const ctx = overlay?.getContext('2d');
    if (overlay && ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }, [selection]);

  const isSelectMode = toolSettings.activeTool === 'select';
  const isPanMode = toolSettings.activeTool === 'pan';

  // Pan tool: drag to scroll the overflow-y-auto container
  const panStart = useRef<{ clientY: number; scrollTop: number } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const handlePanPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const scrollEl = containerRef.current?.parentElement;
    if (!scrollEl) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panStart.current = { clientY: e.clientY, scrollTop: scrollEl.scrollTop };
    setIsPanning(true);
  }, []);

  const handlePanPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!panStart.current) return;
    const scrollEl = containerRef.current?.parentElement;
    if (!scrollEl) return;
    const dy = e.clientY - panStart.current.clientY;
    scrollEl.scrollTop = panStart.current.scrollTop - dy;
  }, []);

  const handlePanPointerUp = useCallback(() => {
    panStart.current = null;
    setIsPanning(false);
  }, []);

  const canvasCursor = isPanMode
    ? (isPanning ? 'grabbing' : 'grab')
    : isSelectMode
    ? 'crosshair'
    : 'crosshair'; // always crosshair for drawing precision

  return (
    <div ref={containerRef} className="relative bg-white rounded-lg border border-gray-200 mx-3 mb-2" style={{ height: CANVAS_HEIGHT }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: canvasCursor }}
        onPointerDown={isPanMode ? handlePanPointerDown : isSelectMode ? undefined : drawPointerDown}
        onPointerMove={isPanMode ? handlePanPointerMove : isSelectMode ? undefined : drawPointerMove}
        onPointerUp={isPanMode ? handlePanPointerUp : isSelectMode ? undefined : drawPointerUp}
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 touch-none"
        style={{
          cursor: canvasCursor,
          pointerEvents: isSelectMode ? 'auto' : 'none',
        }}
        onPointerDown={isSelectMode ? selectPointerDown : undefined}
        onPointerMove={isSelectMode ? selectPointerMove : undefined}
        onPointerUp={isSelectMode ? selectPointerUp : undefined}
      />
    </div>
  );
});

export default DrawingCanvas;
