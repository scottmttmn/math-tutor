'use client';

import React, { createContext, useContext, useReducer, type Dispatch } from 'react';
import type { DrawingTool, Point, Stroke, SelectionRect, ToolSettings } from '@/types';
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
  | { type: 'SET_SELECTION'; rect: SelectionRect | null }
  | { type: 'ERASE_SELECTION'; rect: SelectionRect };

interface CanvasState {
  toolSettings: ToolSettings;
  strokes: Stroke[];
  past: Stroke[][];    // undo stack: each entry is a complete strokes snapshot
  future: Stroke[][];  // redo stack
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
  past: [],
  future: [],
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
        past: [...state.past, state.strokes],
        strokes: [...state.strokes, action.stroke],
        future: [],
      };
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      return {
        ...state,
        past: state.past.slice(0, -1),
        strokes: previous,
        future: [state.strokes, ...state.future],
      };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      return {
        ...state,
        past: [...state.past, state.strokes],
        strokes: next,
        future: state.future.slice(1),
      };
    }
    case 'CLEAR':
      if (state.strokes.length === 0) return state;
      return {
        ...state,
        past: [...state.past, state.strokes],
        strokes: [],
        future: [],
      };
    case 'LOAD_STROKES':
      return { ...state, strokes: action.strokes, past: [], future: [] };
    case 'SET_SELECTION':
      return { ...state, selection: action.rect };
    case 'ERASE_SELECTION': {
      const { rect } = action;
      const x1 = Math.min(rect.startX, rect.startX + rect.width);
      const x2 = Math.max(rect.startX, rect.startX + rect.width);
      const y1 = Math.min(rect.startY, rect.startY + rect.height);
      const y2 = Math.max(rect.startY, rect.startY + rect.height);
      const inside = (p: Point) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;

      // Split each stroke into runs of consecutive points OUTSIDE the selection.
      // This clips strokes at the boundary rather than deleting entire strokes
      // that merely touch the selected region.
      const newStrokes: Stroke[] = [];
      for (const stroke of state.strokes) {
        let run: Point[] = [];
        for (const point of stroke.points) {
          if (!inside(point)) {
            run.push(point);
          } else {
            if (run.length >= 2) newStrokes.push({ ...stroke, points: run });
            run = [];
          }
        }
        if (run.length >= 2) newStrokes.push({ ...stroke, points: run });
      }
      return {
        ...state,
        past: [...state.past, state.strokes],
        strokes: newStrokes,
        future: [],
        selection: null,
      };
    }
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
