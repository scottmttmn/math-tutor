'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { BoardInk, CanvasDocument, Stroke } from '@/types';

// The drawing's editor (tldraw's, or the ink board's) owns the live drawing, tools, selection and
// undo history. This context mirrors what the rest of the app needs (the saved drawing and whether
// anything is drawn) and carries requests to replace the drawing.

/** A drawing to put on the canvas: a tldraw document, an ink board, or strokes from a pre-tldraw session. */
export interface CanvasLoad {
  document: CanvasDocument | null;
  strokes: Stroke[];
  ink?: BoardInk | null;
}

/**
 * Which editor the open board belongs to: tldraw, the ink board, or `new` for a board with no
 * drawing yet, which opens in whichever the student chose for new boards.
 */
export type BoardEditor = 'tldraw' | 'ink' | 'new';

type CanvasAction =
  | { type: 'LOAD'; document?: CanvasDocument | null; strokes?: Stroke[]; ink?: BoardInk | null }
  | { type: 'LOADED'; document: CanvasDocument | null; ink?: BoardInk | null; hasContent: boolean }
  | { type: 'DOCUMENT_CHANGED'; document: CanvasDocument; hasContent: boolean }
  | { type: 'INK_CHANGED'; ink: BoardInk; hasContent: boolean };

interface CanvasState {
  /** Latest tldraw document mirrored from the editor (debounced while drawing). */
  document: CanvasDocument | null;
  /** Latest ink board mirrored from it (debounced while drawing). */
  ink: BoardInk | null;
  hasContent: boolean;
  editor: BoardEditor;
  /** A load the editor has not applied yet; it may mount after the request. */
  pendingLoad: CanvasLoad | null;
}

/** The ink board, if anything is on it (strokes or pictures). */
export function drawnInk(ink: BoardInk | null | undefined): BoardInk | null {
  return ink && (ink.strokes.length > 0 || ink.images.length > 0) ? ink : null;
}

/** The tldraw document, if it holds any shape. */
export function drawnDocument(document: CanvasDocument | null | undefined): CanvasDocument | null {
  return document && Object.keys(document.store ?? {}).some((key) => key.startsWith('shape:')) ? document : null;
}

const initialState: CanvasState = { document: null, ink: null, hasContent: false, editor: 'new', pendingLoad: null };

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'LOAD': {
      const load = { document: action.document ?? null, strokes: action.strokes ?? [], ink: action.ink ?? null };
      return {
        document: load.document,
        ink: load.ink,
        hasContent: load.strokes.some((stroke) => stroke.tool === 'pen') || Boolean(load.document) || Boolean(drawnInk(load.ink)),
        // A board saved empty is still new.
        editor: drawnInk(load.ink) ? 'ink' : drawnDocument(load.document) || load.strokes.length > 0 ? 'tldraw' : 'new',
        pendingLoad: load,
      };
    }
    case 'LOADED':
      return { ...state, document: action.document, ink: action.ink ?? null, hasContent: action.hasContent, pendingLoad: null };
    case 'DOCUMENT_CHANGED':
      // A new board belongs to tldraw once something is drawn on it.
      return { ...state, document: action.document, ink: null, hasContent: action.hasContent, editor: state.editor === 'new' && action.hasContent ? 'tldraw' : state.editor };
    case 'INK_CHANGED':
      return { ...state, ink: action.ink, document: null, hasContent: action.hasContent, editor: state.editor === 'new' && action.hasContent ? 'ink' : state.editor };
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
