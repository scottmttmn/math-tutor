'use client';

import { useCallback, type RefObject } from 'react';
import { getSetting, loadProfile, loadSession, saveQuietCheck, setSetting } from '@/lib/db';
import { getModelConfig } from '@/lib/modelConfig';
import { requestTutorText } from '@/lib/tutorText';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { QUIET_CHECKS_PER_DAY, countToday, parseQuietCheck, workKey } from '@/lib/quietCheck';
import type { DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';

const COUNT_KEY = 'quietCheckCount';
/** A read waits until the tutor has been idle this long, so it doesn't hold up a question being asked. */
const IDLE_MS = 20_000;
/** It gives up after waiting this long for a quiet moment. */
const MAX_WAIT_MS = 10 * 60_000;

async function quietMoment(): Promise<boolean> {
  const until = Date.now() + MAX_WAIT_MS;
  for (let wait = getTutorWaitMs(IDLE_MS); wait > 0; wait = getTutorWaitMs(IDLE_MS)) {
    if (Date.now() + wait > until) return false;
    await new Promise((resolve) => setTimeout(resolve, wait + 50));
  }
  return true;
}

/** What a quiet read is about: the board's problem, an exercise on it, or a marked problem's work. */
export interface QuietCheckSubject {
  sessionId: string | null;
  /** Its key in `Session.quietChecks`. */
  key: string;
  problemStatement: string;
  problemImage?: string | null;
  /** Only these items (a marked problem); unset: the board as the tutor sees it. */
  items?: string[];
}

/**
 * The tutor's quiet read of finished work, started when a problem is marked solved. The work is
 * pictured at once; the read runs in the background and its verdict goes to the saved board for
 * Home, never to the board or the chat, once the tutor has been idle a while. Off in the tutor memory, past the daily cap, for work
 * already read, or on any failure, it does nothing.
 */
export function useQuietCheck(handle: RefObject<DrawingCanvasHandle | null>) {
  return useCallback(async (subject: QuietCheckSubject) => {
    const { sessionId, key } = subject;
    if (!sessionId || !handle.current) return;
    try {
      if ((await loadProfile())?.quietChecks === false) return;
      const { canvasImage, canvasDetails } = await handle.current.captureForTutor(subject.items);
      if (!canvasImage) return;
      const work = workKey(canvasImage);
      if ((await loadSession(sessionId))?.quietChecks?.[key]?.work === work) return;
      const day = new Date().toISOString().slice(0, 10);
      const count = countToday(await getSetting<{ day: string; count: number }>(COUNT_KEY), day);
      if (count >= QUIET_CHECKS_PER_DAY || !(await quietMoment())) return;
      await setSetting(COUNT_KEY, { day, count: count + 1 });
      const reply = await requestTutorText({
        quietCheck: true, problemStatement: subject.problemStatement, problemImage: subject.problemImage ?? undefined,
        chatHistory: [], canvasImage, canvasDetails, modelConfig: getModelConfig(),
      }, new AbortController().signal, () => undefined);
      const verdict = reply && parseQuietCheck(reply.text);
      if (verdict) await saveQuietCheck(sessionId, key, { ...verdict, at: Date.now(), work });
    } catch {
      // Quiet by design: a failed read leaves nothing behind, and marking it solved again tries again.
    }
  }, [handle]);
}
