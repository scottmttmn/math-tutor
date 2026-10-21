import type { InkStroke, PageRect } from '@/types';

// Widths as fractions of the page's width, so ink keeps its weight at any size the page is shown.
// The pen is about a fine ballpoint on a printed page; the highlighter covers a line of text.
export const PEN_WIDTH = 0.0022;
export const HIGHLIGHTER_WIDTH = 0.022;
// Ink colors: ink on paper, and a highlight that leaves the print readable (also on e-ink).
export const PEN_COLOR = '#111827';
export const HIGHLIGHTER_COLOR = 'rgba(17, 24, 39, 0.2)';
/** How far from the eraser (CSS px) a stroke is rubbed out. */
export const ERASER_RADIUS = 12;

/** Size, in CSS px, of the whole page as shown (most of it may be cropped away). */
export interface PageScale { x: number; y: number }

/** A point of a stroke rounded for storing: positions to 1/10000 of the page, pressure to 1/100. */
export function inkPoint(x: number, y: number, pressure: number): [number, number, number] {
  const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;
  return [round(x, 4), round(y, 4), round(pressure > 0 ? pressure : 0.5, 2)];
}

/** The whole page's size in CSS px, from the shown (cropped) part's size. */
export function pageScale(shownWidth: number, shownHeight: number, crop: PageRect | null): PageScale {
  return { x: shownWidth / (crop?.width ?? 1), y: shownHeight / (crop?.height ?? 1) };
}

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

type Point = { x: number; y: number };

// Which side of the line a→b the point c is on.
const side = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

/** The closest two segments (a–b, c–d) come: zero when they cross. */
export function segmentsDistance(a: Point, b: Point, c: Point, d: Point) {
  if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return 0;
  return Math.min(
    distanceToSegment(a.x, a.y, c.x, c.y, d.x, d.y), distanceToSegment(b.x, b.y, c.x, c.y, d.x, d.y),
    distanceToSegment(c.x, c.y, a.x, a.y, b.x, b.y), distanceToSegment(d.x, d.y, a.x, a.y, b.x, b.y),
  );
}

/**
 * The strokes left after the eraser moves from `from` to `at` (page fractions): a stroke any part
 * of which comes within `radius` CSS px (plus its own half width) of that path is removed whole,
 * so a fast sweep between two samples still rubs out what it crossed. The same array when nothing is.
 */
export function eraseAt(strokes: InkStroke[], at: Point, radius: number, scale: PageScale, from: Point = at): InkStroke[] {
  const a = { x: from.x * scale.x, y: from.y * scale.y };
  const b = { x: at.x * scale.x, y: at.y * scale.y };
  const kept = strokes.filter((stroke) => {
    const reach = radius + ((stroke.tool === 'pen' ? PEN_WIDTH : HIGHLIGHTER_WIDTH) * scale.x) / 2;
    const { points } = stroke;
    for (let i = 0; i < points.length; i += 3) {
      const j = Math.max(0, i - 3);
      const c = { x: points[j] * scale.x, y: points[j + 1] * scale.y };
      const d = { x: points[i] * scale.x, y: points[i + 1] * scale.y };
      if (segmentsDistance(a, b, c, d) <= reach) return false;
    }
    return true;
  });
  return kept.length === strokes.length ? strokes : kept;
}

/**
 * Draws strokes onto a canvas showing `crop` of the page at `scale`. The context is in CSS px.
 * Highlights go under the pen's ink, so writing over a highlight stays black.
 */
export function drawStrokes(context: CanvasRenderingContext2D, strokes: InkStroke[], scale: PageScale, crop: PageRect | null) {
  const offsetX = (crop?.x ?? 0) * scale.x;
  const offsetY = (crop?.y ?? 0) * scale.y;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const tool of ['highlighter', 'pen'] as const) {
    for (const stroke of strokes) if (stroke.tool === tool) drawStroke(context, stroke, scale, offsetX, offsetY);
  }
}

/** One stroke: a highlight as one path (so it doesn't darken where it overlaps itself), the pen segment by segment with its pressure. */
export function drawStroke(context: CanvasRenderingContext2D, stroke: InkStroke, scale: PageScale, offsetX: number, offsetY: number) {
  const { points } = stroke;
  if (!points.length) return;
  const x = (i: number) => points[i] * scale.x - offsetX;
  const y = (i: number) => points[i + 1] * scale.y - offsetY;
  if (stroke.tool === 'highlighter') {
    context.strokeStyle = HIGHLIGHTER_COLOR;
    context.lineWidth = HIGHLIGHTER_WIDTH * scale.x;
    context.beginPath();
    context.moveTo(x(0), y(0));
    for (let i = 0; i < points.length; i += 3) context.lineTo(x(i), y(i));
    context.stroke();
    return;
  }
  context.strokeStyle = PEN_COLOR;
  for (let i = 0; i < points.length; i += 3) {
    const j = Math.max(0, i - 3);
    context.lineWidth = PEN_WIDTH * scale.x * (0.6 + 0.8 * points[i + 2]);
    context.beginPath();
    context.moveTo(x(j), y(j));
    context.lineTo(x(i), y(i));
    context.stroke();
  }
}
