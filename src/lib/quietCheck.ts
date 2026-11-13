import { liveMarks, markTitle } from '@/lib/inkBoard/model';
import { markedProblem } from '@/lib/tutorAsk';
import type { BoardInk, QuietCheck, Session } from '@/types';

/** At most this many quiet reads a day, so marking a pile of problems solved costs little. */
export const QUIET_CHECKS_PER_DAY = 100;

/** The key of a board's own problem in `Session.quietChecks`. */
export const BOARD_CHECK = 'board';

/** The tutor's verdict from its reply ("Result: look" / "Where: …"), or null when it didn't give one. */
export function parseQuietCheck(text: string): Pick<QuietCheck, 'result' | 'where'> | null {
  const result = /^[\s*_]*Result[*_]*:[\s*_]*(right|look|unclear)\b/im.exec(text)?.[1]?.toLowerCase();
  if (result !== 'right' && result !== 'look' && result !== 'unclear') return null;
  if (result !== 'look') return { result };
  const where = /^[\s*_]*Where[*_]*:[*_]*[ \t]*(.+)$/im.exec(text)?.[1]?.replace(/[*_`]/g, '').trim().slice(0, 120);
  return where ? { result, where } : { result };
}

/** A short hash of the work's picture: the same work is read only once. */
export function workKey(image: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < image.length; i++) {
    hash ^= image.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${image.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** Today's count of quiet reads, starting again each day. */
export function countToday(saved: { day: string; count: number } | undefined, day: string): number {
  return saved?.day === day ? saved.count : 0;
}

/** The check shown for a board on Home and its key: one marked "look" first (a board of several), else the newest. */
export function shownCheckEntry(checks: Record<string, QuietCheck> | undefined, keys?: string[]): [string, QuietCheck] | undefined {
  const list = Object.entries(checks ?? {}).filter(([key]) => !keys || keys.includes(key));
  return list.find(([, check]) => check.result === 'look') ?? list.sort(([, a], [, b]) => b.at - a.at)[0];
}

/** The check shown for a board on Home (see shownCheckEntry). */
export function shownCheck(checks: Record<string, QuietCheck> | undefined, keys?: string[]): QuietCheck | undefined {
  return shownCheckEntry(checks, keys)?.[1];
}

/** A solved problem the tutor hasn't read yet: its board, key, what it is, and which work (a mark's items). */
export interface UnreadSolved {
  sessionId: string;
  key: string;
  problemStatement: string;
  problemImage?: string | null;
  ink: BoardInk;
  items?: string[];
}

/**
 * Solved problems not checked yet (marked solved offline, a read that failed, or solved before quiet
 * checks): problem boards on the ink board (each solved exercise on a board of several) and solved
 * marked problems in notes. Check-ins and boards saved before the ink board are left out.
 */
export function unreadSolved(sessions: Session[]): UnreadSolved[] {
  const found: UnreadSolved[] = [];
  for (const session of sessions) {
    const ink = session.ink;
    if (!ink || session.id.startsWith('workbook:')) continue;
    if ((session.sessionType ?? 'problem') === 'problem') {
      if (session.checkIn || ink.strokes.length === 0) continue;
      if (session.problems && session.problems.length > 0) {
        // A board of several exercises: each solved one, read with the whole board, as when marked.
        for (const problem of session.problems) {
          if (problem.isSolved && !session.quietChecks?.[problem.id]) {
            found.push({ sessionId: session.id, key: problem.id, problemStatement: problem.problemStatement, problemImage: problem.problemImage, ink });
          }
        }
      } else if (session.isSolved && !session.quietChecks?.[BOARD_CHECK]) {
        found.push({ sessionId: session.id, key: BOARD_CHECK, problemStatement: session.problemStatement, problemImage: session.problemImage, ink });
      }
      continue;
    }
    for (const { mark } of liveMarks(ink)) {
      if (mark.solved && !session.quietChecks?.[mark.id]) {
        found.push({ sessionId: session.id, key: mark.id, problemStatement: markedProblem(markTitle(mark)), ink, items: mark.items });
      }
    }
  }
  return found;
}

/**
 * One solved problem on a saved board, by its key, to read again (Check again on Home): the board's own
 * problem, an exercise on a board of several, or a marked problem. Null when it isn't solved or has no ink.
 */
export function solvedSubject(session: Session, key: string): UnreadSolved | null {
  const ink = session.ink;
  if (!ink) return null;
  if ((session.sessionType ?? 'problem') === 'problem') {
    if (session.checkIn || ink.strokes.length === 0) return null;
    if (session.problems && session.problems.length > 0) {
      const problem = session.problems.find((each) => each.id === key);
      return problem?.isSolved ? { sessionId: session.id, key, problemStatement: problem.problemStatement, problemImage: problem.problemImage, ink } : null;
    }
    return key === BOARD_CHECK && session.isSolved
      ? { sessionId: session.id, key, problemStatement: session.problemStatement, problemImage: session.problemImage, ink }
      : null;
  }
  const mark = liveMarks(ink).find((each) => each.mark.id === key)?.mark;
  return mark?.solved ? { sessionId: session.id, key, problemStatement: markedProblem(markTitle(mark)), ink, items: mark.items } : null;
}
