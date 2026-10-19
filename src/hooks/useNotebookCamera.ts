'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, type Editor } from 'tldraw';
import type { CanvasLoad } from '@/context/CanvasContext';

const PAGE_WIDTH = 960;
const PAGE_MARGIN = 32;
const VIEW_MARGIN = 16;

/** Return to the writing scale while keeping the same line at the top of the view. */
export function fitNotebookWidth(editor: Editor, top = editor.getViewportPageBounds().minY) {
  const page = editor.getCameraOptions().constraints?.bounds;
  if (!page) return;
  const z = (editor.getViewportScreenBounds().w - VIEW_MARGIN * 2) / page.w;
  if (z <= 0) return;
  editor.stopCameraAnimation();
  editor.setCamera({ x: VIEW_MARGIN / z - page.x, y: -top, z });
}

/** Constrain horizontal navigation, leaving the vertical notebook continuous and zoom available. */
export function useNotebookCamera(editor: Editor | null, enabled: boolean, pendingLoad: CanvasLoad | null) {
  const [page, setPage] = useState<Box | null>(null);

  useEffect(() => {
    if (!editor || !enabled || pendingLoad) {
      // The page is view state; changing modes or boards never edits the drawing.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPage(null);
      return;
    }
    const previous = editor.getCameraOptions();
    const content = editor.getCurrentPageBounds();
    // New boards have one consistent width. Existing work gets a wider page when necessary,
    // so entering the experiment never squeezes ink or strands it beyond the camera bounds.
    const left = content ? Math.min(0, content.minX - PAGE_MARGIN) : 0;
    const right = content ? Math.max(PAGE_WIDTH, content.maxX + PAGE_MARGIN) : PAGE_WIDTH;
    const bounds = new Box(left, 0, right - left, PAGE_WIDTH);
    setPage(bounds);
    editor.setCameraOptions({
      wheelBehavior: 'pan',
      zoomSteps: [0.5, 0.75, 1, 1.5, 2, 3, 4],
      constraints: {
        bounds, padding: { x: VIEW_MARGIN, y: 0 }, origin: { x: 0.5, y: 0 },
        initialZoom: 'fit-x', baseZoom: 'fit-x', behavior: { x: 'contain', y: 'free' },
      },
    });
    const initialZoom = (editor.getViewportScreenBounds().w - VIEW_MARGIN * 2) / bounds.w;
    fitNotebookWidth(editor, (content?.minY ?? 0) - 80 / initialZoom);
    let lastWidth = editor.getViewportScreenBounds().w;
    let lastFitZoom = initialZoom;
    let frame: number | undefined;
    const onResize = () => {
      const width = editor.getViewportScreenBounds().w;
      if (width === lastWidth || width <= VIEW_MARGIN * 2) return;
      const wasFit = Math.abs(editor.getZoomLevel() - lastFitZoom) < 0.001;
      const top = editor.getViewportPageBounds().minY;
      // Follow layout/orientation changes at writing scale; preserve an intentional close-up.
      // tldraw finishes centering/clamping its camera after emitting resize, so fit next frame.
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (wasFit) fitNotebookWidth(editor, top);
        else editor.setCamera(editor.getCamera());
        lastWidth = width;
        lastFitZoom = (width - VIEW_MARGIN * 2) / bounds.w;
      });
    };
    editor.on('resize', onResize);
    return () => {
      editor.off('resize', onResize);
      if (frame !== undefined) cancelAnimationFrame(frame);
      editor.stopCameraAnimation();
      editor.setCameraOptions(previous);
    };
  }, [editor, enabled, pendingLoad]);

  const fitWidth = useCallback(() => {
    if (editor && enabled) fitNotebookWidth(editor);
  }, [editor, enabled]);
  return { notebookPage: page, fitWidth };
}
