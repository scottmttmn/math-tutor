'use client';

import dynamic from 'next/dynamic';
import type { RefObject } from 'react';
import { useCanvasState } from '@/context/CanvasContext';
import type { CanvasDocument, Paper, TutorBoardImages } from '@/types';

export interface DrawingCanvasHandle {
  /** PNG (base64, no data: prefix) of the selected shapes, else the whole drawing; '' when nothing is drawn. */
  captureImage: () => Promise<string>;
  /** The selected shapes, else the board, with readable close-ups when its overview is downscaled. */
  captureForTutor: () => Promise<TutorBoardImages>;
  /** Small PNG of the whole drawing for the saved session; null when nothing is drawn. */
  captureThumbnail: () => Promise<Blob | null>;
  /** The whole board as a PNG or JPEG for saving, and how many pixels it has per board unit; null when empty. */
  exportImage: (format: 'png' | 'jpeg') => Promise<{ blob: Blob; pixelRatio: number } | null>;
  /**
   * Puts the problem picture (base64 PNG) on the board, locked; false when it is already there (the view
   * then goes to it). `key` tags it: `true` (the default) for the board's own problem, an exercise's id
   * for one added to a board of several, which goes below the work already there.
   */
  placeProblemImage: (base64: string, key?: string | true) => Promise<boolean>;
  /** Changes whenever the drawing changes; compare it to know whether a new capture is needed. */
  getRevision: () => number;
  /** The live document, fresher than the debounced copy in CanvasContext. */
  getDocument: () => CanvasDocument | null;
  /** Deletes every shape as one undoable step. */
  clear: () => void;
}

// tldraw needs the browser, so it never renders on the server.
const TldrawCanvas = dynamic(() => import('./TldrawCanvas'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-gray-400">Loading canvas…</div>,
});

/** Fills its nearest positioned ancestor; give that element a size. */
export default function DrawingCanvas({ handleRef, toolsHidden = false, paper = 'blank' }: { handleRef: RefObject<DrawingCanvasHandle | null>; toolsHidden?: boolean; paper?: Paper }) {
  // data-loading: the editor still shows the previous board (the browser tests wait for it to go).
  const { pendingLoad } = useCanvasState();
  return (
    // isolate: tldraw's toolbars use z-indexes up to 10000; keep them below the app's dialogs.
    <div className="absolute inset-0 isolate" data-loading={pendingLoad ? 'true' : undefined}>
      <TldrawCanvas handleRef={handleRef} toolsHidden={toolsHidden} paper={paper} />
    </div>
  );
}
