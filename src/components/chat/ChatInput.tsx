'use client';

import { useEffect, useRef, useState } from 'react';
import { useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { BookContext, TutorBoardImages } from '@/types';
import ChatTextarea from '@/components/chat/ChatTextarea';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { askChoices, askQuestion } from '@/lib/tutorAsk';
import type { TutorIntent } from '@/types';

interface ChatInputProps {
  visible?: boolean;
  /** Current board images for every question, including a follow-up without new ink. */
  getBoardImages?: () => Promise<TutorBoardImages>;
  /** The Shelf pages the tutor reads with the follow-up, if any. */
  getBookContext?: () => Promise<BookContext | null>;
  /** The chat box's id. */
  id?: string;
  onAskForHelp?: (question: string) => Promise<void>;
}

export default function ChatInput({ visible = true, id, getBoardImages, getBookContext, onAskForHelp }: ChatInputProps) {
  const [text, setText] = useState('');
  const [sendError, setSendError] = useState('');
  const [capturing, setCapturing] = useState(false);
  const submitting = useRef(false);
  const { chatHistory, isStreaming, sessionType, checkIn } = useSessionState();
  const { sendFollowUp, isLimited } = useTutorChat(getBookContext);
  const { isListening, isSupported, error, startListening, stopListening, resetTranscript } =
    useSpeechRecognition(setText);

  useEffect(() => {
    if (!visible) stopListening();
  }, [visible, stopListening]);

  // A custom question can open the conversation too; it always takes the board.
  const canSend = text.trim().length > 0 && !isStreaming && !isLimited && !capturing;
  const inputDisabled = isStreaming || capturing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || submitting.current || getTutorWaitMs() > 0) return;
    submitting.current = true;
    if (isListening) stopListening();
    const msg = text;
    setSendError('');
    setCapturing(true);
    try {
      const images = await getBoardImages?.() ?? { canvasImage: '' };
      setText('');
      resetTranscript();
      await sendFollowUp(msg, images);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The board image could not be captured. Please try again.');
    } finally {
      setCapturing(false);
      submitting.current = false;
    }
  };

  const handleChoice = async (intent: TutorIntent) => {
    if (!onAskForHelp || isStreaming || submitting.current || getTutorWaitMs() > 0) return;
    submitting.current = true;
    setSendError('');
    setCapturing(true);
    try {
      await onAskForHelp(askQuestion(intent, sessionType));
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'The board image could not be captured. Please try again.');
    } finally {
      setCapturing(false);
      submitting.current = false;
    }
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
      {onAskForHelp && !checkIn && (
        <div role="group" aria-label="Tutor choices" className="flex flex-wrap gap-2 mb-2">
          {askChoices(sessionType).map((choice) => (
            <button key={choice.intent} type="button" onClick={() => void handleChoice(choice.intent)}
              disabled={isStreaming || isLimited || capturing}
              className={`flex-1 min-h-11 px-3 text-sm font-medium text-indigo-700 border border-indigo-700 rounded-lg hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed ${chatHistory.length === 0 ? 'py-3' : ''}`}>
              {choice.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <ChatTextarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask your own question…"
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
      {sendError && <p role="alert" className="mt-1 text-xs text-red-700">{sendError}</p>}
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
