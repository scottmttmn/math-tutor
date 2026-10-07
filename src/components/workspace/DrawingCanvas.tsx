'use client';

import dynamic from 'next/dynamic';
import type { RefObject } from 'react';
import type { CanvasDocument } from '@/types';

export interface DrawingCanvasHandle {
  /** PNG (base64, no data: prefix) of the selected shapes, else the whole drawing; '' when nothing is drawn. */
  captureImage: () => Promise<string>;
  /** Small PNG of the whole drawing for the saved session; null when nothing is drawn. */
  captureThumbnail: () => Promise<Blob | null>;
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
export default function DrawingCanvas({ handleRef }: { handleRef: RefObject<DrawingCanvasHandle | null> }) {
  return (
    <div className="absolute inset-0">
      <TldrawCanvas handleRef={handleRef} />
    </div>
  );
}
