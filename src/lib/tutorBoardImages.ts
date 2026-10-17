import type { TutorImageBounds } from '@/types';

export const TUTOR_IMAGE_SIDE = 2048;
export const TUTOR_IMAGE_PADDING = 16;
export const TUTOR_MAX_DETAILS = 12;
// Each close-up keeps ink at 2x, with overlapping edges so boundary strokes stay readable.
const TILE_SIDE = TUTOR_IMAGE_SIDE / 2 - TUTOR_IMAGE_PADDING * 2;

/** Sparse tiles: a distant picture or empty space must not cost the writing its resolution. */
export function tutorDetailBounds(
  overview: TutorImageBounds,
  work: TutorImageBounds[],
  intersects: (workIndex: number, cell: TutorImageBounds) => boolean = () => true,
): TutorImageBounds[] {
  if (Math.max(overview.w, overview.h) + TUTOR_IMAGE_PADDING * 2 <= TUTOR_IMAGE_SIDE / 2 || work.length === 0) return [];
  const x = Math.min(...work.map((box) => box.x));
  const y = Math.min(...work.map((box) => box.y));
  const tiles = new Map<string, TutorImageBounds>();
  for (const [index, box] of work.entries()) {
    const firstCol = Math.floor((box.x - x) / TILE_SIDE);
    const lastCol = Math.max(firstCol, Math.ceil((box.x + box.w - x) / TILE_SIDE) - 1);
    const firstRow = Math.floor((box.y - y) / TILE_SIDE);
    const lastRow = Math.max(firstRow, Math.ceil((box.y + box.h - y) / TILE_SIDE) - 1);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let col = firstCol; col <= lastCol; col += 1) {
        const key = `${row}:${col}`;
        const cellX = x + col * TILE_SIDE, cellY = y + row * TILE_SIDE;
        if (!intersects(index, { x: cellX - TUTOR_IMAGE_PADDING, y: cellY - TUTOR_IMAGE_PADDING, w: TILE_SIDE + TUTOR_IMAGE_PADDING * 2, h: TILE_SIDE + TUTOR_IMAGE_PADDING * 2 })) continue;
        const previous = tiles.get(key);
        const left = Math.min(previous?.x ?? Infinity, Math.max(cellX, box.x));
        const top = Math.min(previous?.y ?? Infinity, Math.max(cellY, box.y));
        const right = Math.max(previous ? previous.x + previous.w : -Infinity, Math.min(cellX + TILE_SIDE, box.x + box.w));
        const bottom = Math.max(previous ? previous.y + previous.h : -Infinity, Math.min(cellY + TILE_SIDE, box.y + box.h));
        tiles.set(key, { x: left, y: top, w: right - left, h: bottom - top });
        // Never silently omit work or send an unbounded number of images.
        if (tiles.size > TUTOR_MAX_DETAILS) throw new Error('This board needs too many close-ups. Select the work you want the tutor to read, then ask again.');
      }
    }
  }
  return [...tiles.values()]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((box) => ({ x: box.x - TUTOR_IMAGE_PADDING, y: box.y - TUTOR_IMAGE_PADDING, w: box.w + TUTOR_IMAGE_PADDING * 2, h: box.h + TUTOR_IMAGE_PADDING * 2 }));
}
