'use client';

import { useState } from 'react';
import { useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { BookContext } from '@/types';
import ChatTextarea from '@/components/chat/ChatTextarea';

interface ChatInputProps {
  /** Returns a snapshot to attach to the follow-up, or '' when the tutor has already seen the drawing. */
  getCanvasImage?: () => Promise<string>;
  /** The Shelf pages the tutor reads with the follow-up, if any. */
  getBookContext?: () => Promise<BookContext | null>;
}

export default function ChatInput({ getCanvasImage, getBookContext }: ChatInputProps) {
  const [text, setText] = useState('');
  const { chatHistory, isStreaming } = useSessionState();
  const { sendFollowUp, isLimited } = useTutorChat(getBookContext);
  const { isListening, isSupported, error, startListening, stopListening, resetTranscript } =
    useSpeechRecognition(setText);

  const canSend = text.trim().length > 0 && !isStreaming && !isLimited && chatHistory.length > 0;
  const inputDisabled = isStreaming || chatHistory.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    if (isListening) stopListening();
    const msg = text;
    setText('');
    resetTranscript();
    await sendFollowUp(msg, await getCanvasImage?.() ?? '');
  };

  const handleMicClick = () => {
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      startListening();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-gray-200">
      <div className="flex items-end gap-2">
        <ChatTextarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={chatHistory.length === 0 ? 'Ask the tutor first...' : 'Type or speak a follow-up...'}
          disabled={inputDisabled}
          className="flex-1 min-w-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
        />
        {isSupported && (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={inputDisabled}
            title={isListening ? 'Stop recording' : 'Speak a question'}
            aria-pressed={isListening}
            className={`relative flex items-center justify-center min-h-11 min-w-11 rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isListening ? 'bg-gray-900 text-white border-gray-900' : 'text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {isListening && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            )}
            <MicIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          title={isLimited ? 'Please wait a moment before asking again.' : undefined}
          className="min-h-11 px-3 text-sm font-semibold bg-indigo-700 text-white rounded-lg hover:bg-indigo-800 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-700">{error}</p>
      )}
    </form>
  );
}

function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1" width="6" height="9" rx="3" />
      <path d="M2 8a6 6 0 0 0 12 0" />
      <line x1="8" y1="14" x2="8" y2="16" />
      <line x1="5" y1="16" x2="11" y2="16" />
    </svg>
  );
}
