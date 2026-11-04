'use client';

import { createContext, useContext } from 'react';

/**
 * The ink board's controls sit in a rail down the board's left side, away from a writing hand
 * resting at the bottom right (Scott bumped Ask tutor there on the Go 10.3, 2026-11-04). BoardFrame
 * provides where they go: the rail, where InkBoard puts its tools (`tools`), and the board's
 * header, where Favorite, Mark solved and Full screen go.
 */
export interface BoardRail {
  tools: HTMLElement | null;
  header: HTMLElement | null;
  setTools: (element: HTMLElement | null) => void;
  setHeader: (element: HTMLElement | null) => void;
}

export const BoardRailContext = createContext<BoardRail | null>(null);
export const useBoardRail = () => useContext(BoardRailContext);

/** Set where a control renders, for its pop-ups: the board's header opens them downward. */
export const InBoardHeader = createContext(false);
