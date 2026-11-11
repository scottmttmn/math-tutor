'use client';

import { useCallback, type RefObject } from 'react';
import { getSetting, listSessions, loadProfile, loadSession, saveQuietCheck, setSetting } from '@/lib/db';
import { getModelConfig } from '@/lib/modelConfig';
import { requestTutorText } from '@/lib/tutorText';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { QUIET_CHECKS_PER_DAY, countToday, parseQuietCheck, unreadSolved, workKey, type UnreadSolved } from '@/lib/quietCheck';
import { savedTutorImages } from '@/lib/inkBoard/capture';
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

// Reads run one after another, so each reserves its place in the daily count after its wait.
let queue: Promise<void> = Promise.resolve();

const quietChecksOn = async () => (await loadProfile())?.quietChecks !== false;

/** What happened to one read: sent and saved, skipped (already read, off, failed), or stopped by the daily cap. */
export type QuietReadOutcome = 'read' | 'skipped' | 'cap';

/**
 * Queues one quiet read of work already pictured. It waits for the tutor to be idle a while unless
 * `waitForQuiet` is false (the catch-up, which the student started; the five-second gate still applies).
 */
function queueQuietRead(
  subject: QuietCheckSubject & { sessionId: string },
  images: { canvasImage: string; canvasDetails?: string[] },
  waitForQuiet = true,
): Promise<QuietReadOutcome> {
  const { sessionId, key } = subject;
  const { canvasImage, canvasDetails } = images;
  const work = workKey(canvasImage);
  const read = async (): Promise<QuietReadOutcome> => {
    if ((await loadSession(sessionId))?.quietChecks?.[key]?.work === work) return 'skipped';
    if (waitForQuiet && !(await quietMoment())) return 'skipped';
    // Turned off meanwhile: nothing is sent.
    if (!(await quietChecksOn())) return 'skipped';
    const day = new Date().toISOString().slice(0, 10);
    const count = countToday(await getSetting<{ day: string; count: number }>(COUNT_KEY), day);
    if (count >= QUIET_CHECKS_PER_DAY) return 'cap';
    await setSetting(COUNT_KEY, { day, count: count + 1 });
    const reply = await requestTutorText({
      quietCheck: true, problemStatement: subject.problemStatement, problemImage: subject.problemImage ?? undefined,
      chatHistory: [], canvasImage, canvasDetails, modelConfig: getModelConfig(),
    }, new AbortController().signal, () => undefined);
    const verdict = reply && parseQuietCheck(reply.text);
    if (!verdict) return 'skipped';
    await saveQuietCheck(sessionId, key, { ...verdict, at: Date.now(), work });
    return 'read';
  };
  const next = queue.then(read).catch((): QuietReadOutcome => 'skipped');
  queue = next.then(() => undefined);
  return next;
}

/** Solved problems the tutor hasn't read yet (saved before quiet checks, or never read). */
export async function listUnreadSolved(): Promise<UnreadSolved[]> {
  return unreadSolved(await listSessions());
}

/**
 * Reads solved problems saved before quiet checks, one at a time, from their saved ink. Stops at the
 * daily cap or when `stopped()` says so; `onProgress(done, total)` follows it. Returns how many were read.
 */
export async function readUnreadSolved(
  onProgress: (done: number, total: number) => void,
  stopped: () => boolean = () => false,
): Promise<{ read: number; capped: boolean }> {
  const list = await listUnreadSolved();
  let read = 0;
  for (let i = 0; i < list.length; i++) {
    if (stopped()) break;
    onProgress(i, list.length);
    const item = list[i];
    try {
      const images = await savedTutorImages(item.ink, item.items ? new Set(item.items) : null);
      if (!images.canvasImage) continue;
      const outcome = await queueQuietRead(item, images, false);
      if (outcome === 'cap') return { read, capped: true };
      if (outcome === 'read') read++;
    } catch {
      // One that can't be pictured is passed over.
    }
  }
  onProgress(list.length, list.length);
  return { read, capped: false };
}

/**
 * The tutor's quiet read of finished work, started when a problem is marked solved. The work is
 * pictured at once; the read runs in the background, once the tutor has been idle a while, and its
 * verdict goes to the saved board for Home, never to the board or the chat. Off in the tutor memory,
 * past the daily cap, for work already read, or on any failure, it does nothing.
 */
export function useQuietCheck(handle: RefObject<DrawingCanvasHandle | null>) {
  return useCallback(async (subject: QuietCheckSubject) => {
    const { sessionId } = subject;
    if (!sessionId || !handle.current) return;
    try {
      if (!(await quietChecksOn())) return;
      // Pictured now, as it was marked solved; read once the tutor is quiet.
      const images = await handle.current.captureForTutor(subject.items);
      if (!images.canvasImage) return;
      await queueQuietRead({ ...subject, sessionId }, images);
    } catch {
      // Quiet by design: a failed read leaves nothing behind, and marking it solved again tries again.
    }
  }, [handle]);
}
