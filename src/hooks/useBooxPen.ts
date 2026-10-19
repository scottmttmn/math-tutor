'use client';

import { useEffect, useState } from 'react';
import { b64Vecs, createShapeId, DefaultColorStyle, DefaultDashStyle, DefaultSizeStyle, useValue, type Editor, type TLDrawShape, type TLShapePartial } from 'tldraw';
import { BooxPen, booxPenAvailable, boxOf, overlaps, strokePoints } from '@/lib/booxPen';
import { deviceToggle } from '@/hooks/useDeviceToggle';

/** Board → BOOX pen (experiment), remembered on this device; only offered on a BOOX tablet. */
export const useBooxPenMode = deviceToggle('math-tutor:booxPen');

/** Whether this is the Android app on a BOOX tablet (false until known). */
export function useBooxPenAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void booxPenAvailable().then((onyx) => { if (live) setAvailable(onyx); });
    return () => { live = false; };
  }, []);
  return available;
}

// The pen's width while the controller draws it, in CSS px: close to tldraw's S at writing zoom.
const RAW_WIDTH = 2.5;
// After the board changes (a stroke drawn, an undo, a pan), the screen is let through this long after.
const REFRESH_DELAY_MS = 300;
// How close the eraser end must pass to a stroke to erase it, in CSS px.
const ERASER_REACH = 6;
// tldraw's own controls over the canvas, which the pen must still be able to tap.
const CONTROLS = '.tlui-layout__top > *, .tlui-layout__bottom > *, [data-testid="show-tools"]';
// Anything that, while open, sits over the board and takes the pen: menus, dialogs, popovers.
const OVERLAYS = '[role="menu"], [role="dialog"], [role="listbox"], .tlui-popover__content';

/**
 * On a BOOX tablet with the experiment on, the pen tool's strokes are drawn by Onyx's pen SDK
 * (the e-ink controller, much faster than the browser) and each finished one becomes a tldraw
 * draw shape with the pen's current style, one undo step each. The eraser end erases whole strokes.
 * Other tools, open menus and dialogs, and a hidden board give the pen back to the page.
 *
 * Not yet tried on a device; see BooxPenPlugin.java.
 */
