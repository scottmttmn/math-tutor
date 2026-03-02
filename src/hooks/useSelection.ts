'use client';

import { useRef, useCallback } from 'react';
import type { SelectionRect } from '@/types';
import { useCanvasState, useCanvasDispatch } from '@/context/CanvasContext';

export function useSelection(
  overlayRef: React.RefObject<HTMLCanvasElement | null>,
  drawingCanvasRef: React.RefObject<HTMLCanvasElement | null>,
) {
  const { toolSettings } = useCanvasState();
  const dispatch = useCanvasDispatch();
  const isDragging = useRef(false);
  const startPos = useRef({ x: 0, y: 0 });

  const getPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = overlayRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, [overlayRef]);

  const drawSelectionRect = useCallback((rect: SelectionRect) => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(rect.startX, rect.startY, rect.width, rect.height);
    ctx.strokeRect(rect.startX, rect.startY, rect.width, rect.height);
    ctx.setLineDash([]);
  }, [overlayRef]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (toolSettings.activeTool !== 'select') return;
    isDragging.current = true;
    const pos = getPos(e);
    startPos.current = pos;
    dispatch({ type: 'SET_SELECTION', rect: null });
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }, [toolSettings, getPos, dispatch]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    const pos = getPos(e);
    const rect: SelectionRect = {
      startX: startPos.current.x,
      startY: startPos.current.y,
      width: pos.x - startPos.current.x,
      height: pos.y - startPos.current.y,
    };
    drawSelectionRect(rect);
  }, [getPos, drawSelectionRect]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    const pos = getPos(e);
    const rect: SelectionRect = {
      startX: startPos.current.x,
      startY: startPos.current.y,
      width: pos.x - startPos.current.x,
      height: pos.y - startPos.current.y,
    };
    // Only set selection if it has meaningful area
    if (Math.abs(rect.width) > 10 && Math.abs(rect.height) > 10) {
      dispatch({ type: 'SET_SELECTION', rect });
    } else {
      // Clear overlay if selection too small
      const canvas = overlayRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      dispatch({ type: 'SET_SELECTION', rect: null });
    }
  }, [getPos, dispatch, overlayRef]);

  const clearOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    dispatch({ type: 'SET_SELECTION', rect: null });
  }, [overlayRef, dispatch]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    clearOverlay,
  };
}
