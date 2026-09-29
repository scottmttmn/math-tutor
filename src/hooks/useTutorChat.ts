'use client';

import { useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { getModelConfig } from '@/lib/modelConfig';
import { recordTutorUsage, tryStartTutorRequest, useRateLimit } from '@/hooks/useRateLimit';
import { RATE_LIMIT_MS } from '@/lib/constants';
import type { ChatMessage, TutorStreamEvent, WorkbookContext } from '@/types';

export function useTutorChat(workbookContext?: WorkbookContext) {
  const { problemStatement, problemImage, chatHistory, isStreaming, sessionType } = useSessionState();
  const dispatch = useSessionDispatch();
  const { isLimited } = useRateLimit(RATE_LIMIT_MS);
  const pendingRequest = useRef<AbortController | null>(null);

  useEffect(() => () => { pendingRequest.current?.abort(); }, []);

  const sendHelp = useCallback(async (canvasImage: string, question?: string): Promise<boolean> => {
    if (isStreaming || pendingRequest.current || !tryStartTutorRequest()) return false;
    const abort = new AbortController();
    pendingRequest.current = abort;
    const userContent = question || 'I need help with this part of my work.';
    const userMessage: ChatMessage = {
      id: uuidv4(), role: 'user', content: userContent, timestamp: Date.now(),
      imagePreview: canvasImage ? '[Canvas snapshot sent]' : undefined,
    };
    dispatch({ type: 'ADD_MESSAGE', message: userMessage });
    dispatch({ type: 'ADD_MESSAGE', message: { id: uuidv4(), role: 'assistant', content: '', timestamp: Date.now(), pending: true } });
    dispatch({ type: 'SET_STREAMING', streaming: true });

    const append = (content: string) => {
      if (!abort.signal.aborted) dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content });
    };
    try {
      const response = await fetch('/api/tutor', {
        method: 'POST', signal: abort.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemStatement, chatHistory: chatHistory.filter((message) => message.content.trim()),
          canvasImage, modelConfig: getModelConfig(), userQuestion: userContent,
          problemImage: problemImage ?? undefined, sessionType, workbookContext,
        }),
      });
      if (!response.ok) {
        if (response.status === 429) recordTutorUsage();
        throw new Error(await response.text() || response.statusText);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');
      const decoder = new TextDecoder();
      let buffer = '';
      let hadError = false;
      let stopped = false;
      const readEvent = (frame: string) => {
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        const event: TutorStreamEvent = JSON.parse(data);
        if (event.type === 'text_delta' && event.content) append(event.content);
        else if (event.type === 'usage' && event.usage) {
          if (!abort.signal.aborted) dispatch({ type: 'SET_LAST_MESSAGE_USAGE', usage: event.usage });
        }
        else if (event.type === 'message_stop') stopped = true;
        else if (event.type === 'error') {
          hadError = true;
          append(`\n\nError: ${event.error || 'Tutor request failed'}`);
        }
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
      if (!stopped && !hadError) throw new Error('The tutor response was interrupted. Please try again.');
      return !hadError && !abort.signal.aborted;
    } catch (error) {
      append(`\n\nError: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
    } finally {
      pendingRequest.current = null;
      if (!abort.signal.aborted) dispatch({ type: 'SET_STREAMING', streaming: false });
    }
  }, [problemStatement, problemImage, chatHistory, isStreaming, sessionType, workbookContext, dispatch]);

  const sendFollowUp = useCallback(async (text: string, canvasImage = ''): Promise<boolean> => {
    if (!text.trim()) return false;
    return sendHelp(canvasImage, text.trim());
  }, [sendHelp]);

  return { sendHelp, sendFollowUp, isStreaming, isLimited };
}
