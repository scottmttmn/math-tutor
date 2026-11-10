'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasDispatch, useCanvasState } from '@/context/CanvasContext';
import { GRID_SPACING, LINE_SPACING, PAPER_LINE } from '@/lib/paper';
import { HIGHLIGHTER_WIDTH, HIGHLIGHT_ALPHA, INK_COLORS, PEN_WIDTHS, boardBounds, emptyBoard, imageBounds, overlaps, pageAt, pageSpan, paginate, pushPoint, strokeBounds, type PenSize } from '@/lib/inkBoard/model';
import { addItems, commit, copyItems, moveItems, redo, removeItems, scaleItems, startHistory, undo, type BoardHistory } from '@/lib/inkBoard/edits';
import { GridIndex, itemsInLasso, strokesHitByPath } from '@/lib/inkBoard/hitTest';
import { scratchedOut } from '@/lib/inkBoard/scratchOut';
import { useScratchOutOff } from '@/hooks/useInkBoardChoice';
import { drawBoard, drawBoardStroke } from '@/lib/inkBoard/render';
import { EXPORT_PADDING, MAX_EXPORT_SIDE, THUMBNAIL_SIDE, problemImage, renderItems, tutorImages } from '@/lib/inkBoard/capture';
import { VIEW_MARGIN, clampCamera, fitCamera, fitZoom, toBoard, zoomAbout, type Camera, type ViewSize } from '@/lib/inkBoard/camera';
import { TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE } from '@/lib/tutorBoardImages';
import { strokePoints, sweep } from '@/lib/booxPen';
import { useBooxInk } from '@/hooks/useBooxInk';
import { imageFileToPng } from '@/lib/pdf';
import { MAX_BOARD_PICTURE } from '@/lib/shelf';
import { copyPicture } from '@/lib/copiedPicture';
import { pasteCopiedPicture } from '@/lib/boardPicture';
import { useBoardRail } from '@/components/layout/BoardRail';
import { ChevronIcon, CopyIcon, EraserIcon, NewPageIcon, FitWidthIcon, HighlightIcon, LassoIcon, PenIcon, RedoIcon, TrashIcon, UndoIcon } from '@/components/common/Icons';
import type { BoardImage, BoardInk, BoardStroke, InkColor, Paper, SelectionAsk } from '@/types';
import { askQuestion, selectionChoices } from '@/lib/tutorAsk';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import type { DrawingCanvasHandle } from './DrawingCanvas';

// The ink board: our own Notes-like canvas (it replaced tldraw). One long page of fixed width; the
// pen or mouse writes, two fingers scroll and pinch (one does nothing), the wheel scrolls (with Ctrl, zooms). The drawing
// is plain 2D canvas: finished ink on one canvas, the stroke being written on another above it.
// On a BOOX tablet Onyx's pen SDK draws the pen tool's strokes and hands them over (useBooxInk).
// The lasso circles ink to select it: drag it to move it, or delete or duplicate it; the tutor
// then reads only the selection.

type Tool = 'pen' | 'highlighter' | 'eraser' | 'lasso';

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
// Palm rejection: a touch that lands this soon after the pen was near or on the screen, or one this
// wide (CSS px; a fingertip is about 20), is a resting hand, not a scroll.
const PALM_GRACE_MS = 800;
const PALM_SIZE = 48;
// Two fingers pinch only when the second lands this soon after the first (a palm settles contact by
// contact), and zoom only once their spread has changed by this fraction (a resting hand drifts).
// Once they have moved together this far (CSS px) more than they spread, the gesture is a scroll
// and stays one: fingers drifting apart over a long scroll zoomed it (Go 10.3, 2026-11-05).
const PINCH_WINDOW_MS = 250;
const PINCH_START = 0.15;
const SCROLL_LOCK = 24;
// The selection's box sits this far outside its ink, in screen px; a duplicate lands this far off, in board units.
const SELECTION_PAD = 8;
// The resize handle at the selection box's bottom right corner: drawn this big, taken within this reach (screen px).
const HANDLE_SIZE = 14;
/** Screen px between the selection menu and the board's edges (or the selection above it). */
const MENU_GAP = 8;
const HANDLE_REACH = 26;
// A resized selection stays at least this big along its box's width plus height (board units), and at most this many times larger.
const MIN_RESIZE = 16;
const MAX_RESIZE = 8;
// The lasso's loop as Onyx's pen draws it on a BOOX: thin and gray.
const LASSO_PREVIEW = { width: 1.5, color: '#6b7280', marker: false, dash: true };
const DUPLICATE_OFFSET = 24;
// Room above the first work when a board opens, in screen px.
const OPEN_TOP = 80;
const COLORS: InkColor[] = ['black', 'gray', 'blue', 'red', 'green'];
const DESK = '#e5e7eb';

/** The selection box's resize handle: a filled square on its bottom right corner (the box padded by SELECTION_PAD). */
function drawHandle(context: CanvasRenderingContext2D, box: { maxX: number; maxY: number }, z: number) {
  const pad = SELECTION_PAD / z;
  const size = HANDLE_SIZE / z;
  context.setLineDash([]);
  context.fillStyle = '#111827';
  context.fillRect(box.maxX + pad - size / 2, box.maxY + pad - size / 2, size, size);
  context.strokeStyle = '#ffffff';
  context.lineWidth = 1.5 / z;
  context.strokeRect(box.maxX + pad - size / 2, box.maxY + pad - size / 2, size, size);
}

function loadPicture(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image could not be read'));
    image.src = src;
  });
}

/** A highlight's look on white (its ink at HIGHLIGHT_ALPHA), for the BOOX pen's opaque preview. */
function highlightPreview(hex: string): string {
  const channel = (at: number) => Math.round(parseInt(hex.slice(at, at + 2), 16) * HIGHLIGHT_ALPHA + 255 * (1 - HIGHLIGHT_ALPHA));
  return `#${[1, 3, 5].map((at) => channel(at).toString(16).padStart(2, '0')).join('')}`;
}

const canvasBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** Typing in a field, not drawing: board shortcuts leave it alone. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** The items on page `index` of a paged board (anything reaching onto it). */
function onPage(current: BoardInk, index: number): Set<string> {
  const { top, bottom } = pageSpan(current.page, index);
  const sheet = { minX: -Infinity, maxX: Infinity, minY: top, maxY: bottom };
  return new Set([
    ...current.strokes.filter((stroke) => overlaps(strokeBounds(stroke), sheet)).map((stroke) => stroke.id),
    ...current.images.filter((image) => overlaps(imageBounds(image), sheet)).map((image) => image.id),
  ]);
}

/** What a capture pictures: the lasso's selection still on the board, else the page in view on a paged board, else null for the whole board. */
function selectedIds(current: BoardInk, selection: ReadonlySet<string>, page: number): Set<string> | null {
  const ids = new Set([...current.strokes, ...current.images].map((item) => item.id).filter((id) => selection.has(id)));
  if (ids.size > 0) return ids;
  return current.page.pages ? onPage(current, page) : null;
}

