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

/** The check shown for a board on Home: one marked "look" first (a board of several), else the newest. */
export function shownCheck(checks: Record<string, QuietCheck> | undefined, keys?: string[]): QuietCheck | undefined {
  const list = Object.entries(checks ?? {}).filter(([key]) => !keys || keys.includes(key)).map(([, check]) => check);
  return list.find((check) => check.result === 'look') ?? list.sort((a, b) => b.at - a.at)[0];
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
 * Solved problems saved before quiet checks (or never read): problem boards drawn on the ink board
 * with one problem, and solved marked problems in notes. Boards of several exercises are left out,
 * since their work isn't split by exercise.
 */
export function unreadSolved(sessions: Session[]): UnreadSolved[] {
  const found: UnreadSolved[] = [];
  for (const session of sessions) {
    const ink = session.ink;
    if (!ink || session.id.startsWith('workbook:')) continue;
    if ((session.sessionType ?? 'problem') === 'problem') {
      if (session.isSolved && !(session.problems && session.problems.length > 0) && !session.checkIn && !session.quietChecks?.[BOARD_CHECK]
        && ink.strokes.length > 0) {
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
