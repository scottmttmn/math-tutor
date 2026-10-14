'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type RefObject } from 'react';
import { AssetRecordType, Box, DefaultSizeStyle, Tldraw, createShapeId, type Editor, type TLComponents, type TLShape, type TLShapeId } from 'tldraw';
import 'tldraw/tldraw.css';
import { getAssetUrls } from '@tldraw/assets/selfHosted';
import { useCanvasDispatch, useCanvasState, type CanvasLoad } from '@/context/CanvasContext';
import { legacyStrokesToShapes } from '@/lib/legacyStrokes';
import type { DrawingCanvasHandle } from './DrawingCanvas';

// One page per session; no file menu, sharing or help menus.
const components: TLComponents = {
  MainMenu: null,
  PageMenu: null,
  HelpMenu: null,
  SharePanel: null,
  DebugMenu: null,
  DebugPanel: null,
};

// Served from public/tldraw-assets (copied on npm install) so nothing loads from tldraw's CDN.
const assetUrls = getAssetUrls({ baseUrl: '/tldraw-assets' });

// Bumped synchronously on every document change, unlike the debounced mirror, so callers can
// tell whether the board changed since they last captured it. Module-level so it never repeats
// across remounts (the workbook remounts the canvas per exercise).
let documentRevision = 0;

// Drawing changes the store on every pointer move; mirror it once the pen rests.
const MIRROR_DELAY_MS = 250;

// tldraw defaults to M, which is too heavy for writing math; start every board on S.
const DEFAULT_PEN_SIZE = 's';

// A fresh board starts with the pen at its default size, even when the editor is reused.
function startDrawing(editor: Editor) {
  editor.setStyleForNextShapes(DefaultSizeStyle, DEFAULT_PEN_SIZE);
  editor.setCurrentTool('draw');
}

// The problem picture placed on the board is marked so it is placed only once.
const PROBLEM_META = 'problemImage';
// Gap between the picture and the edge of the view or the work already on the board.
const PROBLEM_MARGIN = 32;
// Clears tldraw's undo/redo bar in the top-left corner of the view.
const PROBLEM_TOP = 64;

function findProblemShape(editor: Editor): TLShape | undefined {
  return editor.getCurrentPageShapes().find((shape) => shape.meta[PROBLEM_META] === true);
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
// there; it is locked so the pen and eraser leave it alone (unlock it from its menu to move it).
async function placeProblemImage(editor: Editor, base64: string): Promise<boolean> {
  const existing = findProblemShape(editor);
  if (existing) {
    const bounds = editor.getShapePageBounds(existing);
    if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 200 }, targetZoom: 1 });
    return false;
  }
  const src = `data:image/png;base64,${base64}`;
  const natural = await imageSize(src);
  const viewport = editor.getViewportPageBounds();
  // Crops are rendered at twice their page size; never wider than most of the view.
  const scale = Math.min(0.5, (viewport.w * 0.8) / natural.w);
  const w = natural.w * scale;
  const h = natural.h * scale;
  const content = editor.getCurrentPageBounds();
  const x = content ? content.minX : viewport.minX + PROBLEM_MARGIN / editor.getZoomLevel();
  const y = content ? content.minY - h - PROBLEM_MARGIN : viewport.minY + PROBLEM_TOP / editor.getZoomLevel();
  const assetId = AssetRecordType.createId();
  editor.markHistoryStoppingPoint('problem image');
  editor.run(() => {
    editor.createAssets([AssetRecordType.create({
      id: assetId, type: 'image',
      props: { name: 'problem.png', src, w: natural.w, h: natural.h, mimeType: 'image/png', isAnimated: false },
    })]);
    editor.createShape({
      id: createShapeId(), type: 'image', x, y, isLocked: true, meta: { [PROBLEM_META]: true },
      props: { assetId, w, h },
    });
  });
  if (content) editor.zoomToBounds(Box.Common([content, new Box(x, y, w, h)]), { animation: { duration: 200 }, targetZoom: 1 });
  startDrawing(editor);
  return true;
}

function shapesToExport(editor: Editor): TLShapeId[] {
  const selected = editor.getSelectedShapeIds();
  return selected.length > 0 ? selected : [...editor.getCurrentPageShapeIds()];
}

function applyLoad(editor: Editor, load: CanvasLoad) {
  if (load.document) {
    editor.loadSnapshot(load.document);
  } else {
    editor.run(() => {
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      editor.createShapes(legacyStrokesToShapes(load.strokes));
    }, { history: 'ignore' });
  }
  // Undo must not step back into the previous session.
  editor.clearHistory();
  startDrawing(editor);
}

export default function TldrawCanvas({ handleRef }: { handleRef: RefObject<DrawingCanvasHandle | null> }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const { document, pendingLoad } = useCanvasState();
  const dispatch = useCanvasDispatch();
  // Read once on mount, so a remount restores what was there.
  const mountState = useRef({ document, pendingLoad });
  // While a load is pending the editor still shows the previous board, which must not be saved.
  const loadPending = useRef(Boolean(pendingLoad));
  useEffect(() => { loadPending.current = Boolean(pendingLoad); }, [pendingLoad]);

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
    captureImage: async () => {
      if (!editor) return '';
      const ids = shapesToExport(editor);
      if (ids.length === 0) return '';
      const { url } = await editor.toImageDataUrl(ids, { format: 'png', background: true, padding: 16, pixelRatio: 2 });
      return url.split(',')[1] ?? '';
    },
    captureThumbnail: async () => {
      if (!editor) return null;
      const ids = [...editor.getCurrentPageShapeIds()];
      if (ids.length === 0) return null;
      const { blob } = await editor.toImage(ids, { format: 'png', background: true, pixelRatio: 1 });
      return blob;
    },
    placeProblemImage: async (base64) => (editor ? placeProblemImage(editor, base64) : false),
    getRevision: () => documentRevision,
    getDocument: () => (editor && !loadPending.current ? editor.getSnapshot().document : null),
    clear: () => {
      if (!editor) return;
      editor.markHistoryStoppingPoint('clear');
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    },
  }), [editor]);

  return <Tldraw assetUrls={assetUrls} components={components} options={{ maxPages: 1 }} onMount={handleMount} />;
}
