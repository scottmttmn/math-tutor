'use client';

import { useRef, useEffect } from 'react';
import { useSessionState } from '@/context/SessionContext';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { BookContext, TutorBoardImages } from '@/types';

const QUESTION_ID = 'tutor-question';

interface ChatPanelProps {
  /** Current board images, attached to every question because history contains text only. */
  getBoardImages?: () => Promise<TutorBoardImages>;
  getBookContext?: () => Promise<BookContext | null>;
  onAskForHelp?: (question: string) => Promise<void>;
}

export default function ChatPanel({ getBoardImages, getBookContext, onAskForHelp }: ChatPanelProps) {
  const { chatHistory, isStreaming, conversationKey } = useSessionState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  return (
    // Sits in the board's tutor column, which carries the heading.
    <div className="flex flex-col h-full bg-white">

      <div ref={scrollRef} aria-busy={isStreaming} className="flex-1 overflow-y-auto px-3 py-3">
        {chatHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-sm text-gray-500 px-4">
            <p>
              The tutor will look at your board or selection.
            </p>
          </div>
        ) : (
          chatHistory.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
      </div>

      <ChatInput key={conversationKey} id={QUESTION_ID} getBoardImages={getBoardImages} getBookContext={getBookContext} onAskForHelp={onAskForHelp} />
    </div>
  );
}
