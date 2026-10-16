import type { Paper, SessionType } from '@/types';

/** The paper choices, in the order the board offers them. */
export const PAPERS: { paper: Paper; label: string }[] = [
  { paper: 'blank', label: 'Blank' },
  { paper: 'lined', label: 'Lined' },
  { paper: 'grid', label: 'Grid' },
];

/** Space between lines, in board units (pen size S writes a line of math in about this much). */
export const LINE_SPACING = 40;
export const GRID_SPACING = 32;

/** The paper a board shows: the one chosen for it, else lined for notes and blank for problems. */
export function paperFor(chosen: Paper | null | undefined, type: SessionType): Paper {
  return chosen ?? (type === 'note' ? 'lined' : 'blank');
}

/**
 * Where the lines fall on screen for a camera (tldraw's x, y and zoom) and a spacing in board units:
 * the gap between lines in screen px and the offset of the first one. Null when they'd be too dense to show.
 */
export function paperLines(camera: { x: number; y: number; z: number }, spacing: number) {
  const gap = spacing * camera.z;
  if (gap < 8) return null;
  const offset = (value: number) => ((value * camera.z) % gap + gap) % gap;
  return { gap, x: offset(camera.x), y: offset(camera.y) };
}
