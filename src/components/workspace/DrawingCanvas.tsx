'use client';

import dynamic from 'next/dynamic';
import type { RefObject } from 'react';
import { useCanvasState } from '@/context/CanvasContext';
import type { BoardImage, BoardInk, BoardStroke, MarkFavorites, Paper, SelectionAsk, TutorBoardImages } from '@/types';

export interface DrawingCanvasHandle {
  /** PNG (base64, no data: prefix) of the lasso's selection, else the whole drawing; '' when nothing is drawn. */
  captureImage: () => Promise<string>;
  /**
   * The selection, else the board (the page in view on a notes board), with readable close-ups when its
   * overview is downscaled; `only` pictures just those items (a marked problem's).
   */
  captureForTutor: (only?: string[]) => Promise<TutorBoardImages>;
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
  /**
   * Puts a picture (base64 PNG, still being made) on the board below the work, chosen with the lasso
   * so it can be moved at once; false when it can't be placed, or another board opened meanwhile.
   */
  addPicture: (picture: Promise<string>) => Promise<boolean>;
  /** Puts copied ink (and pictures) in the middle of the view with new ids, chosen with the lasso; false when nothing could be. */
  pasteInk: (ink: { strokes: BoardStroke[]; images: BoardImage[] }) => boolean;
  /** Shows a marked problem: its page, its work near the top of the view; false when it isn't on the board. */
  showMark: (id: string) => boolean;
  /** Changes whenever the drawing changes; compare it to know whether a new capture is needed. */
  getRevision: () => number;
  /** The live ink board, fresher than the debounced copy in CanvasContext; null before it has loaded. */
  getInk: () => BoardInk | null;
  /** Deletes everything but the problem picture as one undoable step. */
  clear: () => void;
}

// The board needs the browser, so it never renders on the server.
const InkBoard = dynamic(() => import('./InkBoard'), { ssr: false });

/** Fills its nearest positioned ancestor; give that element a size. */
/**
 * `ask`: the tutor choices in the lasso selection's menu, which ask about the selection alone.
 * `paged`: a notes board, cut into pages shown one at a time, where the lasso can mark a problem.
 * `markFavorites`: which marked problems are starred, and starring one.
 */
export default function DrawingCanvas({ handleRef, toolsHidden = false, onShowTools, paper = 'blank', ask, paged = false, markFavorites }: { handleRef: RefObject<DrawingCanvasHandle | null>; toolsHidden?: boolean; onShowTools?: () => void; paper?: Paper; ask?: SelectionAsk; paged?: boolean; markFavorites?: MarkFavorites }) {
  // data-loading: the board still shows the previous drawing (the browser tests wait for it to go).
  const { pendingLoad } = useCanvasState();
  return (
    <div className="absolute inset-0 isolate" data-loading={pendingLoad ? 'true' : undefined}>
      <InkBoard handleRef={handleRef} toolsHidden={toolsHidden} paper={paper} ask={ask} paged={paged} markFavorites={markFavorites} />
      {toolsHidden && onShowTools && (
        // The rail folds away to the left; a tab at that edge brings it back.
        <button onClick={onShowTools} data-testid="show-tools" aria-label="Show tools" title="Show tools"
          className="absolute left-0 top-1/3 z-10 flex items-center justify-center w-8 min-h-11 text-gray-700 bg-white border border-l-0 border-gray-400 rounded-r-lg shadow-sm">
          <span aria-hidden="true">»</span>
        </button>
      )}
    </div>
  );
}
