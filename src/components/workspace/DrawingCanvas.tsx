'use client';

import { useRef, useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { useCanvas } from '@/hooks/useCanvas';
import { useSelection } from '@/hooks/useSelection';
import { useCanvasState } from '@/context/CanvasContext';
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
  const { toolSettings, strokes } = useCanvasState();

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
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    overlay.width = rect.width * dpr;
    overlay.height = rect.height * dpr;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

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

  const isSelectMode = toolSettings.activeTool === 'select';

  return (
    <div ref={containerRef} className="flex-1 relative bg-white rounded-lg border border-gray-200 overflow-hidden mx-3 mb-2">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: isSelectMode ? 'crosshair' : 'default' }}
        onPointerDown={isSelectMode ? undefined : drawPointerDown}
        onPointerMove={isSelectMode ? undefined : drawPointerMove}
        onPointerUp={isSelectMode ? undefined : drawPointerUp}
      />
      <canvas
        ref={overlayRef}
        className="absolute inset-0 touch-none"
        style={{
          cursor: isSelectMode ? 'crosshair' : 'default',
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
