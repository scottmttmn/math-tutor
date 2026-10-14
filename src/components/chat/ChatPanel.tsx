'use client';

import { useRef, useEffect } from 'react';
import { useSessionState } from '@/context/SessionContext';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import type { BookContext } from '@/types';

interface ChatPanelProps {
  getCanvasImage?: () => Promise<string>;
  getBookContext?: () => Promise<BookContext | null>;
}

export default function ChatPanel({ getCanvasImage, getBookContext }: ChatPanelProps) {
  const { chatHistory } = useSessionState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  return (
    // Sits in the board's tutor column, which carries the heading.
    <div className="flex flex-col h-full bg-white">

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {chatHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-sm text-gray-500 px-4">
            <p>
              Write on the board, then press
              <strong className="text-indigo-700"> Ask tutor </strong>
              for a hint.
            </p>
          </div>
        ) : (
          chatHistory.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
      </div>

      <ChatInput getCanvasImage={getCanvasImage} getBookContext={getBookContext} />
    </div>
  );
}
