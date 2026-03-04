'use client';

import { useState, useEffect } from 'react';
import { useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

export default function ChatInput() {
  const [text, setText] = useState('');
  const { chatHistory, isStreaming } = useSessionState();
  const { sendFollowUp } = useTutorChat();
  const { isListening, transcript, isSupported, error, startListening, stopListening, resetTranscript } =
    useSpeechRecognition();

  // Sync live transcript into the text field while listening
  useEffect(() => {
    if (isListening && transcript) {
      setText(transcript);
    }
  }, [transcript, isListening]);

  const canSend = text.trim().length > 0 && !isStreaming && chatHistory.length > 0;
  const inputDisabled = isStreaming || chatHistory.length === 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    if (isListening) stopListening();
    const msg = text;
    setText('');
    resetTranscript();
    await sendFollowUp(msg);
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
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={chatHistory.length === 0 ? 'Ask for help first...' : 'Type or speak a follow-up...'}
          disabled={inputDisabled}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
        />
        {isSupported && (
          <button
            type="button"
            onClick={handleMicClick}
            disabled={inputDisabled}
            title={isListening ? 'Stop recording' : 'Speak a question'}
            className={`relative p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              isListening
                ? 'bg-red-100 text-red-600 hover:bg-red-200'
                : 'text-gray-500 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {isListening && (
              <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            )}
            <MicIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={!canSend}
          className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
      {error && (
        <p className="mt-1 text-xs text-red-500">{error}</p>
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
