import type { QuietCheck } from '@/types';

/** At most this many quiet reads a day, so marking a pile of problems solved costs little. */
export const QUIET_CHECKS_PER_DAY = 20;

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
