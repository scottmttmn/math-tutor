'use client';

import { useRef, useEffect } from 'react';
import { useSessionState } from '@/context/SessionContext';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';

export default function ChatPanel() {
  const { chatHistory } = useSessionState();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  return (
    <div className="flex flex-col h-full bg-white border-l border-gray-200">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-700">Tutor Chat</h2>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {chatHistory.length === 0 ? (
          <div className="flex items-center justify-center h-full text-center text-sm text-gray-400 px-4">
            <p>
              Draw your work on the canvas and click
              <strong className="text-gray-500"> Ask for Help </strong>
              to get hints from your AI tutor.
            </p>
          </div>
        ) : (
          chatHistory.map((msg) => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
      </div>

      <ChatInput />
    </div>
  );
}
