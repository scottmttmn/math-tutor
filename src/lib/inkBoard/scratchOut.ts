import type { BoardInk } from '@/types';
import { strokesHitByPath, type GridIndex } from '@/lib/inkBoard/hitTest';

// Scratch out to erase, as in BOOX Notes: a pen stroke that scribbles back and forth over ink
// erases the ink under it instead of being kept. Onyx's pen SDK only hands over finished strokes,
// so the scribble is recognized here, on every device.

/** Turns along the scribble's direction: a scribble goes back and forth at least this often. */
const MIN_TURNS = 4;
/** A move back counts as a turn only once it is this share of the scribble's width (jitter is not). */
const TURN_SHARE = 0.3;
/** Ink length over the scribble's diagonal: a scribble covers its box many times over. */
const MIN_COVER = 3;
/** Its width along the turns over its drift across them: back and forth, not along a line of writing. */
const MIN_SPREAD = 0.5;
/** Smaller than this (board units) is a dot or a tiny mark, not a scribble. */
const MIN_SIZE = 12;
/** A stroke is erased only when at least this share of its points lies under the scribble's box. */
const UNDER_SHARE = 0.5;

/** How many times the values change direction, counting a reversal only past `threshold`. */
function turns(values: number[], threshold: number): number {
  let count = 0;
  let direction = 0;
  let anchor = values[0];
  for (const value of values) {
    const moved = value - anchor;
    if (direction >= 0 && moved > 0) { anchor = value; direction = 1; continue; }
    if (direction <= 0 && moved < 0) { anchor = value; direction = -1; continue; }
    if (Math.abs(moved) >= threshold) {
      count += 1;
      direction = -direction;
      anchor = value;
    }
  }
  return count;
}

/** Whether a stroke's points [x, y, pressure, …] are a scribble (back and forth many times in a tight area). */
export function isScribble(points: number[]): boolean {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < points.length; i += 3) { xs.push(points[i]); ys.push(points[i + 1]); }
  if (xs.length < 8) return false;
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (Math.max(width, height) < MIN_SIZE) return false;
  let length = 0;
  for (let i = 1; i < xs.length; i += 1) length += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  if (length < MIN_COVER * Math.hypot(width, height)) return false;
  // The turns go across the wider side, or along the narrower one when that is where it goes back and forth.
  const across = turns(xs, TURN_SHARE * width) >= MIN_TURNS && width >= MIN_SPREAD * height;
  const down = turns(ys, TURN_SHARE * height) >= MIN_TURNS && height >= MIN_SPREAD * width;
  return across || down;
}

/**
 * The strokes a scratch-out erases: a scribble's points [x, y, pressure, …] (board units), the
 * strokes it passes within `reach` of that lie mostly under its box. Empty when it is no scribble or
 * covers no ink, and then it is kept as ink. Highlights and pictures are never taken.
 */
export function scratchedOut(board: BoardInk, index: GridIndex, points: number[], reach: number): Set<string> {
  const none = new Set<string>();
  if (!isScribble(points)) return none;
  const path: number[] = [];
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i + 1 < points.length; i += 3) {
    const [x, y] = [points[i], points[i + 1]];
    path.push(x, y);
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  const pad = reach * 2;
  const under = (x: number, y: number) => x >= left - pad && x <= right + pad && y >= top - pad && y <= bottom + pad;
  const hit = strokesHitByPath(board, index, path, reach);
  const taken = new Set<string>();
  for (const stroke of board.strokes) {
    if (!hit.has(stroke.id) || stroke.tool !== 'pen') continue;
    let inside = 0;
    let total = 0;
    for (let i = 0; i + 1 < stroke.points.length; i += 3) {
      total += 1;
      if (under(stroke.points[i], stroke.points[i + 1])) inside += 1;
    }
    if (total > 0 && inside / total >= UNDER_SHARE) taken.add(stroke.id);
  }
  return taken;
}
