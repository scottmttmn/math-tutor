import type { SelectionRect, Stroke } from '@/types';

const MARGIN = 24; // CSS px of breathing room around the ink

/**
 * The region of the canvas that holds ink, in CSS pixels, clamped to the canvas.
 * Eraser strokes only remove ink, so they never grow the box. Returns null when
 * there is nothing drawn, so callers can skip sending an image.
 */
export function drawingBounds(strokes: Stroke[], canvasWidth: number, canvasHeight: number): SelectionRect | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const stroke of strokes) {
    if (stroke.tool !== 'pen') continue;
    const pad = stroke.thickness / 2 + MARGIN;
    for (const { x, y } of stroke.points) {
      minX = Math.min(minX, x - pad);
      minY = Math.min(minY, y - pad);
      maxX = Math.max(maxX, x + pad);
      maxY = Math.max(maxY, y + pad);
    }
  }
  if (minX === Infinity) return null;
  const startX = Math.max(0, Math.floor(minX));
  const startY = Math.max(0, Math.floor(minY));
  const endX = Math.min(canvasWidth, Math.ceil(maxX));
  const endY = Math.min(canvasHeight, Math.ceil(maxY));
  if (endX <= startX || endY <= startY) return null;
  return { startX, startY, width: endX - startX, height: endY - startY };
}