export default function InkBoard({ handleRef, toolsHidden, paper, ask, paged = false }: { handleRef: RefObject<DrawingCanvasHandle | null>; toolsHidden: boolean; paper: Paper; ask?: SelectionAsk; paged?: boolean }) {
  const { ink: mirrored, pendingLoad } = useCanvasState();
  const dispatch = useCanvasDispatch();
  const container = useRef<HTMLDivElement>(null);
  const inkCanvas = useRef<HTMLCanvasElement>(null);
  const liveCanvas = useRef<HTMLCanvasElement>(null);
  // Over the lasso's selection, for a BOOX: Onyx's pen leaves it to the page, which drags it.
  const selectionArea = useRef<HTMLDivElement>(null);
  // Over its resize handle's reach, likewise left to the page.
  const handleArea = useRef<HTMLDivElement>(null);
  // The selection's menu (tutor, Delete, Copy, Done), placed under the selection, or above it near the foot.
  const selectionMenu = useRef<HTMLDivElement>(null);
  // Undo/redo availability for the toolbar; the ink itself is drawn directly, without re-rendering.
  const [steps, setSteps] = useState({ undo: false, redo: false });
  const [tool, setTool] = useState<Tool>('pen');
  const [size, setSize] = useState<PenSize>('s');
  const [color, setColor] = useState<InkColor>('black');
  // The pen's or highlighter's sizes and inks, opened from its button in the rail; writing closes them.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const rail = useBoardRail();
  // How many items the lasso holds, for its toolbar (the ids live in `selection`).
  const [selected, setSelected] = useState(0);
  // The zoom, for the BOOX pen's preview width (the camera itself lives in a ref).
  const [zoom, setZoom] = useState(1);
  // Zoomed in or out from writing scale: the rail then offers Fit width.
  const [zoomedAway, setZoomedAway] = useState(false);
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
  // Notes boards are cut into pages, shown one at a time (BoardPage.pages); which one is in view.
  const pagedRef = useRef(paged);
  const pageIndex = useRef(0);
  const [pageInfo, setPageInfo] = useState<{ index: number; count: number } | null>(null);
  // A pass of the eraser shows its result before it becomes one undo step.
  const erasing = useRef<{ before: BoardInk; shown: BoardInk; path: number[] } | null>(null);
  const writing = useRef<{ pointer: number; stroke: BoardStroke; lastX: number; lastY: number } | null>(null);
  // The lasso: what it holds, the loop being drawn, and a drag of the selection (shown before it becomes one undo step).
  const selection = useRef<Set<string>>(new Set());
  const lassoing = useRef<{ pointer: number; path: number[] } | null>(null);
  // A drag of the selection: moved by (dx, dy), or, from its corner handle, scaled by `factor` about
  // the box's top left (`scale`: that corner and the box's width plus height).
  const moving = useRef<{ pointer: number; fromX: number; fromY: number; dx: number; dy: number; factor: number; scale?: { x: number; y: number; size: number } } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  // When the pen was last near or on the screen (hovering, writing, or a BOOX stroke arriving).
  const penSeen = useRef(-Infinity);
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef(0);
  // On a BOOX, a gesture's frames are spaced out (frameGap): when the last one was painted, and the wait for the next.
  const lastPaint = useRef(0);
  const paced = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The board as the drag would leave it: the selection moved, or resized from its corner.
  const dragged = (current: BoardInk, drag: NonNullable<typeof moving.current>) => (drag.scale
    ? scaleItems(current, selection.current, drag.scale.x, drag.scale.y, drag.factor)
    : moveItems(current, selection.current, drag.dx, drag.dy));
  // The lasso's loop and a dragged selection are drawn on the live canvas, paced the same way;
  // `liveDrag` says it holds a dragged selection, cleared once the board under it is painted again.
  const liveFrame = useRef(0);
  const livePaced = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastLive = useRef(0);
  const liveDrag = useRef(false);

  // Strokes and eraser passes the BOOX pen hands over (set below, once the edits exist).
  const fromBoox = useRef({ stroke: (flat: number[]) => void flat, erase: (flat: number[]) => void flat });
  const onBooxStroke = useCallback((flat: number[]) => { setOptionsOpen(false); fromBoox.current.stroke(flat); }, []);
  const onBooxErase = useCallback((flat: number[]) => fromBoox.current.erase(flat), []);
  const { owns: booxOwns, painted, gesture, frameGap, hold: holdPen } = useBooxInk({
    container,
    // The lasso's loop is the SDK's too, drawn at once as the pen's is; its selection is the page's.
    sdk: tool === 'pen' || tool === 'highlighter' || tool === 'lasso',
    preview: tool === 'lasso' ? LASSO_PREVIEW : tool === 'highlighter'
      ? { width: HIGHLIGHTER_WIDTH * zoom, color: highlightPreview(INK_COLORS[color]), marker: true }
      : { width: PEN_WIDTHS[size] * zoom, color: INK_COLORS[color], marker: false },
    onStroke: onBooxStroke,
    onErase: onBooxErase,
  });

  const board = () => history.current.board;
  /** The page in view on a paged board (kept within its pages), else undefined: the view may go anywhere below the top. */
  const span = () => {
    const { page } = history.current.board;
    if (!page.pages) return undefined;
    pageIndex.current = Math.min(page.pages - 1, Math.max(0, pageIndex.current));
    return pageSpan(page, pageIndex.current);
  };
  const showSteps = () => setSteps({ undo: history.current.past.length > 0, redo: history.current.future.length > 0 });

  const loaded = useCallback(() => {
    const map = new Map<string, CanvasImageSource>();
    for (const [id, entry] of pictures.current) if (entry.image) map.set(id, entry.image);
    return map;
  }, []);

  const paint = useCallback(() => {
    frame.current = 0;
    lastPaint.current = performance.now();
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
    const drag = moving.current;
    // A dragged selection is left out here and drawn moving on the live canvas, so a drag repaints only it.
    const current = erasing.current?.shown ?? (drag ? removeItems(history.current.board, selection.current) : history.current.board);
    const { page } = current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = DESK;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio * z, 0, 0, ratio * z, -x * z * ratio, -y * z * ratio);
    const sheet = span();
    const bottom = sheet ? Math.min(y + h / z, sheet.bottom) : y + h / z;
    const top = Math.max(sheet ? sheet.top : page.top, y);
    context.fillStyle = '#ffffff';
    context.fillRect(page.left, top, page.width, Math.max(0, bottom - top));
    context.strokeStyle = '#9ca3af';
    context.lineWidth = 1 / z;
    if (sheet) context.strokeRect(page.left, sheet.top, page.width, sheet.bottom - sheet.top);
    else context.strokeRect(page.left, page.top, page.width, Math.max(0, bottom - page.top + 2 / z));
    const lines = paperRef.current;
    if (lines !== 'blank') {
      const gap = lines === 'grid' ? GRID_SPACING : LINE_SPACING;
      if (gap * z >= 8) {
        context.strokeStyle = PAPER_LINE;
        context.beginPath();
        // A page's lines start from its own top; one long page keeps them where they always were.
        const origin = sheet ? sheet.top : 0;
        for (let line = origin + Math.ceil((top - origin) / gap) * gap; line <= bottom; line += gap) {
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
    const shown = (id: string) => visible.has(id);
    // On a page, work running past its edge shows only on the page it was written on.
    context.save();
    if (sheet) {
      context.beginPath();
      context.rect(page.left - page.width, sheet.top, page.width * 3, sheet.bottom - sheet.top);
      context.clip();
    }
    drawBoard(context, {
      ...current,
      strokes: current.strokes.filter((stroke) => shown(stroke.id)),
      images: current.images.filter((image) => shown(image.id)),
    }, loaded());
    context.restore();
    const box = !drag && selection.current.size > 0 ? boardBounds(current, selection.current) : null;
    // The page's hit areas exactly (inSelection, onHandle), so Onyx's pen leaves both to the page and nothing else.
    const place = (element: HTMLDivElement | null, area: { left: number; top: number; width: number; height: number } | null) => {
      if (element) Object.assign(element.style, area ? { left: `${area.left}px`, top: `${area.top}px`, width: `${area.width}px`, height: `${area.height}px` } : { width: '0px', height: '0px' });
    };
    const pad = SELECTION_PAD / z;
    place(selectionArea.current, box && { left: (box.minX - pad - x) * z, top: (box.minY - pad - y) * z, width: (box.maxX - box.minX + pad * 2) * z, height: (box.maxY - box.minY + pad * 2) * z });
    place(handleArea.current, box && { left: (box.maxX + pad - x) * z - HANDLE_REACH, top: (box.maxY + pad - y) * z - HANDLE_REACH, width: HANDLE_REACH * 2, height: HANDLE_REACH * 2 });
    const menu = selectionMenu.current;
    if (menu) {
      if (!box) menu.style.visibility = 'hidden';
      else {
        const menuW = menu.offsetWidth;
        const menuH = menu.offsetHeight;
        const left = Math.min(Math.max(MENU_GAP, (box.minX - pad - x) * z), w - menuW - MENU_GAP);
        const below = (box.maxY + pad - y) * z + HANDLE_REACH;
        const above = (box.minY - pad - y) * z - menuH - MENU_GAP;
        const top = below + menuH + MENU_GAP <= h || above < MENU_GAP ? Math.min(below, h - menuH - MENU_GAP) : above;
        Object.assign(menu.style, { left: `${Math.max(MENU_GAP, left)}px`, top: `${Math.max(MENU_GAP, top)}px`, visibility: 'visible' });
      }
    }
    if (box) {
      context.save();
      context.strokeStyle = '#111827';
      context.lineWidth = 1.5 / z;
      context.setLineDash([6 / z, 4 / z]);
      context.strokeRect(box.minX - pad, box.minY - pad, box.maxX - box.minX + pad * 2, box.maxY - box.minY + pad * 2);
      drawHandle(context, box, z);
      context.restore();
    }
    // The drag has landed: the selection is on the board again, so the live canvas lets it go.
    if (!drag && liveDrag.current) {
      liveDrag.current = false;
      const live = liveCanvas.current;
      live?.getContext('2d')?.clearRect(0, 0, live.width, live.height);
    }
    const scale = z / fitZoom(page, view.current);
    container.current?.setAttribute('data-zoom', String(Math.round(scale * 100) / 100));
    setZoomedAway(Math.abs(scale - 1) > 0.01);
    container.current?.setAttribute('data-view-y', String(Math.round(y)));
    if (page.pages) {
      container.current?.setAttribute('data-page', String(pageIndex.current + 1));
      container.current?.setAttribute('data-pages', String(page.pages));
    } else {
      container.current?.removeAttribute('data-page');
      container.current?.removeAttribute('data-pages');
    }
    const info = page.pages ? { index: pageIndex.current, count: page.pages } : null;
    setPageInfo((last) => (last?.index === info?.index && last?.count === info?.count ? last : info));
    setZoom(z);
    painted();
  }, [loaded, painted]);

  const repaint = useCallback(() => {
    if (frame.current || paced.current) return;
    const wait = lastPaint.current + frameGap() - performance.now();
    if (wait <= 0) { frame.current = requestAnimationFrame(paint); return; }
    paced.current = setTimeout(() => {
      paced.current = undefined;
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    }, wait);
  }, [paint, frameGap]);

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

  // A finished pen stroke is ink, unless it scribbles out ink under it (scratch out to erase).
  const [scratchOff] = useScratchOutOff();
  const scratchOn = useRef(true);
  useEffect(() => { scratchOn.current = !scratchOff; }, [scratchOff]);
  const addStroke = useCallback((stroke: BoardStroke) => {
    if (scratchOn.current && stroke.tool === 'pen') {
      const taken = scratchedOut(board(), index.current, stroke.points, ERASER_REACH / camera.current.z);
      if (taken.size > 0) { apply(removeItems(board(), taken)); return; }
    }
    apply(addItems(board(), [stroke]));
  }, [apply]);

  const setCamera = useCallback((next: Camera) => {
    camera.current = clampCamera(next, board().page, view.current, span());
    repaint();
  }, [repaint]);

  const select = useCallback((ids: Set<string>) => {
    if (ids.size === 0 && selection.current.size === 0) return;
    selection.current = ids;
    moving.current = null;
    holdPen(false);
    setSelected(ids.size);
    container.current?.setAttribute('data-selected', String(ids.size));
    repaint();
  }, [repaint, holdPen]);

  /** A tool chosen; leaving the lasso lets go of its selection. */
  const chooseTool = useCallback((next: Tool) => {
    if (next !== 'lasso') select(new Set());
    setTool(next);
  }, [select]);

  const deleteSelection = useCallback(() => {
    if (selection.current.size === 0) return;
    const ids = selection.current;
    select(new Set());
    apply(removeItems(board(), ids));
  }, [apply, select]);

  const duplicateSelection = useCallback(() => {
    if (selection.current.size === 0) return;
    const copy = copyItems(board(), selection.current, DUPLICATE_OFFSET, DUPLICATE_OFFSET, uuidv4);
    apply(copy.board);
    select(copy.ids);
  }, [apply, select]);

  /** Copy (Ctrl+C): the selection's ink and pictures onto the app's clipboard, for Paste on any board; false when it failed. */
  const copySelection = useCallback(async (): Promise<boolean> => {
    const ids = selection.current;
    const current = board();
    const ink = { strokes: current.strokes.filter((stroke) => ids.has(stroke.id)), images: current.images.filter((image) => ids.has(image.id) && !image.problem) };
    const items = ink.strokes.length + ink.images.length;
    if (items === 0) return false;
    try {
      await copyPicture({ ink, from: `${items} item${items === 1 ? '' : 's'} from a board`, copiedAt: Date.now() });
      return true;
    } catch (error) {
      console.error('Could not copy the selection', error);
      return false;
    }
  }, []);

  /** Cut (Ctrl+X): the selection goes only once it is safely on the clipboard. */
  const cutSelection = useCallback(async () => {
    const ids = selection.current;
    if (ids.size === 0 || !(await copySelection())) return;
    if (selection.current === ids) select(new Set());
    apply(removeItems(board(), ids));
  }, [apply, copySelection, select]);

  // A finished BOOX stroke becomes ink in the pen's style; an eraser pass takes the strokes it crossed.
  useEffect(() => {
    const local = (x: number, y: number) => {
      const rect = liveCanvas.current?.getBoundingClientRect();
      return toBoard(camera.current, x - (rect?.left ?? 0), y - (rect?.top ?? 0));
    };
    fromBoox.current = {
      stroke: (flat) => {
        penSeen.current = performance.now();
        const samples = strokePoints(flat);
        if (samples.length === 0 || loadPending.current) return;
        const { tool: chosen, size: penSize, color: ink } = style.current;
        if (chosen === 'lasso') {
          select(itemsInLasso(board(), index.current, samples.flatMap(({ x, y }) => {
            const at = local(x, y);
            return [at.x, at.y];
          })));
          painted();
          return;
        }
        const highlighter = chosen === 'highlighter';
        const step = 1 / camera.current.z;
        const points: number[] = [];
        let last: { x: number; y: number } | null = null;
        for (const sample of samples) {
          const at = local(sample.x, sample.y);
          if (last && Math.hypot(at.x - last.x, at.y - last.y) < step) continue;
          pushPoint(points, at.x, at.y, sample.pressure);
          last = at;
        }
        addStroke({ id: uuidv4(), tool: highlighter ? 'highlighter' : 'pen', color: ink, width: highlighter ? HIGHLIGHTER_WIDTH : PEN_WIDTHS[penSize], points });
      },
      erase: (flat) => {
        penSeen.current = performance.now();
        if (loadPending.current) return;
        // Samples of a fast pass are far apart, so test the path between them too.
        const path = sweep(strokePoints(flat), ERASER_REACH / 2).flatMap(({ x, y }) => {
          const at = local(x, y);
          return [at.x, at.y];
        });
        if (path.length === 2) path.push(path[0], path[1]);
        const hit = strokesHitByPath(board(), index.current, path, ERASER_REACH / camera.current.z);
        if (hit.size > 0) apply(removeItems(board(), hit));
      },
    };
  }, [apply, addStroke, select, painted]);

  /** Writing scale with the board's `top` (board units) at the top of the view. */
  const fitTo = useCallback((top: number) => {
    fitted.current = true;
    camera.current = fitCamera(board().page, view.current, top, span());
    repaint();
  }, [repaint]);

  /** Opens a board: the first work near the top of the view, at writing scale. */
  const open = useCallback((next: BoardInk) => {
    history.current = startHistory(next);
    index.current = new GridIndex();
    pictures.current.clear();
    erasing.current = null;
    writing.current = null;
    lassoing.current = null;
    selection.current = new Set();
    moving.current = null;
    holdPen(false);
    setSelected(0);
    container.current?.setAttribute('data-selected', '0');
    setTool('pen');
    setSize('s');
    const content = boardBounds(next);
    const z = fitZoom(next.page, view.current);
    placed.current = view.current.w > 0;
    // A notebook opens on its last page, where the writing left off.
    pageIndex.current = (next.page.pages ?? 1) - 1;
    if (next.page.pages) fitTo(pageSpan(next.page, pageIndex.current).top - VIEW_MARGIN / z);
    else fitTo(content ? content.minY - OPEN_TOP / z : next.page.top - VIEW_MARGIN / z);
    inkRevision += 1;
    index.current.update(next);
    void loadPictures(next);
    container.current?.setAttribute('data-strokes', String(next.strokes.length));
    container.current?.setAttribute('data-images', String(next.images.length));
    showSteps();
  }, [fitTo, loadPictures, holdPen]);

  useEffect(() => {
    loadPending.current = Boolean(pendingLoad);
    if (pendingLoad) loads.current += 1;
  }, [pendingLoad]);

  // The board shown on mount, then each board the app loads.
  useEffect(() => { open(history.current.board); }, [open]);
  useEffect(() => {
    if (!pendingLoad) return;
    const show = (loadedInk: BoardInk) => {
      // A notes board saved as one long page is cut into pages as it opens.
      const next = pagedRef.current ? paginate(loadedInk) : loadedInk;
      // Loading resets the tools and undo, which the toolbar shows.
      open(next);
      dispatch({ type: 'LOADED', ink: next, hasContent: next.strokes.length > 0 || next.images.length > 0 });
    };
    const older = !pendingLoad.ink && (pendingLoad.document || pendingLoad.strokes.length > 0);
    if (!older) {
      show(pendingLoad.ink ?? emptyBoard());
      return;
    }
    // A board saved by tldraw (or the canvas before it), converted as it opens; the converter loads only
    // now. Nothing is saved until the board changes. Text, shapes and the like have no ink and are left out.
    let current = true;
    void import('@/lib/inkBoard/fromTldraw').then(({ boardFromTldraw, boardFromLegacyStrokes }) => {
      if (!current) return;
      if (!pendingLoad.document) { show(boardFromLegacyStrokes(pendingLoad.strokes)); return; }
      const { board: converted, leftovers } = boardFromTldraw(pendingLoad.document);
      if (leftovers.length > 0) console.warn(`Left out ${leftovers.length} shape${leftovers.length === 1 ? '' : 's'} the ink board can't show`);
      show(converted);
    }).catch((error) => {
      console.error('Could not convert the board', error);
      if (current) show(emptyBoard());
    });
    return () => { current = false; };
  }, [pendingLoad, open, dispatch]);

  useEffect(() => {
    paperRef.current = paper;
    repaint();
  }, [paper, repaint]);

  // A board that turns out to be notes once open (its kind arrived after the board) is cut into pages then.
  useEffect(() => {
    pagedRef.current = paged;
    if (paged && !loadPending.current && !board().page.pages) open(paginate(board()));
  }, [paged, open]);

  /** Shows page `index` from its top at writing scale; past the last page adds a new one (one undo step). */
  const goToPage = useCallback((index: number) => {
    const { page } = board();
    if (!page.pages || index < 0) return;
    if (index >= page.pages) apply({ ...board(), page: { ...page, pages: index + 1 } });
    select(new Set());
    pageIndex.current = index;
    fitTo(pageSpan(board().page, index).top - VIEW_MARGIN / fitZoom(board().page, view.current));
  }, [apply, fitTo, select]);

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
        const sheet = span();
        if (sheet) fitTo(sheet.top - VIEW_MARGIN / z);
        else fitTo(content ? content.minY - OPEN_TOP / z : board().page.top - VIEW_MARGIN / z);
      } else if (wasFit) fitTo(camera.current.y);
      else setCamera(camera.current);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fitTo, setCamera]);

  // Leaving the page mirrors the last change right away, so it is saved.
  useEffect(() => () => {
    if (mirrorTimer.current) { clearTimeout(mirrorTimer.current); mirror(); }
    // Development mounts twice (Strict Mode): a cancelled frame left in `frame` would stop all repaints.
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    clearTimeout(paced.current);
    paced.current = undefined;
    cancelAnimationFrame(liveFrame.current);
    liveFrame.current = 0;
    clearTimeout(livePaced.current);
    livePaced.current = undefined;
  }, [mirror]);

  // Undo and redo let go of the selection: what it held may be gone or back elsewhere.
  const doUndo = useCallback(() => {
    const before = history.current;
    history.current = undo(before);
    if (history.current !== before) { select(new Set()); changed(); }
  }, [changed, select]);
  const doRedo = useCallback(() => {
    const before = history.current;
    history.current = redo(before);
    if (history.current !== before) { select(new Set()); changed(); }
  }, [changed, select]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event.target) || !container.current?.offsetParent) return;
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey)) {
        // Page Up / Page Down turn a notebook's pages (Page Down past the last adds one).
        if ((key === 'pagedown' || key === 'pageup') && board().page.pages) {
          event.preventDefault();
          goToPage(pageIndex.current + (key === 'pagedown' ? 1 : -1));
          return;
        }
        if (selection.current.size === 0) return;
        if (key === 'delete' || key === 'backspace') { event.preventDefault(); deleteSelection(); }
        else if (key === 'escape') select(new Set());
        return;
      }
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); doUndo(); }
      else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); doRedo(); }
      else if (key === 'd' && selection.current.size > 0) { event.preventDefault(); duplicateSelection(); }
      else if (key === 'c' && selection.current.size > 0) { event.preventDefault(); void copySelection(); }
      else if (key === 'x' && selection.current.size > 0) { event.preventDefault(); void cutSelection(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doUndo, doRedo, deleteSelection, duplicateSelection, copySelection, cutSelection, select, goToPage]);

  // Ctrl+V with a picture on the system clipboard (from a PDF or another app) puts it on the board, like Add
  // picture; otherwise the app's own copy (ink copied with the lasso, or part of a PDF page) is pasted.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (typing(event.target) || !container.current?.offsetParent) return;
      const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith('image/'));
      event.preventDefault();
      if (!file) { void pasteCopiedPicture(handleRef.current); return; }
      void handleRef.current?.addPicture(imageFileToPng(file, MAX_BOARD_PICTURE)).catch((error) => console.error('Could not paste the picture', error));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleRef]);

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
    const loop = lassoing.current?.path;
    const drag = moving.current;
    if (!stroke && !loop && !drag) return;
    const { x, y, z } = camera.current;
    context.setTransform(ratio * z, 0, 0, ratio * z, -x * z * ratio, -y * z * ratio);
    if (stroke) drawBoardStroke(context, stroke);
    if (drag) {
      liveDrag.current = true;
      const moved = dragged(history.current.board, drag);
      const ids = selection.current;
      drawBoard(context, { ...moved, strokes: moved.strokes.filter((item) => ids.has(item.id)), images: moved.images.filter((item) => ids.has(item.id)) }, loaded());
      const box = boardBounds(moved, ids);
      if (box) {
        const pad = SELECTION_PAD / z;
        context.strokeStyle = '#111827';
        context.lineWidth = 1.5 / z;
        context.setLineDash([6 / z, 4 / z]);
        context.strokeRect(box.minX - pad, box.minY - pad, box.maxX - box.minX + pad * 2, box.maxY - box.minY + pad * 2);
        context.setLineDash([]);
        drawHandle(context, box, z);
      }
    }
    if (loop && loop.length >= 4) {
      context.strokeStyle = '#111827';
      context.lineWidth = 1.5 / z;
      context.setLineDash([6 / z, 4 / z]);
      context.beginPath();
      context.moveTo(loop[0], loop[1]);
      for (let i = 2; i < loop.length; i += 2) context.lineTo(loop[i], loop[i + 1]);
      context.stroke();
      context.setLineDash([]);
    }
  }, [loaded]);

  // The lasso's loop and a dragged selection, at most one frame per `frameGap` (on a BOOX the panel's pace).
  const repaintLive = useCallback(() => {
    if (liveFrame.current || livePaced.current) return;
    const run = () => {
      liveFrame.current = requestAnimationFrame(() => {
        liveFrame.current = 0;
        lastLive.current = performance.now();
        paintLive();
      });
    };
    const wait = lastLive.current + frameGap() - performance.now();
    if (wait <= 0) { run(); return; }
    livePaced.current = setTimeout(() => { livePaced.current = undefined; run(); }, wait);
  }, [paintLive, frameGap]);

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = liveCanvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Pen and mouse write (the pen's eraser end, or the Eraser tool, erases); fingers scroll and pinch.
  useEffect(() => {
    const canvas = liveCanvas.current;
    if (!canvas) return;
    let pinch: { distance: number; mid: { x: number; y: number }; start: number; startMid: { x: number; y: number }; mode: 'undecided' | 'scroll' | 'zoom' } | null = null;
    // Contacts taken for a hand (and every contact while one is down) move nothing until they lift.
    const blocked = new Set<number>();
    let firstTouch = 0;

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
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinch = { distance, mid, start: distance, startMid: mid, mode: 'undecided' };
      } else {
        pinch = null;
      }
    };

    // On a BOOX the SDK has the pen; if the page still hears it, it mustn't draw it twice.
    // Whether a board point is inside the lasso's selection box (padded), where the pen drags it.
    const inSelection = (at: { x: number; y: number }) => {
      const box = selection.current.size > 0 ? boardBounds(board(), selection.current) : null;
      const pad = SELECTION_PAD / camera.current.z;
      return Boolean(box && at.x >= box.minX - pad && at.x <= box.maxX + pad && at.y >= box.minY - pad && at.y <= box.maxY + pad);
    };
    // Whether a board point is on the resize handle at the box's bottom right corner.
    const onHandle = (at: { x: number; y: number }) => {
      const box = selection.current.size > 0 ? boardBounds(board(), selection.current) : null;
      if (!box) return false;
      const { z } = camera.current;
      const pad = SELECTION_PAD / z;
      return Math.max(Math.abs(at.x - (box.maxX + pad)), Math.abs(at.y - (box.maxY + pad))) <= HANDLE_REACH / z;
    };

    const booxPen = (event: PointerEvent) => {
      if (event.pointerType !== 'pen' || !booxOwns() || moving.current) return false;
      // Onyx's pen leaves the lasso's selection to the page, which drags it.
      const point = toBoard(camera.current, local(event).x, local(event).y);
      if (style.current.tool === 'lasso' && (inSelection(point) || onHandle(point))) return false;
      event.preventDefault();
      return true;
    };

    // The pen near the screen (hovering too) means the hand on it is resting: any finger gesture ends.
    const penNear = (event: PointerEvent) => {
      if (event.pointerType !== 'pen') return;
      penSeen.current = performance.now();
      if (touches.current.size === 0) return;
      handDown();
    };

    // The fingers down are a hand after all: the gesture ends and they do nothing until lifted.
    const handDown = () => {
      for (const id of touches.current.keys()) blocked.add(id);
      touches.current.clear();
      touchState();
      gesture(false);
    };

    const down = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        // A palm resting while the pen writes, just after it wrote, or as it hovers does nothing;
        // nor does a contact as wide as a palm.
        const now = performance.now();
        const palm = writing.current || erasing.current || lassoing.current || moving.current || now - penSeen.current < PALM_GRACE_MS || Math.max(event.width, event.height) > PALM_SIZE;
        // A third contact, or a second one landing late, is a hand settling, not a pinch.
        const late = touches.current.size >= 2 || (touches.current.size === 1 && now - firstTouch > PINCH_WINDOW_MS);
        if (palm || late || blocked.size > 0) {
          blocked.add(event.pointerId);
          if (touches.current.size > 0) handDown();
          return;
        }
        if (touches.current.size === 0) firstTouch = now;
        touches.current.set(event.pointerId, local(event));
        canvas.setPointerCapture(event.pointerId);
        touchState();
        // One finger does nothing (a graze from the writing hand scrolled the page on the Go 10.3,
        // 2026-11-04); two scroll and pinch, as in BOOX Notes.
        if (touches.current.size >= 2) gesture(true);
        return;
      }
      if (booxPen(event)) return;
      if (event.button !== 0 && event.button !== 5) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      // The pen takes over from any finger already down: its gesture ends here.
      if (touches.current.size > 0) gesture(false);
      touches.current.clear();
      touchState();
      const at = toBoard(camera.current, local(event).x, local(event).y);
      // Button 5 / bit 32: the pen's eraser end.
      const eraser = event.button === 5 || (event.buttons & 32) !== 0 || style.current.tool === 'eraser';
      if (eraser) {
        erasing.current = { before: board(), shown: board(), path: [at.x, at.y] };
        eraseAlong(at, at);
        return;
      }
      if (style.current.tool === 'lasso') {
        // The corner handle resizes the selection, inside its box drags it; anywhere else starts a new loop.
        const handle = onHandle(at);
        if (handle || inSelection(at)) {
          // Paced like a finger gesture on a BOOX: the panel can't keep up with every move.
          gesture(true);
          // The SDK lets go of the pen until it lifts, or it takes the drag once it leaves the box.
          holdPen(true);
          const box = handle ? boardBounds(board(), selection.current) : null;
          moving.current = { pointer: event.pointerId, fromX: at.x, fromY: at.y, dx: 0, dy: 0, factor: 1, scale: box ? { x: box.minX, y: box.minY, size: Math.max(1, box.maxX - box.minX + box.maxY - box.minY) } : undefined };
          repaint();
          paintLive();
          return;
        }
        select(new Set());
        gesture(true);
        lassoing.current = { pointer: event.pointerId, path: [at.x, at.y] };
        paintLive();
        return;
      }
      setOptionsOpen(false);
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
        // Fingers that were down before the pen don't move the page under it.
        if (!touches.current.has(event.pointerId) || writing.current || erasing.current || lassoing.current || moving.current) return;
        touches.current.set(event.pointerId, local(event));
        const points = [...touches.current.values()];
        if (pinch && points.length >= 2) {
          const [a, b] = points;
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          // Two fingers scroll together; they zoom only if their spread clearly changes before they
          // have scrolled, and the gesture keeps whichever it became.
          if (pinch.mode === 'undecided') {
            const spread = Math.abs(distance - pinch.start);
            const travel = Math.hypot(mid.x - pinch.startMid.x, mid.y - pinch.startMid.y);
            if (Math.abs(distance / pinch.start - 1) >= PINCH_START && spread > travel) pinch = { ...pinch, distance, mode: 'zoom' };
            else if (travel >= SCROLL_LOCK && travel > spread) pinch = { ...pinch, mode: 'scroll' };
          }
          if (pinch.mode === 'zoom') {
            fitted.current = false;
            const zoomed = zoomAbout(camera.current, distance / pinch.distance, mid, board().page, view.current, span());
            setCamera({ ...zoomed, x: zoomed.x - (mid.x - pinch.mid.x) / zoomed.z, y: zoomed.y - (mid.y - pinch.mid.y) / zoomed.z });
          } else {
            setCamera({ ...camera.current, x: camera.current.x - (mid.x - pinch.mid.x) / camera.current.z, y: camera.current.y - (mid.y - pinch.mid.y) / camera.current.z });
          }
          pinch = { ...pinch, distance, mid };
        }
        return;
      }
      if (booxPen(event)) return;
      const samples = event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event];
      if (erasing.current) {
        for (const sample of samples) {
          const path = erasing.current.path;
          const from = { x: path[path.length - 2], y: path[path.length - 1] };
          eraseAlong(from, toBoard(camera.current, local(sample).x, local(sample).y));
        }
        return;
      }
      const drag = moving.current;
      if (drag && drag.pointer === event.pointerId) {
        const at = toBoard(camera.current, local(event).x, local(event).y);
        drag.dx = at.x - drag.fromX;
        drag.dy = at.y - drag.fromY;
        if (drag.scale) {
          // The corner follows the pen along the box's diagonal: its width plus height grows by what the pen adds to both.
          const { size } = drag.scale;
          drag.factor = Math.min(MAX_RESIZE, Math.max(MIN_RESIZE / size, (size + drag.dx + drag.dy) / size));
        }
        repaintLive();
        return;
      }
      const loop = lassoing.current;
      if (loop && loop.pointer === event.pointerId) {
        const step = 2 / camera.current.z;
        for (const sample of samples) {
          const at = toBoard(camera.current, local(sample).x, local(sample).y);
          const [lastX, lastY] = loop.path.slice(-2);
          if (Math.hypot(at.x - lastX, at.y - lastY) >= step) loop.path.push(at.x, at.y);
        }
        repaintLive();
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
        if (!touches.current.delete(event.pointerId)) return;
        touchState();
        if (touches.current.size === 0) gesture(false);
        return;
      }
      if (booxPen(event) && !writing.current && !erasing.current) return;
      const drag = moving.current;
      if (drag && drag.pointer === event.pointerId) {
        moving.current = null;
        holdPen(false);
        gesture(false);
        // The selection keeps its ids, so it stays selected where it landed.
        if (event.type !== 'pointercancel' && (drag.dx !== 0 || drag.dy !== 0)) apply(dragged(board(), drag));
        else repaint();
        return;
      }
      const loop = lassoing.current;
      if (loop && loop.pointer === event.pointerId) {
        lassoing.current = null;
        gesture(false);
        paintLive();
        if (event.type !== 'pointercancel') select(itemsInLasso(board(), index.current, loop.path));
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
      if (event.type !== 'pointercancel') addStroke(current.stroke);
    };

    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      gesture(true);
      gesture(false);
      const at = local(event);
      if (event.ctrlKey || event.metaKey) {
        fitted.current = false;
        setCamera(zoomAbout(camera.current, Math.exp(-event.deltaY * 0.002), at, board().page, view.current, span()));
        return;
      }
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.current.h : 1;
      setCamera({ ...camera.current, x: camera.current.x + (event.deltaX * scale) / camera.current.z, y: camera.current.y + (event.deltaY * scale) / camera.current.z });
    };

    // A hand lifting anywhere (it may have slid off the board) frees its contacts.
    const lifted = (event: PointerEvent) => { blocked.delete(event.pointerId); };
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) window.addEventListener(type, penNear, true);
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('pointercancel', lifted, true);
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) window.removeEventListener(type, penNear, true);
      window.removeEventListener('pointerup', lifted, true);
      window.removeEventListener('pointercancel', lifted, true);
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [apply, addStroke, paintLive, repaint, repaintLive, setCamera, booxOwns, gesture, select, holdPen]);


  useImperativeHandle(handleRef, () => ({
    captureForTutor: async () => {
      if (loadPending.current) throw new Error('The board is still loading. Please try again.');
      const load = loads.current;
      const revision = inkRevision;
      const current = board();
      const ids = selectedIds(current, selection.current, pageIndex.current);
      await loadPictures(current);
      if (loads.current !== load || loadPending.current || inkRevision !== revision) throw new Error('The board changed during capture');
      try {
        return tutorImages(current, loaded(), ids);
      } catch (error) {
        // Too many close-ups asks for a selection; anything else is a failed picture.
        if (error instanceof Error && error.message.includes('close-ups')) throw error;
        throw new Error('The board image could not be captured. Please try again, or select a smaller part of your work.');
      }
    },
    captureImage: async () => {
      const current = board();
      await loadPictures(current);
      const picture = renderItems(current, loaded(), selectedIds(current, selection.current, pageIndex.current), TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE, 2);
      return picture ? picture.canvas.toDataURL('image/png').split(',')[1] ?? '' : '';
    },
    captureThumbnail: async () => {
      const current = board();
      await loadPictures(current);
      // A notebook's card shows its first page.
      const picture = renderItems(current, loaded(), current.page.pages ? onPage(current, 0) : null, TUTOR_IMAGE_PADDING, THUMBNAIL_SIDE, 1);
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
        if (board().page.pages) pageIndex.current = pageAt(board().page, existing.y);
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
      // A notebook's page takes it where the view is (its pages never move up to make room).
      const y = !content || page.pages ? camera.current.y + PROBLEM_TOP / camera.current.z
        : key === true ? content.minY - h - PROBLEM_MARGIN : content.maxY + PROBLEM_MARGIN * 2;
      const image: BoardImage = { id: uuidv4(), x: page.left + PROBLEM_MARGIN, y, w, h, src, problem: key };
      pictures.current.set(image.id, { src, image: picture, ready: Promise.resolve() });
      apply(addItems(current, [], [image]));
      fitTo(y - PROBLEM_TOP / fitZoom(board().page, view.current));
      chooseTool('pen');
      return true;
    },
    addPicture: async (made) => {
      // The board it was asked for: another may open while the file is still being read.
      const load = loads.current;
      if (loadPending.current) return false;
      const src = `data:image/png;base64,${await made}`;
      if (loads.current !== load || loadPending.current) return false;
      const picture = await loadPicture(src);
      if (loads.current !== load || loadPending.current) return false;
      const current = board();
      const { page } = current;
      // Shown at half its pixels (it is stored at up to twice the page's width), never wider than the page less its margins.
      const scale = Math.min(0.5, (page.width - PROBLEM_MARGIN * 2) / picture.naturalWidth);
      const w = picture.naturalWidth * scale;
      const h = picture.naturalHeight * scale;
      const content = boardBounds(current);
      const y = content && !page.pages ? content.maxY + PROBLEM_MARGIN * 2 : camera.current.y + PROBLEM_TOP / camera.current.z;
      const image: BoardImage = { id: uuidv4(), x: page.left + PROBLEM_MARGIN, y, w, h, src };
      pictures.current.set(image.id, { src, image: picture, ready: Promise.resolve() });
      apply(addItems(current, [], [image]));
      fitTo(y - PROBLEM_TOP / fitZoom(board().page, view.current));
      // Chosen with the lasso, so a drag moves it into place and Delete takes it away.
      chooseTool('lasso');
      select(new Set([image.id]));
      return true;
    },
    pasteInk: (ink) => {
      if (loadPending.current) return false;
      const copied = addItems(emptyBoard(), ink.strokes, ink.images.filter((image) => !image.problem));
      const box = boardBounds(copied);
      if (!box) return false;
      // Into the middle of the view, as new items.
      const { x, y, z } = camera.current;
      const { w, h } = view.current;
      const dx = Math.round(x + w / z / 2 - (box.minX + box.maxX) / 2);
      const dy = Math.round(y + h / z / 2 - (box.minY + box.maxY) / 2);
      const pasted = copyItems(copied, new Set([...copied.strokes, ...copied.images].map((item) => item.id)), dx, dy, uuidv4);
      const added = { strokes: pasted.board.strokes.filter((stroke) => pasted.ids.has(stroke.id)), images: pasted.board.images.filter((image) => pasted.ids.has(image.id)) };
      apply(addItems(board(), added.strokes, added.images));
      chooseTool('lasso');
      select(pasted.ids);
      return true;
    },
    getRevision: () => inkRevision,
    getInk: () => (loadPending.current ? null : board()),
    // Clear leaves the problem picture, as it is locked.
    clear: () => { select(new Set()); apply(removeItems(board(), new Set([...board().strokes.map((stroke) => stroke.id), ...board().images.filter((image) => !image.problem).map((image) => image.id)]))); },
  }), [apply, chooseTool, fitTo, loadPictures, loaded, select]);

  const button = 'flex items-center justify-center min-h-11 min-w-11 px-2 text-sm rounded-lg border bg-white hover:bg-gray-50 disabled:opacity-40';
  const pressed = (on: boolean) => `${button} ${on ? 'border-2 border-gray-900 font-semibold text-gray-900' : 'border-gray-300 text-gray-800'}`;
  const railButton = (on: boolean) => `flex items-center justify-center w-11 min-h-11 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 ${on ? 'border-2 border-gray-900 text-gray-900' : 'border border-transparent text-gray-800'}`;
  // Choosing the pen or highlighter shows its sizes and inks; tapping it again hides them.
  const pickTool = (next: Tool) => {
    setOptionsOpen((open) => (next === 'pen' || next === 'highlighter') && (next !== tool || !open));
    chooseTool(next);
  };

  return (
    <div ref={container} className="absolute inset-0 overflow-hidden" data-ink-board="true" data-paper={paper} data-strokes="0" data-images="0" data-selected="0">
      <canvas ref={inkCanvas} className="absolute inset-0" aria-hidden="true" />
      <div ref={selectionArea} data-pen-skip className="absolute pointer-events-none" aria-hidden="true" />
      <div ref={handleArea} data-pen-skip data-testid="resize-handle" className="absolute pointer-events-none" aria-hidden="true" />
      <canvas
        ref={liveCanvas}
        className={`absolute inset-0 touch-none ${tool === 'eraser' ? 'cursor-cell' : tool === 'lasso' ? 'cursor-default' : 'cursor-crosshair'}`}
        role="img"
        aria-label="Ink board"
        data-testid="ink-board"
      />
      {/* The tools are in the board's rail (BoardRail); what a tool offers opens over the page's top left. */}
      {!toolsHidden && rail?.tools && createPortal(
        <div role="toolbar" aria-label="Ink tools" aria-orientation="vertical" className="contents">
          <button className={railButton(tool === 'pen')} aria-pressed={tool === 'pen'} aria-expanded={tool === 'pen' && optionsOpen} aria-label="Pen" title="Pen (tap again for size and ink)" onClick={() => pickTool('pen')}><PenIcon /></button>
          <button className={railButton(tool === 'highlighter')} aria-pressed={tool === 'highlighter'} aria-expanded={tool === 'highlighter' && optionsOpen} aria-label="Highlight" title="Highlight (tap again for ink)" onClick={() => pickTool('highlighter')}><HighlightIcon /></button>
          <button className={railButton(tool === 'eraser')} aria-pressed={tool === 'eraser'} aria-label="Eraser" title="Eraser" onClick={() => pickTool('eraser')}><EraserIcon /></button>
          <button className={railButton(tool === 'lasso')} aria-pressed={tool === 'lasso'} aria-label="Lasso" title="Lasso: circle ink to select it" onClick={() => pickTool('lasso')}><LassoIcon /></button>
          <button className={railButton(false)} disabled={!steps.undo} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={doUndo}><UndoIcon /></button>
          <button className={railButton(false)} disabled={!steps.redo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={doRedo}><RedoIcon /></button>
          {pageInfo && (
            // A notebook's pages: back, where you are, and on (a new page after the last).
            <div role="group" aria-label="Pages" className="flex flex-col items-center gap-1 py-1 border-y border-gray-200">
              <button className={railButton(false)} disabled={pageInfo.index === 0} aria-label="Previous page" title="Previous page (Page Up)" onClick={() => goToPage(pageInfo.index - 1)}><ChevronIcon direction="up" /></button>
              <span className="text-xs text-gray-700 tabular-nums" aria-live="polite" data-testid="page-number">{pageInfo.index + 1}/{pageInfo.count}</span>
              {pageInfo.index + 1 < pageInfo.count
                ? <button className={railButton(false)} aria-label="Next page" title="Next page (Page Down)" onClick={() => goToPage(pageInfo.index + 1)}><ChevronIcon direction="down" /></button>
                : <button className={railButton(false)} aria-label="New page" title="Add a page after this one (Page Down)" onClick={() => goToPage(pageInfo.index + 1)}><NewPageIcon /></button>}
            </div>
          )}
          {zoomedAway && <button className={railButton(false)} aria-label="Fit width" title="Back to writing size: the page fills the width" onClick={() => fitTo(camera.current.y)}><FitWidthIcon /></button>}
        </div>,
        rail.tools,
      )}
      {/* Under the selection (placed in paint): the tutor on just these items, Delete, Copy and Done. */}
      <div ref={selectionMenu} role="toolbar" aria-label="Selection" data-testid="selection-menu" style={{ visibility: 'hidden' }}
        className="absolute flex items-center gap-1 p-1 bg-white border border-gray-300 rounded-xl shadow-md">
        {tool === 'lasso' && selected > 0 && (
          <>
            {ask && selectionChoices(ask.sessionType).map((choice) => (
              <button key={choice.intent} disabled={ask.disabled}
                className="flex items-center justify-center min-h-11 px-3 text-sm font-medium rounded-lg border border-indigo-700 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40"
                title={`Ask the tutor about the selection: ${askQuestion(choice.intent, ask.sessionType)}`}
                onClick={() => { if (!ask.disabled && getTutorWaitMs() === 0) ask.onAsk(askQuestion(choice.intent, ask.sessionType)); }}>
                {choice.label}
              </button>
            ))}
            {ask && <span className="w-px h-7 mx-0.5 bg-gray-300" aria-hidden="true" />}
            <button className={pressed(false)} aria-label="Copy" title="Copy, to paste on any board (Ctrl+C)" onClick={() => void copySelection()}><CopyIcon /></button>
            <button className={pressed(false)} aria-label="Delete" title="Delete (Delete)" onClick={deleteSelection}><TrashIcon /></button>
            <button className={pressed(false)} title="Let go of the selection (Esc)" onClick={() => select(new Set())}>Done</button>
          </>
        )}
      </div>
      {!toolsHidden && ((tool === 'lasso' && selected === 0) || ((tool === 'pen' || tool === 'highlighter') && optionsOpen)) && (
        <div role="toolbar" aria-label={tool === 'lasso' ? 'Selection' : 'Pen options'} className="absolute top-2 left-2 right-2 flex flex-wrap items-center gap-1.5 pointer-events-none [&>*]:pointer-events-auto">
          {tool === 'lasso' && (
            <div className="flex items-center gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm" role="group" aria-label="Selection">
              <span className="px-2 text-sm text-gray-600">Circle ink to select it</span>
            </div>
          )}
          {tool === 'pen' && (
            <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm" role="group" aria-label="Pen size">
              {(Object.keys(PEN_WIDTHS) as PenSize[]).map((value) => (
                <button key={value} className={pressed(size === value)} aria-pressed={size === value} aria-label={`Size ${value.toUpperCase()}`} onClick={() => setSize(value)}>
                  <span className="rounded-full bg-gray-900" style={{ width: PEN_WIDTHS[value] * 1.6, height: PEN_WIDTHS[value] * 1.6 }} />
                </button>
              ))}
            </div>
          )}
          {(tool === 'pen' || tool === 'highlighter') && (
            <div className="flex gap-1 p-1 bg-white/95 border border-gray-200 rounded-xl shadow-sm" role="group" aria-label="Ink color">
              {COLORS.map((value) => (
                <button key={value} className={pressed(color === value)} aria-pressed={color === value} aria-label={value[0].toUpperCase() + value.slice(1)} title={value[0].toUpperCase() + value.slice(1)} onClick={() => setColor(value)}>
                  <span className="w-5 h-5 rounded-full" style={{ background: INK_COLORS[value] }} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

