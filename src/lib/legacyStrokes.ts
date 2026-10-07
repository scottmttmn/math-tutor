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

/**
 * The old canvas erased by painting with `destination-out`, which tldraw has no
 * equivalent for. Drop every pen point an eraser stroke drawn *after* it passed
 * over, splitting the pen stroke where ink was removed.
 */
export function clipErasedInk(strokes: Stroke[]): Stroke[] {
  const result: Stroke[] = [];
  strokes.forEach((stroke, index) => {
    if (stroke.tool !== 'pen') return;
    const erasers = strokes.slice(index + 1).filter((later) => later.tool === 'eraser');
    const erased = (point: Point) => erasers.some((eraser) => {
      const reach = eraser.thickness / 2 + stroke.thickness / 2;
      return eraser.points.some((e) => (e.x - point.x) ** 2 + (e.y - point.y) ** 2 <= reach ** 2);
    });
    let run: Point[] = [];
    for (const point of stroke.points) {
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
