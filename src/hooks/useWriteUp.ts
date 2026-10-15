'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { getModelConfig } from '@/lib/modelConfig';
import { getTutorWaitMs, recordTutorUsage, tryStartTutorRequest } from '@/hooks/useRateLimit';
import { cleanTexReply } from '@/lib/texWriteUp';
import type { TutorStreamEvent } from '@/types';

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

  const convert = useCallback(async (canvasImage: string): Promise<boolean> => {
    if (pending.current || isStreaming) return false;
    if (!canvasImage) { setError('The board is empty. Write something first.'); return false; }
    const abort = new AbortController();
    pending.current = abort;
    setError(null);
    setDraft('');
    try {
      const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      // Requests share the tutor's five-second spacing; wait it out rather than refuse.
      const wait = getTutorWaitMs();
      if (wait > 0) await pause(wait + 50);
      if (abort.signal.aborted) return false;
      if (!tryStartTutorRequest()) throw new Error('The tutor is busy. Try again in a moment.');
      const send = () => fetch('/api/tutor', {
        method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          writeUp: true, problemStatement, problemImage: problemImage ?? undefined,
          chatHistory: [], canvasImage, modelConfig: getModelConfig(),
        }),
      });
      let response = await send();
      // The server's gate counts requests from every tab; when it asks to wait, wait once and retry.
      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'));
        await pause((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) : 5) * 1000 + 100);
        if (abort.signal.aborted) return false;
        recordTutorUsage();
        response = await send();
      }
      if (!response.ok) {
        if (response.status === 429) recordTutorUsage();
        throw new Error(await response.text() || response.statusText);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let buffer = '';
      let text = '';
      let stopped = false;
      const readEvent = (frame: string) => {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        const event: TutorStreamEvent = JSON.parse(data);
        if (event.type === 'text_delta' && event.content) {
          text += event.content;
          if (!abort.signal.aborted) setDraft(text);
        } else if (event.type === 'message_stop') stopped = true;
        else if (event.type === 'error') throw new Error(event.error || 'The write-up failed');
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || '';
        for (const frame of frames) readEvent(frame);
        if (done) {
          if (buffer.trim()) readEvent(buffer);
          break;
        }
      }
      if (!stopped) throw new Error('The write-up was interrupted. Please try again.');
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
