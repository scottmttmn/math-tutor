import type { BoardInk, TutorImageBounds } from '@/types';
import { TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE, tutorDetailBounds } from '@/lib/tutorBoardImages';
import { boardBounds, strokeBounds, strokeReach, type Bounds } from './model';
import { drawBoard } from './render';

// Pictures of the ink board for the tutor, Home's thumbnail and Save as, with the same sizes tldraw's
// exports had: the writing alone (no paper), trimmed to the work, on white.

/** Saved pictures of the board: sharp at 2x, but small enough for a tablet's canvas limits. */
export const MAX_EXPORT_SIDE = 6000;
export const EXPORT_PADDING = 32;
/** Home's thumbnail, at most this many pixels on its longer side. */
export const THUMBNAIL_SIDE = 512;

const toBox = (bounds: Bounds): TutorImageBounds => ({ x: bounds.minX, y: bounds.minY, w: bounds.maxX - bounds.minX, h: bounds.maxY - bounds.minY });

/** Pixels per board unit for a picture of `bounds` with `padding` that is at most `side` px and at most `max` per unit. */
export function pictureScale(bounds: Bounds, padding: number, side: number, max: number): number {
  return Math.min(max, side / (Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + padding * 2));
}

/** The board's items to picture: the given ones, else all of them. */
function only(board: BoardInk, ids: ReadonlySet<string> | null): BoardInk {
  if (!ids) return board;
  return { ...board, strokes: board.strokes.filter((stroke) => ids.has(stroke.id)), images: board.images.filter((image) => ids.has(image.id)) };
}

/**
 * A canvas showing `area` of the board (the given items, else all) at `scale` pixels per board
 * unit, on white. `pictures` holds the board's loaded pictures by id.
 */
export function renderArea(board: BoardInk, pictures: ReadonlyMap<string, CanvasImageSource>, area: TutorImageBounds, scale: number, ids: ReadonlySet<string> | null = null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(area.w * scale));
  canvas.height = Math.max(1, Math.round(area.h * scale));
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, -area.x * scale, -area.y * scale);
  drawBoard(context, only(board, ids), pictures, { minX: area.x, minY: area.y, maxX: area.x + area.w, maxY: area.y + area.h });
  return canvas;
}

/** The board's items (or all), padded, as a canvas no longer than `side` px; null when empty. */
export function renderItems(board: BoardInk, pictures: ReadonlyMap<string, CanvasImageSource>, ids: ReadonlySet<string> | null, padding: number, side: number, max: number) {
  const bounds = boardBounds(board, ids ?? undefined);
  if (!bounds) return null;
  const scale = pictureScale(bounds, padding, side, max);
  const area = { x: bounds.minX - padding, y: bounds.minY - padding, w: bounds.maxX - bounds.minX + padding * 2, h: bounds.maxY - bounds.minY + padding * 2 };
  return { canvas: renderArea(board, pictures, area, scale, ids), scale };
}

const base64 = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1] ?? '';

/**
 * What the tutor reads: an overview of the given items (or the board) at most 2048 px, plus 2x
 * close-ups of the writing when the overview is shrunk (pictures stay in them, but aren't tiled alone).
 */
export function tutorImages(board: BoardInk, pictures: ReadonlyMap<string, CanvasImageSource>, ids: ReadonlySet<string> | null) {
  const overview = renderItems(board, pictures, ids, TUTOR_IMAGE_PADDING, TUTOR_IMAGE_SIDE, 2);
  if (!overview) return { canvasImage: '' };
  const shown = only(board, ids);
  const bounds = boardBounds(shown)!;
  const work = shown.strokes;
  const tiles = tutorDetailBounds(toBox(bounds), work.map((stroke) => toBox(strokeBounds(stroke))), (index, cell) => {
    // A close-up only where a stroke really passes, not just where its box reaches.
    const stroke = work[index];
    const reach = strokeReach(stroke);
    for (let i = 0; i < stroke.points.length; i += 3) {
      const [x, y] = [stroke.points[i], stroke.points[i + 1]];
      if (x + reach >= cell.x && x - reach <= cell.x + cell.w && y + reach >= cell.y && y - reach <= cell.y + cell.h) return true;
    }
    return false;
  });
  const canvasDetails = tiles.map((tile) => base64(renderArea(board, pictures, tile, 2, ids)));
  return { canvasImage: base64(overview.canvas), canvasDetails };
}

/** Pictures on the board that are the problem, by key (`true` for the board's own). */
export function problemImage(board: BoardInk, key: string | true) {
  return board.images.find((image) => image.problem === key) ?? null;
}

