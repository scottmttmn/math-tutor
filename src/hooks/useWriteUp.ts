'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { getModelConfig } from '@/lib/modelConfig';
import { cleanTexReply } from '@/lib/texWriteUp';
import { requestTutorText } from '@/lib/tutorText';

/**
 * The board's TeX write-up: `convert` sends a picture of the handwriting to the tutor route in
 * write-up mode and streams the LaTeX into `draft`; when it finishes, the result replaces the
 * session's `writeUp` (which autosaves with the board). `edit` changes the saved write-up.
 */
export function useWriteUp() {
  const { problemStatement, problemImage, writeUp, isStreaming } = useSessionState();
  const dispatch = useSessionDispatch();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => { pending.current?.abort(); }, []);

  // Takes the board's picture itself, so a write-up can be stopped while the picture is still being made.
  const convert = useCallback(async (captureImage: () => Promise<string>): Promise<boolean> => {
    if (pending.current || isStreaming) return false;
    const abort = new AbortController();
    pending.current = abort;
    setError(null);
    setDraft('');
    try {
      const canvasImage = await captureImage();
      if (abort.signal.aborted) return false;
      if (!canvasImage) throw new Error('The board is empty. Write something first.');
      const text = await requestTutorText({
        writeUp: true, problemStatement, problemImage: problemImage ?? undefined,
        chatHistory: [], canvasImage, modelConfig: getModelConfig(),
      }, abort.signal, setDraft);
      if (text === null) return false;
      const tex = cleanTexReply(text);
      if (!tex) throw new Error('The tutor returned no write-up. Please try again.');
      if (!abort.signal.aborted) dispatch({ type: 'SET_WRITE_UP', writeUp: { tex, updatedAt: Date.now() } });
      return true;
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error ? caught.message : 'The write-up failed');
      return false;
    } finally {
      pending.current = null;
      if (!abort.signal.aborted) setDraft(null);
    }
  }, [problemStatement, problemImage, isStreaming, dispatch]);

  /** Stops a write-up in progress, e.g. when another board opens, so it can't land there. */
  const cancel = useCallback(() => {
    pending.current?.abort();
    pending.current = null;
    setDraft(null);
    setError(null);
  }, []);

  const edit = useCallback((tex: string) => {
    dispatch({ type: 'SET_WRITE_UP', writeUp: { tex, updatedAt: Date.now() } });
  }, [dispatch]);

  return { writeUp, draft, converting: draft !== null, error, convert, cancel, edit, tutorBusy: isStreaming };
}
