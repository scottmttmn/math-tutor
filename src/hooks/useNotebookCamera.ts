'use client';

import { useCallback, useEffect, useState } from 'react';
import { Box, type Editor, type TLCameraOptions } from 'tldraw';
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
    // setCameraOptions merges fields; explicitly clear constraints when they were absent.
    const restoreOptions = () => editor.setCameraOptions({ ...previous, constraints: previous.constraints });
    const content = editor.getCurrentPageBounds();
    // New boards have one consistent width. Existing work gets a wider page when necessary.
    const left = content ? Math.min(0, content.minX - PAGE_MARGIN) : 0;
    const right = content ? Math.max(PAGE_WIDTH, content.maxX + PAGE_MARGIN) : PAGE_WIDTH;
    let bounds = new Box(left, 0, right - left, PAGE_WIDTH);
    setPage(bounds);
    const options = (): Partial<TLCameraOptions> => ({
      wheelBehavior: 'pan',
      zoomSteps: [0.5, 0.75, 1, 1.5, 2, 3, 4],
      constraints: {
        bounds, padding: { x: VIEW_MARGIN, y: 0 }, origin: { x: 0.5, y: 0 },
        initialZoom: 'fit-x', baseZoom: 'fit-x', behavior: { x: 'contain', y: 'free' },
      },
    });
    const fitZoom = () => (editor.getViewportScreenBounds().w - VIEW_MARGIN * 2) / bounds.w;
    const visible = () => editor.getViewportScreenBounds().w > VIEW_MARGIN * 2;
    let lastFitZoom = fitZoom();
    let suspended = !visible();
    let restoreCamera = editor.getCamera();
    let restoreFit = true;
    let firstFit = true;
    if (!suspended) {
      editor.setCameraOptions(options());
      fitNotebookWidth(editor, (content?.minY ?? 0) - 80 / lastFitZoom);
      firstFit = false;
    }
    let frame: number | undefined;
    const onResize = () => {
      if (!visible()) {
        if (frame !== undefined) cancelAnimationFrame(frame);
        if (!suspended) {
          restoreCamera = editor.getCamera();
          restoreFit = Math.abs(restoreCamera.z - lastFitZoom) < 0.001;
          suspended = true;
          // A hidden Shelf board reports a 1px viewport. fit-x with padding would give zero
          // zoom; remove those constraints before tldraw clamps its camera after this event.
          restoreOptions();
        }
        return;
      }
      const camera = suspended ? restoreCamera : editor.getCamera();
      const wasFit = suspended ? restoreFit : Math.abs(camera.z - lastFitZoom) < 0.001;
      if (suspended) { editor.setCameraOptions(options()); suspended = false; }
      // tldraw finishes centering/clamping after emitting resize. Restore next frame.
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (firstFit) fitNotebookWidth(editor, (content?.minY ?? 0) - 80 / fitZoom());
        else if (wasFit) fitNotebookWidth(editor, -camera.y);
        else editor.setCamera(camera);
        firstFit = false;
        lastFitZoom = fitZoom();
      });
    };
    editor.on('resize', onResize);

    // Pasting, transforming or nudging work can put it outside the paper. Expand after the
    // edit rests, never shrink or move ink, and keep the writing view fitted if it was fitted.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = editor.store.listen(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const work = editor.getCurrentPageBounds();
        if (!work || work.minX >= bounds.minX && work.maxX <= bounds.maxX) return;
        const x = work.minX < bounds.minX ? work.minX - PAGE_MARGIN : bounds.minX;
        const maxX = work.maxX > bounds.maxX ? work.maxX + PAGE_MARGIN : bounds.maxX;
        const wasFit = Math.abs(editor.getZoomLevel() - lastFitZoom) < 0.001;
        const top = editor.getViewportPageBounds().minY;
        bounds = new Box(x, 0, maxX - x, PAGE_WIDTH);
        setPage(bounds);
        if (!suspended) {
          editor.setCameraOptions(options());
          if (wasFit) fitNotebookWidth(editor, top);
          lastFitZoom = fitZoom();
        }
      }, 250);
    }, { scope: 'document', source: 'all' });
    return () => {
      stop();
      clearTimeout(timer);
      editor.off('resize', onResize);
      if (frame !== undefined) cancelAnimationFrame(frame);
      editor.stopCameraAnimation();
      restoreOptions();
    };
  }, [editor, enabled, pendingLoad]);

  const fitWidth = useCallback(() => {
    if (editor && enabled) fitNotebookWidth(editor);
  }, [editor, enabled]);
  return { notebookPage: page, fitWidth };
}
