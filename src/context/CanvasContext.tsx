'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { DrawingTool, Stroke, SelectionRect, ToolSettings } from '@/types';
import { DEFAULT_PEN_COLOR, DEFAULT_PEN_THICKNESS, DEFAULT_ERASER_THICKNESS } from '@/lib/constants';

type CanvasAction =
  | { type: 'SET_TOOL'; tool: DrawingTool }
  | { type: 'SET_COLOR'; color: string }
  | { type: 'SET_THICKNESS'; thickness: number }
  | { type: 'ADD_STROKE'; stroke: Stroke }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR' }
  | { type: 'LOAD_STROKES'; strokes: Stroke[] }
  | { type: 'SET_SELECTION'; rect: SelectionRect | null };

interface CanvasState {
  toolSettings: ToolSettings;
  strokes: Stroke[];
  undoneStrokes: Stroke[];
  selection: SelectionRect | null;
}

const initialState: CanvasState = {
  toolSettings: {
    activeTool: 'pen',
    penColor: DEFAULT_PEN_COLOR,
    penThickness: DEFAULT_PEN_THICKNESS,
    eraserThickness: DEFAULT_ERASER_THICKNESS,
  },
  strokes: [],
  undoneStrokes: [],
  selection: null,
};

function canvasReducer(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'SET_TOOL':
      return {
        ...state,
        toolSettings: { ...state.toolSettings, activeTool: action.tool },
        selection: action.tool !== 'select' ? null : state.selection,
      };
    case 'SET_COLOR':
      return {
        ...state,
        toolSettings: { ...state.toolSettings, penColor: action.color },
      };
    case 'SET_THICKNESS':
      return {
        ...state,
        toolSettings: {
          ...state.toolSettings,
          ...(state.toolSettings.activeTool === 'eraser'
            ? { eraserThickness: action.thickness }
            : { penThickness: action.thickness }),
        },
      };
    case 'ADD_STROKE':
      return {
        ...state,
        strokes: [...state.strokes, action.stroke],
        undoneStrokes: [],
      };
    case 'UNDO': {
      if (state.strokes.length === 0) return state;
      const last = state.strokes[state.strokes.length - 1];
      return {
        ...state,
        strokes: state.strokes.slice(0, -1),
        undoneStrokes: [...state.undoneStrokes, last],
      };
    }
    case 'REDO': {
      if (state.undoneStrokes.length === 0) return state;
      const restored = state.undoneStrokes[state.undoneStrokes.length - 1];
      return {
        ...state,
        strokes: [...state.strokes, restored],
        undoneStrokes: state.undoneStrokes.slice(0, -1),
      };
    }
    case 'CLEAR':
      return { ...state, strokes: [], undoneStrokes: [] };
    case 'LOAD_STROKES':
      return { ...state, strokes: action.strokes, undoneStrokes: [] };
    case 'SET_SELECTION':
      return { ...state, selection: action.rect };
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