export function useBooxPen(editor: Editor | null) {
  const [mode] = useBooxPenMode();
  const available = useBooxPenAvailable();
  const drawing = useValue('pen tool', () => editor?.getCurrentToolId() === 'draw', [editor]);
  const enabled = Boolean(editor && mode && available && drawing);

  useEffect(() => {
    if (!editor || !enabled) return;
    const root = editor.getContainer();
    let stopped = false;
    let started = false;
    let paused = false;
    let lastRegion = '';
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const removers: (() => void)[] = [];

    // Where the pen draws: the canvas, less tldraw's controls over it. Null while the board is hidden.
    const measure = () => {
      const canvas = root.querySelector('.tl-canvas');
      const region = canvas ? boxOf(canvas.getBoundingClientRect()) : null;
      if (!region) return null;
      const exclude = [...root.querySelectorAll(CONTROLS)].flatMap((element) => {
        const box = boxOf(element.getBoundingClientRect());
        return box && overlaps(box, region) ? [box] : [];
      });
      return { region, exclude };
    };

    const sync = () => {
      if (stopped) return;
      const area = measure();
      const covered = Boolean(area) && [...document.querySelectorAll(OVERLAYS)].some((element) => {
        const box = boxOf(element.getBoundingClientRect());
        return box && area && overlaps(box, area.region);
      });
      const key = JSON.stringify(area);
      if (!area || covered) {
        if (started && !paused) { paused = true; void BooxPen.pause().catch(() => undefined); }
        return;
      }
      if (!started) {
        started = true;
        lastRegion = key;
        void BooxPen.start({ ...area, width: RAW_WIDTH }).catch(() => { started = false; });
        return;
      }
      if (key !== lastRegion) {
        lastRegion = key;
        void BooxPen.setRegion(area).catch(() => undefined);
      }
      if (paused) { paused = false; void BooxPen.resume().catch(() => undefined); }
    };

    let syncFrame = 0;
    const scheduleSync = () => {
      cancelAnimationFrame(syncFrame);
      syncFrame = requestAnimationFrame(sync);
    };
    sync();

    const resize = new ResizeObserver(scheduleSync);
    resize.observe(root);
    const changes = new MutationObserver(scheduleSync);
    changes.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('scroll', scheduleSync, true);
    removers.push(() => {
      cancelAnimationFrame(syncFrame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('scroll', scheduleSync, true);
    });

    // The SDK has the pen on the canvas; if the WebView still hears it, tldraw mustn't draw it twice.
    const blockPen = (event: PointerEvent) => {
      if (event.pointerType !== 'pen' || !(event.target instanceof Element) || !event.target.closest('.tl-canvas')) return;
      event.stopPropagation();
      event.preventDefault();
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      root.addEventListener(type, blockPen, true);
      removers.push(() => root.removeEventListener(type, blockPen, true));
    }
    // Fingers pan and zoom rather than draw (tldraw's pen mode), as they do once tldraw has seen a pen.
    editor.updateInstanceState({ isPenMode: true });

    // Raw drawing holds the screen back over the region, so let it through once the board has settled.
    const stopListening = editor.store.listen(() => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (started && !paused) void BooxPen.refresh().catch(() => undefined);
      }, REFRESH_DELAY_MS);
    }, { source: 'all' });
    removers.push(stopListening, () => clearTimeout(refreshTimer));

    const listen = (event: 'stroke' | 'erase', handle: (flat: number[]) => void) => {
      const added = BooxPen.addListener(event, ({ points }) => { if (!stopped) handle(points); });
      removers.push(() => { void added.then((listener) => listener.remove()); });
    };
    listen('stroke', (flat) => {
      const shape = drawShape(editor, flat);
      if (!shape) return;
      editor.markHistoryStoppingPoint('boox pen stroke');
      editor.createShape(shape);
    });
    listen('erase', (flat) => {
      const margin = ERASER_REACH / editor.getZoomLevel();
      const hit = new Set(strokePoints(flat).flatMap(({ x, y }) =>
        editor.getShapesAtPoint(editor.screenToPage({ x, y }), { margin, hitInside: false })
          .filter((shape) => shape.type === 'draw' && !shape.isLocked)
          .map((shape) => shape.id)));
      if (hit.size === 0) return;
      editor.markHistoryStoppingPoint('boox pen erase');
      editor.deleteShapes([...hit]);
    });

    return () => {
      stopped = true;
      removers.forEach((remove) => remove());
      if (started) void BooxPen.stop().catch(() => undefined);
    };
  }, [editor, enabled]);
}

/** A stroke from the SDK as a draw shape at its place on the page, in the pen's current style. */
export function drawShape(editor: Editor, flat: number[]): TLShapePartial<TLDrawShape> | null {
  const points = strokePoints(flat).map(({ x, y, pressure }) => {
    const page = editor.screenToPage({ x, y });
    return { x: page.x, y: page.y, z: pressure };
  });
  if (points.length === 0) return null;
  const [origin] = points;
  const relative = points.map((point) => ({ x: point.x - origin.x, y: point.y - origin.y, z: point.z }));
  return {
    id: createShapeId(),
    type: 'draw',
    x: origin.x,
    y: origin.y,
    props: {
      color: editor.getStyleForNextShape(DefaultColorStyle),
      size: editor.getStyleForNextShape(DefaultSizeStyle),
      dash: editor.getStyleForNextShape(DefaultDashStyle),
      segments: [{ type: 'free', path: b64Vecs.encodePoints(relative, 3), dim: 3 }],
      isComplete: true,
      isPen: true,
      scale: editor.user.getIsDynamicResizeMode() ? 1 / editor.getZoomLevel() : 1,
    },
  };
}
