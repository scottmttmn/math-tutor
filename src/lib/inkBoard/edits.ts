import type { BoardImage, BoardInk, BoardStroke } from '@/types';
import { boardBounds, imageBounds, pageAround, strokeBounds, union, type Bounds } from './model';

// Edits never change a board in place: each returns a new one sharing the untouched strokes, so
// undo keeps earlier boards and what changed is found by comparing references.

/** The board with strokes and pictures added on top (pictures under all ink), its page grown to fit them. */
export function addItems(board: BoardInk, strokes: BoardStroke[], images: BoardImage[] = []): BoardInk {
  if (strokes.length === 0 && images.length === 0) return board;
  let added: Bounds | null = null;
  for (const stroke of strokes) added = union(added, strokeBounds(stroke));
  for (const image of images) added = union(added, imageBounds(image));
  return {
    ...board,
    page: pageAround(board.page, added),
    strokes: strokes.length ? [...board.strokes, ...strokes] : board.strokes,
    images: images.length ? [...board.images, ...images] : board.images,
  };
}

/** The board without these items; the same board when none of them is on it. */
export function removeItems(board: BoardInk, ids: ReadonlySet<string>): BoardInk {
  const strokes = board.strokes.filter((stroke) => !ids.has(stroke.id));
  const images = board.images.filter((image) => !ids.has(image.id));
  if (strokes.length === board.strokes.length && images.length === board.images.length) return board;
  return { ...board, strokes, images };
}

/** The board with these items moved by (dx, dy), the page grown to fit where they land. */
export function moveItems(board: BoardInk, ids: ReadonlySet<string>, dx: number, dy: number): BoardInk {
  if ((dx === 0 && dy === 0) || ids.size === 0) return board;
  // Ids no longer on the board (a stale selection) move nothing, and make no undo step.
  if (!board.strokes.some((stroke) => ids.has(stroke.id)) && !board.images.some((image) => ids.has(image.id))) return board;
  const strokes = board.strokes.map((stroke) => {
    if (!ids.has(stroke.id)) return stroke;
    const points = stroke.points.slice();
    for (let i = 0; i < points.length; i += 3) {
      points[i] = Math.round((points[i] + dx) * 10) / 10;
      points[i + 1] = Math.round((points[i + 1] + dy) * 10) / 10;
    }
    return { ...stroke, points };
  });
  const images = board.images.map((image) => (ids.has(image.id) ? { ...image, x: image.x + dx, y: image.y + dy } : image));
  const moved = { ...board, strokes, images };
  return { ...moved, page: pageAround(board.page, boardBounds(moved, ids)) };
}

/** The board with copies of these items, moved by (dx, dy), on top; and the copies' ids. */
export function copyItems(board: BoardInk, ids: ReadonlySet<string>, dx: number, dy: number, newId: () => string): { board: BoardInk; ids: Set<string> } {
  const copied = new Set<string>();
  const strokes = board.strokes.filter((stroke) => ids.has(stroke.id)).map((stroke) => {
    const id = newId();
    copied.add(id);
    return { ...stroke, id };
  });
  const images = board.images.filter((image) => ids.has(image.id) && !image.problem).map((image) => {
    const id = newId();
    copied.add(id);
    return { ...image, id };
  });
  if (copied.size === 0) return { board, ids: copied };
  const added = addItems(board, strokes, images);
  return { board: moveItems(added, copied, dx, dy), ids: copied };
}

/** Where two versions of a board differ (items added, removed or changed); null when they draw the same. */
export function changedBounds(before: BoardInk, after: BoardInk): Bounds | null {
  if (before === after) return null;
  let result: Bounds | null = null;
  const compare = <T extends { id: string }>(a: T[], b: T[], bounds: (item: T) => Bounds) => {
    if (a === b) return;
    const earlier = new Map(a.map((item) => [item.id, item]));
    for (const item of b) {
      const old = earlier.get(item.id);
      earlier.delete(item.id);
      if (old === item) continue;
      result = union(result, bounds(item));
      if (old) result = union(result, bounds(old));
    }
    for (const gone of earlier.values()) result = union(result, bounds(gone));
  };
  compare(before.strokes, after.strokes, strokeBounds);
  compare(before.images, after.images, imageBounds);
  return result;
}

/** How many steps back undo keeps. Boards share their strokes, so a step costs one array of references. */
export const UNDO_LIMIT = 100;

export interface BoardHistory {
  board: BoardInk;
  past: BoardInk[];
  future: BoardInk[];
}

export function startHistory(board: BoardInk): BoardHistory {
  return { board, past: [], future: [] };
}

/** One undoable step to `next`; nothing when it is the same board. */
export function commit(history: BoardHistory, next: BoardInk): BoardHistory {
  if (next === history.board) return history;
  return { board: next, past: [...history.past, history.board].slice(-UNDO_LIMIT), future: [] };
}

export function undo(history: BoardHistory): BoardHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return { board: previous, past: history.past.slice(0, -1), future: [history.board, ...history.future] };
}

export function redo(history: BoardHistory): BoardHistory {
  const [next, ...future] = history.future;
  if (!next) return history;
  return { board: next, past: [...history.past, history.board], future };
}
