import { b64Vecs, createShapeId, type TLDefaultColorStyle, type TLDefaultSizeStyle, type TLDrawShape, type TLShapePartial } from 'tldraw';
import type { Point, Stroke } from '@/types';

// Sessions saved before the move to tldraw store raw strokes drawn on the old
// <canvas>. These helpers turn them into tldraw draw shapes when such a session loads.

const COLORS: Record<string, TLDefaultColorStyle> = {
  '#000000': 'black',
  '#1e40af': 'blue',
  '#dc2626': 'red',
  '#16a34a': 'green',
  '#9333ea': 'violet',
  '#ea580c': 'orange',
};

function sizeFor(thickness: number): TLDefaultSizeStyle {
  if (thickness <= 2.5) return 's';
  if (thickness <= 4.5) return 'm';
  if (thickness <= 7.5) return 'l';
  return 'xl';
}

// Pen strokes are resampled to this spacing (CSS px) so an eraser pass between two
// recorded pen points still cuts the line.
const RESAMPLE_STEP = 2;

function resample(points: Point[]): Point[] {
  const result: Point[] = points.slice(0, 1);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / RESAMPLE_STEP);
    for (let step = 1; step <= steps; step++) {
      result.push({ x: a.x + ((b.x - a.x) * step) / steps, y: a.y + ((b.y - a.y) * step) / steps });
    }
  }
  return result;
}

/** Squared distance from p to the segment a-b. */
function distanceToSegmentSq(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
}

/** Whether the eraser's swept path (round-capped segments between its points) covers p. */
function eraserCovers(eraser: Stroke, p: Point, reach: number): boolean {
  const { points } = eraser;
  if (points.length === 1) return distanceToSegmentSq(p, points[0], points[0]) <= reach ** 2;
  for (let i = 1; i < points.length; i++) {
    if (distanceToSegmentSq(p, points[i - 1], points[i]) <= reach ** 2) return true;
  }
  return false;
}

/**
 * The old canvas erased by painting with `destination-out`, which tldraw has no
 * equivalent for. Drop every pen point that an eraser stroke drawn *after* it swept
 * over, splitting the pen stroke where ink was removed.
 */
export function clipErasedInk(strokes: Stroke[]): Stroke[] {
  const result: Stroke[] = [];
  strokes.forEach((stroke, index) => {
    if (stroke.tool !== 'pen' || stroke.points.length === 0) return;
    const erasers = strokes.slice(index + 1).filter((later) => later.tool === 'eraser' && later.points.length > 0);
    if (erasers.length === 0) {
      result.push(stroke);
      return;
    }
    const erased = (point: Point) => erasers.some((eraser) =>
      eraserCovers(eraser, point, eraser.thickness / 2 + stroke.thickness / 2));
    let run: Point[] = [];
    for (const point of resample(stroke.points)) {
      if (erased(point)) {
        if (run.length > 0) result.push({ ...stroke, points: run });
        run = [];
      } else {
        run.push(point);
      }
    }
    if (run.length > 0) result.push({ ...stroke, points: run });
  });
  return result;
}

export function legacyStrokesToShapes(strokes: Stroke[]): TLShapePartial<TLDrawShape>[] {
  return clipErasedInk(strokes).map((stroke) => {
    const [origin] = stroke.points;
    const points = stroke.points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y }));
    return {
      id: createShapeId(),
      type: 'draw',
      x: origin.x,
      y: origin.y,
      props: {
        color: COLORS[stroke.color.toLowerCase()] ?? 'black',
        size: sizeFor(stroke.thickness),
        segments: [{ type: 'free', path: b64Vecs.encodePoints2D(points), dim: 2 }],
        isComplete: true,
        isPen: false,
      },
    };
  });
}
