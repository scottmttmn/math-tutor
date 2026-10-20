'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasState } from '@/context/CanvasContext';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { loadProfile } from '@/lib/db';
import { getModelConfig } from '@/lib/modelConfig';
import { profileForTutor } from '@/lib/learnerProfile';
import { parseMadeProblem } from '@/lib/tutorProblem';
import { requestTutorText } from '@/lib/tutorText';

/**
 * The problem on a board the tutor writes it for (`tutorProblem` set): asks for it as soon as such
 * a board opens without one, streams it into `draft`, and `another` asks for a different one on the
 * same request. Opening another board stops a request in progress, so it can't land there.
 */
export function useTutorProblem() {
  const { tutorProblem, problemStatement, conversationKey } = useSessionState();
  const dispatch = useSessionDispatch();
  const { pendingLoad } = useCanvasState();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  // Problems already offered on this board, so Different problem doesn't bring one back.
  const offered = useRef<string[]>([]);
  const asked = useRef<number | null>(null);

  const make = useCallback(async () => {
    if (!tutorProblem || pending.current) return;
    const abort = new AbortController();
    pending.current = abort;
    setError(null);
    setDraft('');
    try {
      const profile = await loadProfile().catch(() => undefined);
      if (abort.signal.aborted) return;
      const learnerProfile = profileForTutor(profile);
      const { topic, like, ask } = tutorProblem;
      const reply = await requestTutorText({
        makeProblem: { topic, like, ask, avoid: offered.current },
        problemStatement: '', chatHistory: [], canvasImage: '', modelConfig: getModelConfig(),
        ...(learnerProfile ? { learnerProfile } : {}),
      }, abort.signal, (text) => setDraft(parseMadeProblem(text).problem));
      if (reply === null) return;
      const { title, problem } = parseMadeProblem(reply);
      if (!problem) throw new Error('The tutor returned no problem. Please try again.');
      offered.current = [...offered.current, problem];
      dispatch({ type: 'SET_TUTOR_PROBLEM', problem, title });
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'The tutor could not write a problem');
    } finally {
      if (pending.current === abort) pending.current = null;
      if (!abort.signal.aborted) setDraft(null);
    }
  }, [tutorProblem, dispatch]);

  // Another board opened: forget this one's request and problems.
  useEffect(() => {
    pending.current?.abort();
    pending.current = null;
    offered.current = [];
    setDraft(null);
    setError(null);
  }, [conversationKey]);

  useEffect(() => () => { pending.current?.abort(); }, []);

  // A new board the tutor writes for asks once, after the editor shows it (autosave counts a
  // board as saved when its load completes, so a problem landing before that would never be saved);
  // a failure waits for Try again.
  useEffect(() => {
    if (!tutorProblem || pendingLoad || problemStatement.trim() || asked.current === conversationKey) return;
    const timer = setTimeout(() => { asked.current = conversationKey; void make(); });
    return () => clearTimeout(timer);
  }, [tutorProblem, pendingLoad, problemStatement, conversationKey, make]);

  const another = useCallback(() => {
    if (problemStatement.trim() && !offered.current.includes(problemStatement)) offered.current = [...offered.current, problemStatement];
    void make();
  }, [make, problemStatement]);

  return { tutorProblem, writing: draft !== null, draft, error, retry: make, another };
}
