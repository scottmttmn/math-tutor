'use client';

import { createContext, useCallback, useContext, useEffect, useId, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { AssetRecordType, Box, DefaultDashStyle, DefaultSizeStyle, Tldraw, createShapeId, useEditor, useValue, type Editor, type TLComponents, type TLShape, type TLShapeId } from 'tldraw';
import 'tldraw/tldraw.css';
import { getAssetUrls } from '@tldraw/assets/selfHosted';
import { useCanvasDispatch, useCanvasState, type CanvasLoad } from '@/context/CanvasContext';
import { legacyStrokesToShapes } from '@/lib/legacyStrokes';
import { GRID_SPACING, LINE_SPACING, paperLines } from '@/lib/paper';
import { TUTOR_IMAGE_SIDE, TUTOR_IMAGE_PADDING, tutorDetailBounds } from '@/lib/tutorBoardImages';
import type { Paper } from '@/types';
import type { DrawingCanvasHandle } from './DrawingCanvas';
import PenStylePanel from '@/components/workspace/PenStylePanel';
import { useNotebookMode } from '@/hooks/useNotebookMode';
import { fitNotebookWidth, useNotebookCamera } from '@/hooks/useNotebookCamera';

const PaperContext = createContext<Paper>('blank');
const NotebookContext = createContext<Box | null>(null);

// The board's paper: ruled lines or a grid that move and zoom with the board. It is only a
// background, so exports and what the tutor sees are the writing alone, and nothing snaps to it.
function PaperBackground() {
  const paper = useContext(PaperContext);
  const page = useContext(NotebookContext);
  const patternId = useId();
  const editor = useEditor();
  const camera = useValue('camera', () => editor.getCamera(), [editor]);
  const lines = paper === 'blank' ? null : paperLines(camera, paper === 'grid' ? GRID_SPACING : LINE_SPACING);
  const left = page ? (page.x + camera.x) * camera.z : 0;
  const width = page ? page.w * camera.z : '100%';
  return (
    <div className={`tl-background ${page ? 'bg-gray-200!' : ''}`} data-paper={paper} data-notebook={page ? 'true' : undefined}>
      {(lines || page) && (
        <svg className="absolute inset-0 w-full h-full" aria-hidden="true">
          {page && <rect data-testid="notebook-paper" data-page-width={page.w} x={left} width={width} height="100%" fill="white" stroke="#9ca3af" />}
          {lines && (
            <>
              <defs>
                <pattern id={patternId} patternUnits="userSpaceOnUse" x={lines.x} y={lines.y} width={lines.gap} height={lines.gap}>
                  <path d={paper === 'grid' ? `M0 0.5H${lines.gap}M0.5 0V${lines.gap}` : `M0 0.5H${lines.gap}`} stroke="#c4c8ce" strokeWidth="1" fill="none" />
                </pattern>
              </defs>
              <rect x={left} width={width} height="100%" fill={`url(#${patternId})`} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

// One page per session; no file menu, sharing or help menus.
const components: TLComponents = {
  Background: PaperBackground,
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  // The StylePanel slot moves into a toolbar popover below 640px. Use the unused top-right
  // SharePanel slot so the pen chip stays in the same place at every canvas width.
  StylePanel: null,
  SharePanel: PenStylePanel,
  DebugMenu: null,
  DebugPanel: null,
};

// Served from public/tldraw-assets (copied on npm install) so nothing loads from tldraw's CDN.
const assetUrls = getAssetUrls({ baseUrl: '/tldraw-assets' });

// Bumped synchronously on every document change, unlike the debounced mirror, so callers can
// tell whether the board changed since they last captured it. Module-level so it never repeats
// across remounts (e.g. when another board opens).
let documentRevision = 0;

// Drawing changes the store on every pointer move; mirror it once the pen rests.
const MIRROR_DELAY_MS = 250;

// tldraw defaults to M, which is too heavy for writing math; start every board on S.
const DEFAULT_PEN_SIZE = 's';
// Solid ink keeps an even width; tldraw's default "draw" dash varies it like a marker.
const DEFAULT_PEN_DASH = 'solid';

// A fresh board starts with the pen at its default size and dash, even when the editor is reused.
function startDrawing(editor: Editor) {
  editor.setStyleForNextShapes(DefaultSizeStyle, DEFAULT_PEN_SIZE);
  editor.setStyleForNextShapes(DefaultDashStyle, DEFAULT_PEN_DASH);
  editor.setCurrentTool('draw');
}

// The problem picture placed on the board is marked so it is placed only once: `true` for the board's
// own problem, an exercise's id for each one added to a board of several.
const PROBLEM_META = 'problemImage';
// Gap between the picture and the edge of the view or the work already on the board.
const PROBLEM_MARGIN = 32;
// Clears tldraw's undo/redo bar in the top-left corner of the view.
const PROBLEM_TOP = 64;

function findProblemShape(editor: Editor, key: string | true): TLShape | undefined {
  return editor.getCurrentPageShapes().find((shape) => shape.meta[PROBLEM_META] === key);
}

function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ w: image.naturalWidth, h: image.naturalHeight });
    image.onerror = () => reject(new Error('Image could not be read'));
    image.src = src;
  });
}

// The picture goes in the top-left of the view on an empty board, or above the work already
// there (an added exercise's below it, the next problem down the board); it is locked so the pen
// and eraser leave it alone (unlock it from its menu to move it).
// `stillCurrent` says whether the same board is still loaded once the picture has been read.
async function placeProblemImage(editor: Editor, base64: string, key: string | true, stillCurrent: () => boolean): Promise<boolean> {
  const existing = findProblemShape(editor, key);
  if (existing) {
    const bounds = editor.getShapePageBounds(existing);
    if (bounds) {
      if (editor.getCameraOptions().constraints) fitNotebookWidth(editor, bounds.minY - PROBLEM_MARGIN);
      else editor.zoomToBounds(bounds, { animation: { duration: 200 }, targetZoom: 1 });
    }
    return false;
  }
  const src = `data:image/png;base64,${base64}`;
  const natural = await imageSize(src);
  // A second tap while the picture loaded may have placed it already, or another board may have
  // been opened meanwhile (this picture isn't its problem).
  if (findProblemShape(editor, key) || !stillCurrent()) return false;
  const viewport = editor.getViewportPageBounds();
  const notebookPage = editor.getCameraOptions().constraints?.bounds;
  // Crops are rendered at twice their page size; never wider than most of the view.
  const scale = Math.min(0.5, (notebookPage ? notebookPage.w - PROBLEM_MARGIN * 2 : viewport.w * 0.8) / natural.w);
  const w = natural.w * scale;
  const h = natural.h * scale;
  const content = editor.getCurrentPageBounds();
  const x = notebookPage ? notebookPage.x + PROBLEM_MARGIN : content ? content.minX : viewport.minX + PROBLEM_MARGIN / editor.getZoomLevel();
  const y = !content ? viewport.minY + PROBLEM_TOP / editor.getZoomLevel()
    : key === true ? content.minY - h - PROBLEM_MARGIN : content.maxY + PROBLEM_MARGIN * 2;
  const assetId = AssetRecordType.createId();
  editor.markHistoryStoppingPoint('problem image');
  editor.run(() => {
    editor.createAssets([AssetRecordType.create({
      id: assetId, type: 'image',
      props: { name: 'problem.png', src, w: natural.w, h: natural.h, mimeType: 'image/png', isAnimated: false },
    })]);
    editor.createShape({
      id: createShapeId(), type: 'image', x, y, isLocked: true, meta: { [PROBLEM_META]: key },
      props: { assetId, w, h },
    });
  });
  if (notebookPage) fitNotebookWidth(editor, y - PROBLEM_TOP);
  else if (content) editor.zoomToBounds(Box.Common([content, new Box(x, y, w, h)]), { animation: { duration: 200 }, targetZoom: 1 });
  // Back to the pen, keeping the size and dash picked on this board.
  editor.setCurrentTool('draw');
  return true;
}

function shapesToExport(editor: Editor): TLShapeId[] {
  const selected = editor.getSelectedShapeIds();
  return selected.length > 0 ? selected : [...editor.getCurrentPageShapeIds()];
}

// Snapshots for the tutor: 2x for sharp ink, but never longer than this on either side. A board
// written while zoomed out spans thousands of page units, and at 2x that made images over 6000px
// wide, which ChatGPT rejected. Providers shrink images to about this size anyway.
const MAX_IMAGE_SIDE = TUTOR_IMAGE_SIDE;
const IMAGE_PADDING = TUTOR_IMAGE_PADDING;

function imagePixelRatio(editor: Editor, ids: TLShapeId[]): number {
  const bounds = editor.getShapesPageBounds(ids);
  if (!bounds) return 2;
  const side = Math.max(bounds.w, bounds.h) + IMAGE_PADDING * 2;
  return Math.min(2, MAX_IMAGE_SIDE / side);
}

// Saved pictures of the board: sharp at 2x, but small enough for a tablet's canvas limits.
const MAX_EXPORT_SIDE = 6000;
const EXPORT_PADDING = 32;

function applyLoad(editor: Editor, load: CanvasLoad) {
  if (load.document) {
    editor.loadSnapshot(load.document);
  } else {
    // ignoreShapeLock: the last board's problem picture is locked, and must not stay on this one.
    editor.run(() => {
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      editor.createShapes(legacyStrokesToShapes(load.strokes));
    }, { history: 'ignore', ignoreShapeLock: true });
  }
  // Undo must not step back into the previous session.
  editor.clearHistory();
  startDrawing(editor);
}

export default function TldrawCanvas({ handleRef, toolsHidden, paper }: { handleRef: RefObject<DrawingCanvasHandle | null>; toolsHidden: boolean; paper: Paper }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const { document, pendingLoad } = useCanvasState();
  const dispatch = useCanvasDispatch();
  // Read once on mount, so a remount restores what was there.
  const mountState = useRef({ document, pendingLoad });
  // While a load is pending the editor still shows the previous board, which must not be saved.
  const loadPending = useRef(Boolean(pendingLoad));
  // Counts loads asked for, so work begun on one board can tell another has replaced it.
  const loads = useRef(0);
  useEffect(() => {
    loadPending.current = Boolean(pendingLoad);
    if (pendingLoad) loads.current += 1;
  }, [pendingLoad]);

  const handleMount = useCallback((mounted: Editor) => {
    const { document: existing, pendingLoad: load } = mountState.current;
    if (!load && existing) applyLoad(mounted, { document: existing, strokes: [] });
    else startDrawing(mounted);
    setEditor(mounted);
  }, []);

  useEffect(() => {
    if (!editor || !pendingLoad) return;
    applyLoad(editor, pendingLoad);
    // Mirror right away: until then a save would see neither the old strokes nor the new document.
    dispatch({ type: 'LOADED', document: editor.getSnapshot().document, hasContent: editor.getCurrentPageShapeIds().size > 0 });
  }, [editor, pendingLoad, dispatch]);

  const { notebook } = useNotebookMode();
  const { notebookPage, fitWidth } = useNotebookCamera(editor, notebook, pendingLoad);

  useEffect(() => {
    if (!editor) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const mirror = () => {
      timer = undefined;
      dispatch({
        type: 'DOCUMENT_CHANGED',
        document: editor.getSnapshot().document,
        hasContent: editor.getCurrentPageShapeIds().size > 0,
      });
    };
    const stop = editor.store.listen(() => {
      documentRevision += 1;
      clearTimeout(timer);
      timer = setTimeout(mirror, MIRROR_DELAY_MS);
    }, { scope: 'document', source: 'all' });
    return () => {
      stop();
      if (timer) { clearTimeout(timer); mirror(); }
    };
  }, [editor, dispatch]);

  useImperativeHandle(handleRef, () => ({
    fitWidth,
    captureForTutor: async () => {
      if (!editor || loadPending.current) throw new Error('The board is still loading. Please try again.');
      const board = loads.current;
      const revision = documentRevision;
      const ids = shapesToExport(editor);
      const bounds = editor.getShapesPageBounds(ids);
      if (!bounds) return { canvasImage: '' };
      // Keep problem pictures in the overview and behind annotations, but don't tile pictures alone.
      const work = [...editor.getShapeAndDescendantIds(ids)].flatMap((id) => {
        const shape = editor.getShape(id);
        if (!shape || shape.meta[PROBLEM_META] || shape.type === 'group') return [];
        const box = editor.getShapePageBounds(shape);
        return box ? [{ bounds: box, geometry: editor.getShapeGeometry(shape), toLocal: editor.getShapePageTransform(shape).clone().invert() }] : [];
      });
      const tiles = tutorDetailBounds(bounds, work.map((shape) => shape.bounds), (index, cell) => {
        const { geometry, toLocal } = work[index];
        return geometry.overlapsPolygon(toLocal.applyToPoints(new Box(cell.x, cell.y, cell.w, cell.h).corners));
      });
      try {
        const { url } = await editor.toImageDataUrl(ids, {
          format: 'png', background: true, padding: IMAGE_PADDING, pixelRatio: imagePixelRatio(editor, ids),
        });
        const canvasDetails: string[] = [];
        // Sequential exports keep memory bounded on tablets.
        for (const tile of tiles) {
          const { url } = await editor.toImageDataUrl(ids, {
            format: 'png', background: true, bounds: new Box(tile.x, tile.y, tile.w, tile.h), padding: 0, pixelRatio: 2,
          });
          canvasDetails.push(url.split(',')[1]);
        }
        if (loads.current !== board || loadPending.current || documentRevision !== revision) {
          throw new Error('The board changed during capture');
        }
        return { canvasImage: url.split(',')[1], canvasDetails };
      } catch {
        throw new Error('The board image could not be captured. Please try again, or select a smaller part of your work.');
      }
    },
    captureImage: async () => {
      if (!editor) return '';
      const ids = shapesToExport(editor);
      if (ids.length === 0) return '';
      const { url } = await editor.toImageDataUrl(ids, {
        format: 'png', background: true, padding: IMAGE_PADDING, pixelRatio: imagePixelRatio(editor, ids),
      });
      return url.split(',')[1] ?? '';
    },
    captureThumbnail: async () => {
      if (!editor) return null;
      const ids = [...editor.getCurrentPageShapeIds()];
      if (ids.length === 0) return null;
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, pixelRatio: 1 });
      return blob;
    },
    exportImage: async (format) => {
      if (!editor) return null;
      const ids = [...editor.getCurrentPageShapeIds()];
      const bounds = editor.getShapesPageBounds(ids);
      if (!bounds) return null;
      const pixelRatio = Math.min(2, MAX_EXPORT_SIDE / (Math.max(bounds.w, bounds.h) + EXPORT_PADDING * 2));
      const { blob } = await editor.toImage(ids, { format, background: true, padding: EXPORT_PADDING, pixelRatio, quality: 0.92 });
      return { blob, pixelRatio };
    },
    placeProblemImage: async (base64, key = true) => {
      if (!editor || loadPending.current) return false;
      const board = loads.current;
      return placeProblemImage(editor, base64, key, () => loads.current === board && !loadPending.current);
    },
    getRevision: () => documentRevision,
    getDocument: () => (editor && !loadPending.current ? editor.getSnapshot().document : null),
    clear: () => {
      if (!editor) return;
      editor.markHistoryStoppingPoint('clear');
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    },
  }), [editor, fitWidth]);

  return (
    <PaperContext.Provider value={paper}>
      <NotebookContext.Provider value={notebookPage}>
        <Tldraw assetUrls={assetUrls} components={components} options={{ maxPages: 1 }} onMount={handleMount} hideUi={toolsHidden} />
      </NotebookContext.Provider>
    </PaperContext.Provider>
  );
}
