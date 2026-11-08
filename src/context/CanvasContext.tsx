'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { BoardInk, CanvasDocument, Stroke } from '@/types';

// The ink board owns the live drawing, tools, selection and undo history. This context mirrors
// what the rest of the app needs (the saved drawing and whether anything is drawn) and carries
// requests to replace the drawing.

/**
 * A drawing to put on the board: an ink board, or one saved before it (a tldraw document or
 * strokes from the canvas before tldraw), which the board converts as it opens.
 */
export interface CanvasLoad {
  document: CanvasDocument | null;
  strokes: Stroke[];
  ink?: BoardInk | null;
}

type CanvasAction =
  | { type: 'LOAD'; document?: CanvasDocument | null; strokes?: Stroke[]; ink?: BoardInk | null }
  | { type: 'LOADED'; ink: BoardInk; hasContent: boolean }
  | { type: 'INK_CHANGED'; ink: BoardInk; hasContent: boolean };

interface CanvasState {
  /** Latest ink board mirrored from it (debounced while drawing). */
  ink: BoardInk | null;
  hasContent: boolean;
  /** A load the board has not applied yet; it may mount after the request. */
  pendingLoad: CanvasLoad | null;
}

/** The ink board, if anything is on it (strokes or pictures). */
export function drawnInk(ink: BoardInk | null | undefined): BoardInk | null {
  return ink && (ink.strokes.length > 0 || ink.images.length > 0) ? ink : null;
}

/** A tldraw document saved before the ink board, if it holds any shape. */
export function drawnDocument(document: CanvasDocument | null | undefined): CanvasDocument | null {
  return document && Object.keys(document.store ?? {}).some((key) => key.startsWith('shape:')) ? document : null;
}

const initialState: CanvasState = { ink: null, hasContent: false, pendingLoad: null };

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'LOAD': {
      const load = { document: action.document ?? null, strokes: action.strokes ?? [], ink: action.ink ?? null };
      return {
        ink: load.ink,
        hasContent: load.strokes.some((stroke) => stroke.tool === 'pen') || Boolean(drawnDocument(load.document)) || Boolean(drawnInk(load.ink)),
        pendingLoad: load,
      };
    }
    case 'LOADED':
      return { ...state, ink: action.ink, hasContent: action.hasContent, pendingLoad: null };
    case 'INK_CHANGED':
      return { ...state, ink: action.ink, hasContent: action.hasContent };
    default:
      return state;
  }
}

const CanvasStateContext = createContext<CanvasState>(initialState);
const CanvasDispatchContext = createContext<Dispatch<CanvasAction>>(() => {});

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(canvasReducer, initialState);
  return (
    <CanvasStateContext.Provider value={state}>
      <CanvasDispatchContext.Provider value={dispatch}>
        {children}
      </CanvasDispatchContext.Provider>
    </CanvasStateContext.Provider>
  );
}

export function useCanvasState() {
  return useContext(CanvasStateContext);
}

export function useCanvasDispatch() {
  return useContext(CanvasDispatchContext);
}
