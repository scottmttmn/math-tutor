'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasDispatch, useCanvasState } from '@/context/CanvasContext';
import { GRID_SPACING, LINE_SPACING } from '@/lib/paper';
import { HIGHLIGHTER_WIDTH, INK_COLORS, PEN_WIDTHS, boardBounds, emptyBoard, pushPoint, type PenSize } from '@/lib/inkBoard/model';
import { addItems, commit, redo, removeItems, startHistory, undo, type BoardHistory } from '@/lib/inkBoard/edits';
import { GridIndex, strokesHitByPath } from '@/lib/inkBoard/hitTest';
import { drawBoard, drawBoardStroke } from '@/lib/inkBoard/render';
import { EXPORT_PADDING, MAX_EXPORT_SIDE, THUMBNAIL_SIDE, problemImage, renderItems, tutorImages } from '@/lib/inkBoard/capture';
import { VIEW_MARGIN, clampCamera, fitCamera, fitZoom, toBoard, zoomAbout, type Camera, type ViewSize } from '@/lib/inkBoard/camera';
import { TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE } from '@/lib/tutorBoardImages';
import type { BoardImage, BoardInk, BoardStroke, InkColor, Paper } from '@/types';
import type { DrawingCanvasHandle } from './DrawingCanvas';

// The ink board: our own Notes-like canvas (replacing tldraw). One long page of fixed width; the
// pen or mouse writes, fingers scroll and pinch, the wheel scrolls (with Ctrl, zooms). The drawing
// is plain 2D canvas: finished ink on one canvas, the stroke being written on another above it.

type Tool = 'pen' | 'highlighter' | 'eraser';

// Bumped synchronously on every drawing change (see DrawingCanvasHandle.getRevision). Module-level
// so it never repeats across remounts.
let inkRevision = 0;

// Drawing changes the board on every stroke; mirror it to the app once the pen rests.
const MIRROR_DELAY_MS = 250;
// How close the eraser must pass to a stroke to take it, in screen px.
const ERASER_REACH = 8;
// A problem picture's gap from the page's side or the work, and above it when the view goes to it.
const PROBLEM_MARGIN = 32;
const PROBLEM_TOP = 64;
// Room above the first work when a board opens, in screen px.
const OPEN_TOP = 80;
const COLORS: InkColor[] = ['black', 'gray', 'blue', 'red', 'green'];
const DESK = '#e5e7eb';
const PAPER_LINE = '#c4c8ce';

