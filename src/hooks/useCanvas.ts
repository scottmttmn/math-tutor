'use client';

import { useRef, useCallback } from 'react';
import type { RefObject } from 'react';
import type { Point, Stroke, SelectionRect } from '@/types';
import { useCanvasState, useCanvasDispatch } from '@/context/CanvasContext';
import { CANVAS_BG_COLOR } from '@/lib/constants';

export function useCanvas(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const { toolSettings } = useCanvasState();
  const dispatch = useCanvasDispatch();
  const isDrawing = useRef(false);
  const currentPoints = useRef<Point[]>([]);

  const getCtx = useCallback(() => {
    return canvasRef.current?.getContext('2d') ?? null;
  }, [canvasRef]);

  const replayStrokes = useCallback((strokeList: Stroke[]) => {
    const ctx = getCtx();
    const canvas = canvasRef.current;
    if (!ctx || !canvas) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CANVAS_BG_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokeList) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = stroke.thickness;

      if (stroke.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = 'rgba(0,0,0,1)';
      } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
      }

      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [getCtx, canvasRef]);

  // CSS coordinates only — ctx.scale(dpr) handles buffer mapping
  const getPointerPos = useCallback((e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, [canvasRef]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (toolSettings.activeTool === 'select') return;
    const ctx = getCtx();
    if (!ctx) return;

    isDrawing.current = true;
    const pos = getPointerPos(e);
    currentPoints.current = [pos];

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (toolSettings.activeTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = toolSettings.eraserThickness;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = toolSettings.penColor;
      ctx.lineWidth = toolSettings.penThickness;
    }

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);

    // Capture pointer for smooth drawing even when moving outside canvas
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }, [toolSettings, getCtx, getPointerPos]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const ctx = getCtx();
    if (!ctx) return;

    const pos = getPointerPos(e);
    currentPoints.current.push(pos);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    // Keep path open so we don't get gaps
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  }, [getCtx, getPointerPos]);

  const onPointerUp = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const ctx = getCtx();
    if (ctx) ctx.restore();

    if (currentPoints.current.length >= 2) {
      const stroke: Stroke = {
        points: [...currentPoints.current],
        color: toolSettings.activeTool === 'eraser' ? '#000000' : toolSettings.penColor,
        thickness: toolSettings.activeTool === 'eraser' ? toolSettings.eraserThickness : toolSettings.penThickness,
        tool: toolSettings.activeTool === 'eraser' ? 'eraser' : 'pen',
      };
      dispatch({ type: 'ADD_STROKE', stroke });
    }
    currentPoints.current = [];
  }, [toolSettings, getCtx, dispatch]);

  const captureFullCanvas = useCallback((): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '';
    return canvas.toDataURL('image/png').split(',')[1];
  }, [canvasRef]);

  const captureRegion = useCallback((rect: SelectionRect): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '';

    const dpr = window.devicePixelRatio || 1;
    const absW = Math.abs(rect.width);
    const absH = Math.abs(rect.height);

    // Output at CSS pixel size (good enough for AI vision)
    const offscreen = document.createElement('canvas');
    offscreen.width = absW * dpr;
    offscreen.height = absH * dpr;
    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return '';

    // Selection rect is in CSS coords; canvas buffer is dpr-scaled
    const sx = (rect.width >= 0 ? rect.startX : rect.startX + rect.width) * dpr;
    const sy = (rect.height >= 0 ? rect.startY : rect.startY + rect.height) * dpr;

    offCtx.drawImage(
      canvas,
      sx, sy, absW * dpr, absH * dpr,
      0, 0, absW * dpr, absH * dpr,
    );
    return offscreen.toDataURL('image/png').split(',')[1];
  }, [canvasRef]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    captureFullCanvas,
    captureRegion,
    replayStrokes,
  };
}
