'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { CanvasDocument, Stroke } from '@/types';

// tldraw's editor owns the live drawing, tools, selection and undo history.
// This context mirrors what the rest of the app needs (the saved document and
// whether anything is drawn) and carries requests to replace the drawing.

/** A drawing to put on the canvas: a tldraw document, or strokes from a pre-tldraw session. */
export interface CanvasLoad {
  document: CanvasDocument | null;
  strokes: Stroke[];
}

type CanvasAction =
  | { type: 'LOAD'; document?: CanvasDocument | null; strokes?: Stroke[] }
  | { type: 'LOADED'; document: CanvasDocument; hasContent: boolean }
  | { type: 'DOCUMENT_CHANGED'; document: CanvasDocument; hasContent: boolean };

interface CanvasState {
  /** Latest document mirrored from the editor (debounced while drawing). */
  document: CanvasDocument | null;
  hasContent: boolean;
  /** A load the editor has not applied yet; it may mount after the request. */
  pendingLoad: CanvasLoad | null;
}

const initialState: CanvasState = { document: null, hasContent: false, pendingLoad: null };

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'LOAD': {
      const load = { document: action.document ?? null, strokes: action.strokes ?? [] };
      return {
        document: load.document,
        hasContent: load.strokes.some((stroke) => stroke.tool === 'pen') || Boolean(load.document),
        pendingLoad: load,
      };
    }
    case 'LOADED':
      return { document: action.document, hasContent: action.hasContent, pendingLoad: null };
    case 'DOCUMENT_CHANGED':
      return { ...state, document: action.document, hasContent: action.hasContent };
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
