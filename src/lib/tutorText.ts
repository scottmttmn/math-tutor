import { TUTOR_UNAVAILABLE } from '@/lib/constants';
import { getTutorWaitMs, recordTutorUsage, tryStartTutorRequest } from '@/hooks/useRateLimit';
import { requestTutor } from '@/lib/tutorRequest';
import type { TokenUsage, TutorRequest, TutorStreamEvent } from '@/types';

/**
 * One tutor request whose reply is a piece of text rather than a chat turn (a TeX write-up, a
 * problem from the tutor). It waits out the five-second spacing instead of refusing, retries once
 * when the server's gate asks it to wait, and passes the reply so far to `onText` as it streams.
 * Resolves with the whole reply and its token usage (when the provider reports it), or null when `signal` aborted it.
 */
export async function requestTutorText(body: TutorRequest, signal: AbortSignal, onText: (text: string) => void): Promise<{ text: string; usage?: TokenUsage } | null> {
  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const wait = getTutorWaitMs();
  if (wait > 0) await pause(wait + 50);
  if (signal.aborted) return null;
  if (!tryStartTutorRequest()) throw new Error('The tutor is busy. Try again in a moment.');
  let response = await requestTutor(body, signal);
  // The server's gate counts requests from every tab; when it asks to wait, wait once and retry.
  if (response.status === 429) {
    const seconds = Number(response.headers.get('Retry-After'));
    await pause((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 10) : 5) * 1000 + 100);
    if (signal.aborted) return null;
    recordTutorUsage();
    response = await requestTutor(body, signal);
  }
  if (!response.ok) {
    if (response.status === 429) recordTutorUsage();
    throw new Error(await response.text() || response.statusText);
  }
  if (!response.headers.get('Content-Type')?.includes('text/event-stream')) throw new Error(TUTOR_UNAVAILABLE);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');
  signal.addEventListener('abort', () => { void reader.cancel().catch(() => undefined); });
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopped = false;
  let usage: TokenUsage | undefined;
  const readEvent = (frame: string) => {
    const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return;
    const event: TutorStreamEvent = JSON.parse(data);
    if (event.type === 'text_delta' && event.content) {
      text += event.content;
      if (!signal.aborted) onText(text);
    } else if (event.type === 'usage' && event.usage) usage = event.usage;
    else if (event.type === 'message_stop') stopped = true;
    else if (event.type === 'error') throw new Error(event.error || 'The tutor could not answer');
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
  if (signal.aborted) return null;
  if (!stopped) throw new Error('The reply was interrupted. Please try again.');
  return { text, ...(usage ? { usage } : {}) };
}
