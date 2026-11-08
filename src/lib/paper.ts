import type { Paper, SessionType } from '@/types';

/** The paper choices, in the order the board offers them. */
export const PAPERS: { paper: Paper; label: string }[] = [
  { paper: 'blank', label: 'Blank' },
  { paper: 'lined', label: 'Lined' },
  { paper: 'grid', label: 'Grid' },
];

/**
 * Space between lines, in board units: about BOOX Notes' ruling at writing scale (a 960-unit page),
 * room for a fraction or an exponent on one line. 40 was too tight on the Go 10.3 (2026-11-04).
 */
export const LINE_SPACING = 80;
export const GRID_SPACING = 32;
/** The ruling's color: dark enough to read on an e-ink screen (#c4c8ce was too faint on the Go 10.3, 2026-11-04). */
export const PAPER_LINE = '#8b9099';

/** The paper a board shows: the one chosen for it, else lined for notes and blank for problems. */
export function paperFor(chosen: Paper | null | undefined, type: SessionType): Paper {
  return chosen ?? (type === 'note' ? 'lined' : 'blank');
}
