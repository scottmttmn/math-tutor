import type { BoardInk, BoardStroke } from '@/types';
import { HIGHLIGHT_ALPHA, INK_COLORS, imageBounds, overlaps, pressureWidth, strokeBounds, type Bounds } from './model';

// Drawing the board onto a 2D canvas. The caller sets the context's transform from board units to
// pixels; these functions only draw. Finished ink is drawn into bands of the page (tiles) that are
// kept as bitmaps, so scrolling and zooming move pictures instead of redrawing every stroke.

/** A tile's height in board units: about one screen of writing. */
export const TILE_HEIGHT = 1024;

/** The tiles (by index from the board's y = 0) that an area touches. */
export function tilesFor(area: Bounds): number[] {
  const tiles: number[] = [];
  for (let tile = Math.floor(area.minY / TILE_HEIGHT); tile <= Math.floor(area.maxY / TILE_HEIGHT); tile++) tiles.push(tile);
  return tiles;
}

/** The band of the board one tile covers, across the whole page width. */
export function tileBounds(board: BoardInk, tile: number): Bounds {
  return { minX: board.page.left, minY: tile * TILE_HEIGHT, maxX: board.page.left + board.page.width, maxY: (tile + 1) * TILE_HEIGHT };
}

/** Whether every point of a pen stroke has the same pressure, so it can be drawn as one path. */
function evenPressure(points: number[]): boolean {
  for (let i = 5; i < points.length; i += 3) if (points[i] !== points[2]) return false;
  return true;
}

/**
 * One stroke. The path runs through the midpoints between samples with the samples as curve
 * controls, so the line is smooth; a pen stroke with varying pressure is drawn piece by piece,
 * each piece at its own width.
 */
export function drawBoardStroke(context: CanvasRenderingContext2D, stroke: BoardStroke) {
  const { points } = stroke;
  if (points.length < 3) return;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = INK_COLORS[stroke.color];
  context.globalAlpha = stroke.tool === 'highlighter' ? HIGHLIGHT_ALPHA : 1;
  const count = points.length / 3;
  const mid = (i: number, axis: 0 | 1) => (points[i * 3 + axis] + points[(i + 1) * 3 + axis]) / 2;
  if (count === 1) {
    // A dot: a zero-length line with round caps.
    context.lineWidth = stroke.tool === 'pen' ? pressureWidth(stroke.width, points[2]) : stroke.width;
    context.beginPath();
    context.moveTo(points[0], points[1]);
    context.lineTo(points[0], points[1]);
    context.stroke();
    context.globalAlpha = 1;
    return;
  }
  if (stroke.tool === 'highlighter' || evenPressure(points)) {
    // One path, so a highlight doesn't darken where it crosses itself.
    context.lineWidth = stroke.tool === 'pen' ? pressureWidth(stroke.width, points[2]) : stroke.width;
    context.beginPath();
    context.moveTo(points[0], points[1]);
    for (let i = 1; i < count - 1; i++) context.quadraticCurveTo(points[i * 3], points[i * 3 + 1], mid(i, 0), mid(i, 1));
    context.lineTo(points[(count - 1) * 3], points[(count - 1) * 3 + 1]);
    context.stroke();
    context.globalAlpha = 1;
    return;
  }
  // Piece i runs from the midpoint before sample i to the one after it (the stroke's ends for the first and last).
  for (let i = 0; i < count; i++) {
    const fromX = i === 0 ? points[0] : mid(i - 1, 0);
    const fromY = i === 0 ? points[1] : mid(i - 1, 1);
    const toX = i === count - 1 ? points[i * 3] : mid(i, 0);
    const toY = i === count - 1 ? points[i * 3 + 1] : mid(i, 1);
    context.lineWidth = pressureWidth(stroke.width, points[i * 3 + 2]);
    context.beginPath();
    context.moveTo(fromX, fromY);
    context.quadraticCurveTo(points[i * 3], points[i * 3 + 1], toX, toY);
    context.stroke();
  }
  context.globalAlpha = 1;
}

/**
 * The board's pictures and ink inside `area` (all of it when null): pictures first, then
 * highlights, then pen ink, so writing over a highlight or a picture stays dark. `pictures` holds
 * the loaded pictures by id; one not loaded yet is skipped.
 */
export function drawBoard(context: CanvasRenderingContext2D, board: BoardInk, pictures: ReadonlyMap<string, CanvasImageSource>, area: Bounds | null = null) {
  for (const image of board.images) {
    const picture = pictures.get(image.id);
    if (picture && (!area || overlaps(imageBounds(image), area))) context.drawImage(picture, image.x, image.y, image.w, image.h);
  }
  for (const tool of ['highlighter', 'pen'] as const) {
    for (const stroke of board.strokes) {
      if (stroke.tool === tool && (!area || overlaps(strokeBounds(stroke), area))) drawBoardStroke(context, stroke);
    }
  }
}
