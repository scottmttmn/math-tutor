import type { BoardImage, BoardInk, BoardMark, BoardPage, BoardStroke, InkColor } from '@/types';

// The ink board: our own Notes-like canvas, which replaced tldraw. Board units are CSS px
// at writing scale, so the pen SDK's points map straight in. Everything here is pure.

/** A new board's page width, and the room kept around existing work when the page grows to fit it. */
export const PAGE_WIDTH = 960;
export const PAGE_MARGIN = 32;
/** A notes board's page height: with PAGE_WIDTH, the shape of a BOOX Go 10.3's screen (3:4). */
export const PAGE_HEIGHT = 1280;

/** Pen widths, the same as tldraw's solid pen at S, M and L, so converted boards keep their weight. */
export const PEN_WIDTHS = { s: 3, m: 4.5, l: 6 } as const;
export type PenSize = keyof typeof PEN_WIDTHS;
export const HIGHLIGHTER_WIDTH = 20;
/** How strongly a highlight covers: the print or ink under it stays readable, also on e-ink. */
export const HIGHLIGHT_ALPHA = 0.25;

export const INK_COLORS: Record<InkColor, string> = {
  black: '#111827',
  gray: '#6b7280',
  blue: '#1d4ed8',
  red: '#dc2626',
  green: '#15803d',
};

/** The widest a pen stroke gets (at full pressure), as a multiple of its width. */
const MAX_PRESSURE_FACTOR = 1.4;

/** The pen's width at a point: thinner when light, thicker when pressed, `width` at medium pressure. */
export function pressureWidth(width: number, pressure: number): number {
  return width * (0.6 + 0.8 * pressure);
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function emptyBoard(): BoardInk {
  return { version: 1, page: { left: 0, top: 0, width: PAGE_WIDTH }, strokes: [], images: [] };
}

/** A point for storing: positions to 0.1 unit, pressure to 0.01 (a missing pressure counts as medium). */
export function pushPoint(points: number[], x: number, y: number, pressure: number) {
  const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
  points.push(round(x, 1), round(y, 1), round(pressure > 0 ? Math.min(1, pressure) : 0.5, 2));
}

/** The area a stroke's ink covers, including its width. */
export function strokeBounds(stroke: BoardStroke): Bounds {
  const { points } = stroke;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    minX = Math.min(minX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxX = Math.max(maxX, points[i]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  const half = strokeReach(stroke);
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

/** Half the widest the stroke is drawn. */
export function strokeReach(stroke: BoardStroke): number {
  return (stroke.tool === 'pen' ? stroke.width * MAX_PRESSURE_FACTOR : stroke.width) / 2;
}

export function imageBounds(image: BoardImage): Bounds {
  return { minX: image.x, minY: image.y, maxX: image.x + image.w, maxY: image.y + image.h };
}

export function union(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** Everything on the board, or only the given items; null when there is nothing. */
export function boardBounds(board: BoardInk, ids?: ReadonlySet<string>): Bounds | null {
  let result: Bounds | null = null;
  for (const image of board.images) if (!ids || ids.has(image.id)) result = union(result, imageBounds(image));
  for (const stroke of board.strokes) if (!ids || ids.has(stroke.id)) result = union(result, strokeBounds(stroke));
  return result;
}

/** The marked problems whose work is still on the board, each with where that work is. */
export function liveMarks(board: BoardInk): { mark: BoardMark; bounds: Bounds }[] {
  const live: { mark: BoardMark; bounds: Bounds }[] = [];
  for (const mark of board.marks ?? []) {
    const bounds = boardBounds(board, new Set(mark.items));
    if (bounds) live.push({ mark, bounds });
  }
  return live;
}

/** How a marked problem reads on its tag and on Home: "#55 · Stewart 4.2". */
export function markTitle(mark: { label: string; book?: string }): string {
  return mark.book ? `${mark.label} · ${mark.book}` : mark.label;
}

/** Whether the board holds work: any stroke, or a picture other than the problem. */
export function hasWork(board: BoardInk): boolean {
  return board.strokes.length > 0 || board.images.some((image) => !image.problem);
}

/** Page `index` of a paged board, top and bottom in board units. */
export function pageSpan(page: BoardPage, index: number): { top: number; bottom: number } {
  const top = page.top + index * PAGE_HEIGHT;
  return { top, bottom: top + PAGE_HEIGHT };
}

/** The page of a paged board that `y` falls on (the first or last when outside them). */
export function pageAt(page: BoardPage, y: number): number {
  return Math.min((page.pages ?? 1) - 1, Math.max(0, Math.floor((y - page.top) / PAGE_HEIGHT)));
}

/** The board cut into pages (a notes board saved as one long page gets as many as its work needs). */
export function paginate(board: BoardInk): BoardInk {
  if (board.page.pages) return board;
  const content = boardBounds(board);
  const pages = content ? Math.max(1, Math.ceil((content.maxY - board.page.top) / PAGE_HEIGHT)) : 1;
  return { ...board, page: { ...board.page, pages } };
}

/**
 * The page with room for `content`: the same page when it already fits, else wider (either side) or
 * with a higher top. Work is never moved to fit the page.
 */
export function pageAround(page: BoardPage, content: Bounds | null): BoardPage {
  if (!content) return page;
  const left = Math.min(page.left, content.minX - PAGE_MARGIN);
  const right = Math.max(page.left + page.width, content.maxX + PAGE_MARGIN);
  if (page.pages) {
    // Pages keep their top, so none of them moves; work below the last page adds pages.
    const pages = Math.max(page.pages, Math.ceil((content.maxY - page.top) / PAGE_HEIGHT));
    if (left === page.left && right === page.left + page.width && pages === page.pages) return page;
    return { left, top: page.top, width: right - left, pages };
  }
  const top = Math.min(page.top, content.minY - PAGE_MARGIN);
  if (left === page.left && right === page.left + page.width && top === page.top) return page;
  return { left, top, width: right - left };
}
