import type { BoardInk, BoardStroke } from '@/types';
import { segmentsDistance } from '@/lib/ink';
import { imageBounds, overlaps, strokeBounds, strokeReach, type Bounds } from './model';

// Finding strokes under the eraser or inside a lasso without testing every stroke on a long board.

/** Grid cell size in board units: about a line of writing or two. */
const CELL = 128;

/**
 * Which items lie in which grid cells. `update` brings it up to date with a new version of the board,
 * re-indexing only the items whose reference changed.
 */
export class GridIndex {
  private cells = new Map<string, Set<string>>();
  private items = new Map<string, { ref: object; bounds: Bounds }>();

  update(board: BoardInk) {
    const seen = new Set<string>();
    const visit = (id: string, ref: object, bounds: () => Bounds) => {
      seen.add(id);
      const known = this.items.get(id);
      if (known?.ref === ref) return;
      if (known) this.unplace(id, known.bounds);
      const box = bounds();
      this.items.set(id, { ref, bounds: box });
      this.place(id, box);
    };
    for (const stroke of board.strokes) visit(stroke.id, stroke, () => strokeBounds(stroke));
    for (const image of board.images) visit(image.id, image, () => imageBounds(image));
    for (const [id, { bounds }] of this.items) {
      if (seen.has(id)) continue;
      this.unplace(id, bounds);
      this.items.delete(id);
    }
  }

  /** Ids of the items whose bounds overlap `area`. */
  query(area: Bounds): Set<string> {
    const found = new Set<string>();
    this.eachCell(area, (key) => {
      for (const id of this.cells.get(key) ?? []) {
        if (!found.has(id) && overlaps(this.items.get(id)!.bounds, area)) found.add(id);
      }
    });
    return found;
  }

  private place(id: string, bounds: Bounds) {
    this.eachCell(bounds, (key) => {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, (cell = new Set()));
      cell.add(id);
    });
  }

  private unplace(id: string, bounds: Bounds) {
    this.eachCell(bounds, (key) => {
      const cell = this.cells.get(key);
      cell?.delete(id);
      if (cell?.size === 0) this.cells.delete(key);
    });
  }

  private eachCell(bounds: Bounds, visit: (key: string) => void) {
    for (let cx = Math.floor(bounds.minX / CELL); cx <= Math.floor(bounds.maxX / CELL); cx++) {
      for (let cy = Math.floor(bounds.minY / CELL); cy <= Math.floor(bounds.maxY / CELL); cy++) visit(`${cx},${cy}`);
    }
  }
}

type Point = { x: number; y: number };

/** The bounds of a flat [x, y, …] path (`stride` numbers per point), grown by `margin`. */
function pathBounds(path: number[], stride: number, margin: number): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < path.length; i += stride) {
    minX = Math.min(minX, path[i]);
    minY = Math.min(minY, path[i + 1]);
    maxX = Math.max(maxX, path[i]);
    maxY = Math.max(maxY, path[i + 1]);
  }
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Whether a stroke comes within `radius` (plus its own half width) of the path [x, y, …]. */
function strokeNearPath(stroke: BoardStroke, path: number[], radius: number): boolean {
  const reach = radius + strokeReach(stroke);
  const { points } = stroke;
  for (let i = 0; i < path.length; i += 2) {
    const j = Math.max(0, i - 2);
    const a: Point = { x: path[j], y: path[j + 1] };
    const b: Point = { x: path[i], y: path[i + 1] };
    for (let k = 0; k < points.length; k += 3) {
      const m = Math.max(0, k - 3);
      if (segmentsDistance(a, b, { x: points[m], y: points[m + 1] }, { x: points[k], y: points[k + 1] }) <= reach) return true;
    }
  }
  return false;
}

/**
 * The strokes an eraser pass touches: any part within `radius` of its path [x, y, …] (board units),
 * including between samples. Pictures are never erased.
 */
export function strokesHitByPath(board: BoardInk, index: GridIndex, path: number[], radius: number): Set<string> {
  const hit = new Set<string>();
  if (path.length < 2) return hit;
  const candidates = index.query(pathBounds(path, 2, radius));
  for (const stroke of board.strokes) {
    if (candidates.has(stroke.id) && strokeNearPath(stroke, path, radius)) hit.add(stroke.id);
  }
  return hit;
}

/** Whether (x, y) is inside the polygon [x, y, …] (even-odd). */
export function insidePolygon(x: number, y: number, polygon: number[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * What a lasso [x, y, …] takes: strokes with at least half their points inside it, and pictures
 * whose middle is inside. The problem picture is locked and never taken.
 */
export function itemsInLasso(board: BoardInk, index: GridIndex, lasso: number[]): Set<string> {
  const taken = new Set<string>();
  if (lasso.length < 6) return taken;
  const candidates = index.query(pathBounds(lasso, 2, 0));
  for (const stroke of board.strokes) {
    if (!candidates.has(stroke.id)) continue;
    let inside = 0;
    for (let i = 0; i < stroke.points.length; i += 3) if (insidePolygon(stroke.points[i], stroke.points[i + 1], lasso)) inside += 1;
    if (inside * 2 >= stroke.points.length / 3) taken.add(stroke.id);
  }
  for (const image of board.images) {
    if (!image.problem && candidates.has(image.id) && insidePolygon(image.x + image.w / 2, image.y + image.h / 2, lasso)) taken.add(image.id);
  }
  return taken;
}