function loadPicture(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be read'));
    image.src = src;
  });
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Typing in a field, not drawing: board shortcuts leave it alone. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export default function InkBoard({ handleRef, toolsHidden, paper }: { handleRef: RefObject<DrawingCanvasHandle | null>; toolsHidden: boolean; paper: Paper }) {
  const { ink: mirrored, pendingLoad } = useCanvasState();
  const dispatch = useCanvasDispatch();
  const container = useRef<HTMLDivElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  // Undo/redo availability for the toolbar; the ink itself is drawn directly, without re-rendering.
  const [steps, setSteps] = useState({ undo: false, redo: false });
  const [tool, setTool] = useState<Tool>('pen');
  const [size, setSize] = useState<PenSize>('s');
  const [color, setColor] = useState<InkColor>('black');
  const style = useRef({ tool, size, color });
  useEffect(() => { style.current = { tool, size, color }; }, [tool, size, color]);

  // Read once on mount, so a remount (another editor chosen, the page re-rendered) restores what was there.
  const [mountInk] = useState(() => (pendingLoad ? null : mirrored));
  const history = useRef<BoardHistory>(startHistory(mountInk ?? emptyBoard()));
  const index = useRef(new GridIndex());
  const pictures = useRef(new Map<string, { src: string; image: HTMLImageElement | null; ready: Promise<void> }>());
  const camera = useRef<Camera>({ x: 0, y: 0, z: 1 });
  const view = useRef<ViewSize>({ w: 0, h: 0 });
  // Whether the view is at writing scale, so a resize keeps it there.
  const fitted = useRef(true);
  const placed = useRef(false);
  // While a load is pending the board still shows the previous one, which must not be saved.
  const loadPending = useRef(Boolean(pendingLoad));
  const loads = useRef(0);
  const paperRef = useRef(paper);
  // A pass of the eraser shows its result before it becomes one undo step.
  const erasing = useRef<{ before: BoardInk; shown: BoardInk; path: number[] } | null>(null);
  const writing = useRef<{ pointer: number; stroke: BoardStroke; lastX: number; lastY: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);

  const board = () => history.current.board;
  const showSteps = () => setSteps({ undo: history.current.past.length > 0, redo: history.current.future.length > 0 });

  const loaded = useCallback(() => {
    const map = new Map<string, CanvasImageSource>();
    for (const [id, entry] of pictures.current) if (entry.image) map.set(id, entry.image);
    return map;
  }, []);

  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = inkCanvas.current;
    const { w, h } = view.current;
    if (!canvas || w === 0 || h === 0) return;
    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    const { x, y, z } = camera.current;
    const current = erasing.current?.shown ?? history.current.board;
    const { page } = current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = DESK;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio * z, 0, 0, ratio * z, -x * z * ratio, -y * z * ratio);
    const bottom = y + h / z;
    const top = Math.max(page.top, y);
    context.fillStyle = '#ffffff';
    context.fillRect(page.left, top, page.width, Math.max(0, bottom - top));
    context.strokeStyle = '#9ca3af';
    context.lineWidth = 1 / z;
    context.strokeRect(page.left, page.top, page.width, Math.max(0, bottom - page.top + 2 / z));
    const lines = paperRef.current;
    if (lines !== 'blank') {
      const gap = lines === 'grid' ? GRID_SPACING : LINE_SPACING;
      if (gap * z >= 8) {
        context.strokeStyle = PAPER_LINE;
        context.beginPath();
        for (let line = Math.ceil(top / gap) * gap; line <= bottom; line += gap) {
          context.moveTo(page.left, line);
          context.lineTo(page.left + page.width, line);
        }
        if (lines === 'grid') {
          for (let line = Math.ceil(page.left / gap) * gap; line <= page.left + page.width; line += gap) {
            context.moveTo(line, top);
            context.lineTo(line, bottom);
          }
        }
        context.stroke();
      }
    }
    const area = { minX: x, minY: y, maxX: x + w / z, maxY: bottom };
    // Only what is in view; the index was built from the board, and erasing only removes strokes.
    const visible = index.current.query(area);
    drawBoard(context, {
      ...current,
      strokes: current.strokes.filter((stroke) => visible.has(stroke.id)),
      images: current.images.filter((image) => visible.has(image.id)),
    }, loaded());
    container.current?.setAttribute('data-zoom', String(Math.round((z / fitZoom(page, view.current)) * 100) / 100));
  }, [loaded]);

  const repaint = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  /** Starts loading the board's pictures; resolves when all have loaded (or failed). */
  const loadPictures = useCallback((current: BoardInk) => {
    const waits: Promise<void>[] = [];
    for (const image of current.images) {
      const known = pictures.current.get(image.id);
      if (known?.src === image.src) { waits.push(known.ready); continue; }
      const entry: { src: string; image: HTMLImageElement | null; ready: Promise<void> } = { src: image.src, image: null, ready: Promise.resolve() };
      entry.ready = loadPicture(image.src).then((picture) => { entry.image = picture; repaint(); }, () => undefined);
      pictures.current.set(image.id, entry);
      waits.push(entry.ready);
    }
    return Promise.all(waits).then(() => undefined);
  }, [repaint]);

  const mirror = useCallback(() => {
    mirrorTimer.current = undefined;
    const current = board();
    dispatch({ type: 'INK_CHANGED', ink: current, hasContent: current.strokes.length > 0 || current.images.length > 0 });
  }, [dispatch]);

  /** After the board changed: index, pictures, a redraw, the app's copy, the toolbar. */
  const changed = useCallback(() => {
    inkRevision += 1;
    index.current.update(board());
    void loadPictures(board());
    container.current?.setAttribute('data-strokes', String(board().strokes.length));
    container.current?.setAttribute('data-images', String(board().images.length));
    clearTimeout(mirrorTimer.current);
    mirrorTimer.current = setTimeout(mirror, MIRROR_DELAY_MS);
    repaint();
    showSteps();
  }, [loadPictures, mirror, repaint]);

  const apply = useCallback((next: BoardInk) => {
    const before = history.current;
    history.current = commit(before, next);
    if (history.current !== before) changed();
  }, [changed]);

  const setCamera = useCallback((next: Camera) => {
    camera.current = clampCamera(next, board().page, view.current);
    repaint();
  }, [repaint]);

  /** Writing scale with the board's `top` (board units) at the top of the view. */
  const fitTo = useCallback((top: number) => {
    fitted.current = true;
    camera.current = fitCamera(board().page, view.current, top);
    repaint();
  }, [repaint]);

  /** Opens a board: the first work near the top of the view, at writing scale. */
  const open = useCallback((next: BoardInk) => {
    history.current = startHistory(next);
    index.current = new GridIndex();
    pictures.current.clear();
    erasing.current = null;
    writing.current = null;
    setTool('pen');
    setSize('s');
    const content = boardBounds(next);
    const z = fitZoom(next.page, view.current);
    placed.current = view.current.w > 0;
    fitTo(content ? content.minY - OPEN_TOP / z : next.page.top - VIEW_MARGIN / z);
    inkRevision += 1;
    index.current.update(next);
    void loadPictures(next);
    container.current?.setAttribute('data-strokes', String(next.strokes.length));
    container.current?.setAttribute('data-images', String(next.images.length));
    showSteps();
  }, [fitTo, loadPictures]);

  useEffect(() => {
    loadPending.current = Boolean(pendingLoad);
    if (pendingLoad) loads.current += 1;
  }, [pendingLoad]);

  // The board shown on mount, then each board the app loads.
  useEffect(() => { open(history.current.board); }, [open]);
  useEffect(() => {
    if (!pendingLoad) return;
    const next = pendingLoad.ink ?? emptyBoard();
    // Loading resets the tools and undo, which the toolbar shows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    open(next);
    dispatch({ type: 'LOADED', document: null, ink: next, hasContent: next.strokes.length > 0 || next.images.length > 0 });
  }, [pendingLoad, open, dispatch]);

  useEffect(() => {
    paperRef.current = paper;
    repaint();
  }, [paper, repaint]);

  // Follow the view's size; at writing scale it stays there, a close-up keeps its zoom.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      // A hidden board (the Shelf's narrow-screen swap) keeps its view for when it shows again.
      if (width === 0 || height === 0) return;
      const wasFit = fitted.current || !placed.current;
      view.current = { w: width, h: height };
      for (const canvas of [inkCanvas.current, liveCanvas.current]) {
        if (canvas) { canvas.style.width = `${width}px`; canvas.style.height = `${height}px`; }
      }
      if (!placed.current) {
        placed.current = true;
        const content = boardBounds(board());
        const z = fitZoom(board().page, view.current);
        fitTo(content ? content.minY - OPEN_TOP / z : board().page.top - VIEW_MARGIN / z);
      } else if (wasFit) fitTo(camera.current.y);
      else setCamera(camera.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitTo, setCamera]);

  // Leaving the page mirrors the last change right away, so it is saved.
  useEffect(() => () => {
    if (mirrorTimer.current) { clearTimeout(mirrorTimer.current); mirror(); }
    cancelAnimationFrame(frame.current);
  }, [mirror]);

  const doUndo = useCallback(() => {
    const before = history.current;
    history.current = undo(before);
    if (history.current !== before) changed();
  }, [changed]);
  const doRedo = useCallback(() => {
    const before = history.current;
    history.current = redo(before);
    if (history.current !== before) changed();
  }, [changed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || typing(event.target) || !container.current?.offsetParent) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); doUndo(); }
      else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); doRedo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo]);

  // The stroke being written, drawn whole on the live canvas at each move.
  const paintLive = useCallback(() => {
    const canvas = liveCanvas.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const { w, h } = view.current;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    const stroke = writing.current?.stroke;
    if (!stroke) return;
    const { x, y, z } = camera.current;
    context.setTransform(ratio * z, 0, 0, ratio * z, -x * z * ratio, -y * z * ratio);
    drawBoardStroke(context, stroke);
  }, []);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = liveCanvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Pen and mouse write (the pen's eraser end, or the Eraser tool, erases); fingers scroll and pinch.
  useEffect(() => {
    const canvas = liveCanvas.current;
    if (!canvas) return;
    let pinch: { distance: number; mid: { x: number; y: number } } | null = null;
    let lastTouch: { x: number; y: number } | null = null;

    const eraseAlong = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const pass = erasing.current;
      if (!pass) return;
      pass.path.push(to.x, to.y);
      const hit = strokesHitByPath(pass.before, index.current, [from.x, from.y, to.x, to.y], ERASER_REACH / camera.current.z);
      if (hit.size === 0) return;
      const next = removeItems(pass.shown, hit);
      if (next !== pass.shown) { pass.shown = next; repaint(); }
    };

    const touchState = () => {
      const points = [...touches.current.values()];
      if (points.length >= 2) {
        const [a, b] = points;
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
        lastTouch = null;
      } else {
        pinch = null;
        lastTouch = points[0] ?? null;
      }
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        // A palm resting while the pen writes does nothing.
        if (writing.current || erasing.current) return;
        touches.current.set(event.pointerId, local(event));
        canvas.setPointerCapture(event.pointerId);
        touchState();
        return;
      }
      if (event.button !== 0 && event.button !== 5) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const at = toBoard(camera.current, local(event).x, local(event).y);
      // Button 5 / bit 32: the pen's eraser end.
      const eraser = event.button === 5 || (event.buttons & 32) !== 0 || style.current.tool === 'eraser';
      if (eraser) {
        erasing.current = { before: board(), shown: board(), path: [at.x, at.y] };
        eraseAlong(at, at);
        return;
      }
      const { tool: chosen, size: penSize, color: ink } = style.current;
      const highlighter = chosen === 'highlighter';
      const points: number[] = [];
      pushPoint(points, at.x, at.y, event.pressure);
      writing.current = {
        pointer: event.pointerId,
        stroke: { id: uuidv4(), tool: highlighter ? 'highlighter' : 'pen', color: ink, width: highlighter ? HIGHLIGHTER_WIDTH : PEN_WIDTHS[penSize], points },
        lastX: at.x, lastY: at.y,
      };
      paintLive();
    };

    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        if (!touches.current.has(event.pointerId)) return;
        touches.current.set(event.pointerId, local(event));
        const points = [...touches.current.values()];
        if (pinch && points.length >= 2) {
          const [a, b] = points;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          fitted.current = false;
          const zoomed = zoomAbout(camera.current, distance / pinch.distance, mid, board().page, view.current);
          setCamera({ ...zoomed, x: zoomed.x - (mid.x - pinch.mid.x) / zoomed.z, y: zoomed.y - (mid.y - pinch.mid.y) / zoomed.z });
          pinch = { distance, mid };
        } else if (lastTouch) {
          const at = local(event);
          setCamera({ ...camera.current, x: camera.current.x - (at.x - lastTouch.x) / camera.current.z, y: camera.current.y - (at.y - lastTouch.y) / camera.current.z });
          lastTouch = at;
        }
        return;
      }
      const samples = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
      if (erasing.current) {
        for (const sample of samples) {
          const path = erasing.current.path;
          const from = { x: path[path.length - 2], y: path[path.length - 1] };
          eraseAlong(from, toBoard(camera.current, local(sample).x, local(sample).y));
        }
        return;
      }
      const current = writing.current;
      if (!current || current.pointer !== event.pointerId) return;
      // Samples closer than a screen pixel add nothing but weight.
      const step = 1 / camera.current.z;
      for (const sample of samples) {
        const at = toBoard(camera.current, local(sample).x, local(sample).y);
        if (Math.hypot(at.x - current.lastX, at.y - current.lastY) < step) continue;
        pushPoint(current.stroke.points, at.x, at.y, sample.pressure);
        current.lastX = at.x;
        current.lastY = at.y;
      }
      paintLive();
    };

    const up = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touches.current.delete(event.pointerId);
        touchState();
        return;
      }
      if (erasing.current) {
        const pass = erasing.current;
        erasing.current = null;
        if (event.type === 'pointercancel') { repaint(); return; }
        if (pass.shown !== pass.before) apply(pass.shown);
        else repaint();
        return;
      }
      const current = writing.current;
      if (!current || current.pointer !== event.pointerId) return;
      writing.current = null;
      paintLive();
      if (event.type !== 'pointercancel') apply(addItems(board(), [current.stroke]));
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = local(event);
      if (event.ctrlKey || event.metaKey) {
        fitted.current = false;
        setCamera(zoomAbout(camera.current, Math.exp(-event.deltaY * 0.002), at, board().page, view.current));
        return;
      }
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.current.h : 1;
      setCamera({ ...camera.current, x: camera.current.x + (event.deltaX * scale) / camera.current.z, y: camera.current.y + (event.deltaY * scale) / camera.current.z });
    };

    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [apply, paintLive, repaint, setCamera]);

  useImperativeHandle(handleRef, () => ({
    fitWidth: () => fitTo(camera.current.y),
    captureForTutor: async () => {
      if (loadPending.current) throw new Error('The board is still loading. Please try again.');
      const load = loads.current;
      const revision = inkRevision;
      const current = board();
      await loadPictures(current);
      if (loads.current !== load || loadPending.current || inkRevision !== revision) throw new Error('The board changed during capture');
      try {
        return tutorImages(current, loaded(), null);
      } catch (error) {
        // Too many close-ups asks for a selection; anything else is a failed picture.
        if (error instanceof Error && error.message.includes('close-ups')) throw error;
        throw new Error('The board image could not be captured. Please try again, or select a smaller part of your work.');
      }
    },
    captureImage: async () => {
      const current = board();
      await loadPictures(current);
      const picture = renderItems(current, loaded(), null, TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE, 2);
      return picture ? picture.canvas.toDataURL('image/png').split(',')[1] ?? '' : '';
    },
    captureThumbnail: async () => {
      const current = board();
      await loadPictures(current);
      const picture = renderItems(current, loaded(), null, TUTOR_IMAGE_PADDING, THUMBNAIL_SIDE, 1);
      return picture ? canvasBlob(picture.canvas, 'image/png') : null;
    },
    exportImage: async (format) => {
      const current = board();
      await loadPictures(current);
      const picture = renderItems(current, loaded(), null, EXPORT_PADDING, MAX_EXPORT_SIDE, 2);
      if (!picture) return null;
      const blob = await canvasBlob(picture.canvas, format === 'png' ? 'image/png' : 'image/jpeg', 0.92);
      return blob ? { blob, pixelRatio: picture.scale } : null;
    },
    placeProblemImage: async (base64, key = true) => {
      if (loadPending.current) return false;
      const load = loads.current;
      const existing = problemImage(board(), key);
      if (existing) {
        fitTo(existing.y - PROBLEM_MARGIN);
        return false;
      }
      const src = `data:image/png;base64,${base64}`;
      const picture = await loadPicture(src);
      // A second tap while the picture loaded may have placed it, or another board may have opened.
      if (problemImage(board(), key) || loads.current !== load || loadPending.current) return false;
      const current = board();
      const { page } = current;
      // Crops are rendered at twice their page size; never wider than the page less its margins.
      const scale = Math.min(0.5, (page.width - PROBLEM_MARGIN * 2) / picture.naturalWidth);
      const w = picture.naturalWidth * scale;
      const h = picture.naturalHeight * scale;
      const content = boardBounds(current);
      const y = !content ? camera.current.y + PROBLEM_TOP / camera.current.z
        : key === true ? content.minY - h - PROBLEM_MARGIN : content.maxY + PROBLEM_MARGIN * 2;
      const image: BoardImage = { id: uuidv4(), x: page.left + PROBLEM_MARGIN, y, w, h, src, problem: key };
      pictures.current.set(image.id, { src, image: picture, ready: Promise.resolve() });
      apply(addItems(current, [], [image]));
      fitTo(y - PROBLEM_TOP / fitZoom(board().page, view.current));
      setTool('pen');
      return true;
    },
    getRevision: () => inkRevision,
    getDocument: () => null,
    getInk: () => (loadPending.current ? null : board()),
    // Clear leaves the problem picture, as it is locked.
    clear: () => apply(removeItems(board(), new Set([...board().strokes.map((stroke) => stroke.id), ...board().images.filter((image) => !image.problem).map((image) => image.id)]))),
  }), [apply, fitTo, loadPictures, loaded]);

  const button = 'flex items-center justify-center min-h-11 min-w-11 px-2 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40';
  const pressed = (on: boolean) => `${button} ${on ? 'border-2 border-gray-900 font-semibold text-gray-900' : 'border-gray-300 text-gray-800'}`;

  return (
    <div ref={container} className="absolute inset-0 overflow-hidden" data-ink-board="true" data-strokes="0" data-images="0">
      <canvas ref={inkCanvas} className="absolute inset-0" aria-hidden="true" />
      <canvas
        ref={liveCanvas}
        className={`absolute inset-0 touch-none ${tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
        role="img"
        aria-label="Ink board"
        data-testid="ink-board"
      />
      {!toolsHidden && (
        <div role="toolbar" aria-label="Ink tools" className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
          <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm">
            <button className={pressed(tool === 'pen')} aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>Pen</button>
            <button className={pressed(tool === 'highlighter')} aria-pressed={tool === 'highlighter'} onClick={() => setTool('highlighter')}>Highlight</button>
            <button className={pressed(tool === 'eraser')} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
          </div>
          {tool === 'pen' && (
            <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm" role="group" aria-label="Pen size">
              {(Object.keys(PEN_WIDTHS) as PenSize[]).map((value) => (
                <button key={value} className={pressed(size === value)} aria-pressed={size === value} aria-label={`Size ${value.toUpperCase()}`} onClick={() => setSize(value)}>
                  <span className="rounded-full bg-gray-900" style={{ width: PEN_WIDTHS[value] * 1.6, height: PEN_WIDTHS[value] * 1.6 }} />
                </button>
              ))}
            </div>
          )}
          {tool !== 'eraser' && (
            <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm" role="group" aria-label="Ink color">
              {COLORS.map((value) => (
                <button key={value} className={pressed(color === value)} aria-pressed={color === value} aria-label={value[0].toUpperCase() + value.slice(1)} title={value[0].toUpperCase() + value.slice(1)} onClick={() => setColor(value)}>
                  <span className="w-5 h-5 rounded-full" style={{ background: INK_COLORS[value] }} />
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm">
            <button className={pressed(false)} disabled={!steps.undo} onClick={doUndo}>Undo</button>
            <button className={pressed(false)} disabled={!steps.redo} onClick={doRedo}>Redo</button>
          </div>
        </div>
      )}
    </div>
  );
}

