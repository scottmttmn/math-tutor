'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { liveMarks, markTitle } from '@/lib/inkBoard/model';
import { markedProblem } from '@/lib/tutorAsk';
import type { DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import type { BoardMark, TutorAbout, TutorFollowUp } from '@/types';

/** A marked problem asked about as a problem, whatever the board is. */
export const markAbout = (mark: BoardMark): TutorAbout => ({ sessionType: 'problem', problemStatement: markedProblem(markTitle(mark)) });

/**
 * The marked problem the conversation is about. Hint or Check on a mark starts it, so follow-ups
 * keep asking about that problem and picture its work alone; any other ask, or another board
 * (`resetKey`), ends it, as does the mark being unmarked or its work removed.
 */
export function useMarkConversation(handle: RefObject<DrawingCanvasHandle | null>, resetKey: unknown) {
  const markId = useRef<string | null>(null);
  useEffect(() => { markId.current = null; }, [resetKey]);

  const start = useCallback((mark: BoardMark) => { markId.current = mark.id; }, []);
  const end = useCallback(() => { markId.current = null; }, []);

  /** The board's pictures for a follow-up: the mark's work and what it is about, or the board as usual. */
  const followUpImages = useCallback(async (): Promise<TutorFollowUp> => {
    if (!handle.current) throw new Error('The board is still loading. Please try again.');
    const ink = handle.current.getInk();
    const live = markId.current && ink ? liveMarks(ink).find(({ mark }) => mark.id === markId.current) : undefined;
    if (!live) {
      markId.current = null;
      return handle.current.captureForTutor();
    }
    return { ...(await handle.current.captureForTutor(live.mark.items)), about: markAbout(live.mark) };
  }, [handle]);

  return { start, end, followUpImages };
}
