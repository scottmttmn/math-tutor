'use client';

import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useSessionState, useSessionDispatch } from '@/context/SessionContext';
import type { ChatMessage, TutorStreamEvent } from '@/types';

export function useTutorChat() {
  const { problemStatement, chatHistory, isStreaming } = useSessionState();
  const dispatch = useSessionDispatch();

  const sendHelp = useCallback(async (canvasImage: string): Promise<boolean> => {
    if (isStreaming) return false;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: 'I need help with this part of my work.',
      timestamp: Date.now(),
      imagePreview: canvasImage.length > 100 ? canvasImage.substring(0, 100) + '...' : canvasImage,
    };

    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    dispatch({ type: 'ADD_MESSAGE', message: userMessage });
    dispatch({ type: 'ADD_MESSAGE', message: assistantMessage });
    dispatch({ type: 'SET_STREAMING', streaming: true });

    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemStatement,
          chatHistory: chatHistory,
          canvasImage,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: `Error: ${errorText || response.statusText}` });
        dispatch({ type: 'SET_STREAMING', streaming: false });
        return false;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: 'Error: No response stream' });
        dispatch({ type: 'SET_STREAMING', streaming: false });
        return false;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event: TutorStreamEvent = JSON.parse(jsonStr);
            if (event.type === 'text_delta' && event.content) {
              dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: event.content });
            } else if (event.type === 'error') {
              dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: `\n\nError: ${event.error}` });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      dispatch({ type: 'SET_STREAMING', streaming: false });
      return true;
    } catch (error) {
      dispatch({
        type: 'APPEND_TO_LAST_MESSAGE',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      dispatch({ type: 'SET_STREAMING', streaming: false });
      return false;
    }
  }, [problemStatement, chatHistory, isStreaming, dispatch]);

  const sendFollowUp = useCallback(async (text: string): Promise<boolean> => {
    if (isStreaming || !text.trim()) return false;

    const userMessage: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: text.trim(),
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: uuidv4(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    dispatch({ type: 'ADD_MESSAGE', message: userMessage });
    dispatch({ type: 'ADD_MESSAGE', message: assistantMessage });
    dispatch({ type: 'SET_STREAMING', streaming: true });

    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemStatement,
          chatHistory: [...chatHistory, userMessage],
          canvasImage: '',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: `Error: ${errorText || response.statusText}` });
        dispatch({ type: 'SET_STREAMING', streaming: false });
        return false;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: 'Error: No response stream' });
        dispatch({ type: 'SET_STREAMING', streaming: false });
        return false;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event: TutorStreamEvent = JSON.parse(jsonStr);
            if (event.type === 'text_delta' && event.content) {
              dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: event.content });
            } else if (event.type === 'error') {
              dispatch({ type: 'APPEND_TO_LAST_MESSAGE', content: `\n\nError: ${event.error}` });
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      dispatch({ type: 'SET_STREAMING', streaming: false });
      return true;
    } catch (error) {
      dispatch({
        type: 'APPEND_TO_LAST_MESSAGE',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
      dispatch({ type: 'SET_STREAMING', streaming: false });
      return false;
    }
  }, [problemStatement, chatHistory, isStreaming, dispatch]);

  return { sendHelp, sendFollowUp, isStreaming };
}
