'use client';

import { useState } from 'react';
import { useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';

export default function ChatInput() {
  const [text, setText] = useState('');
  const { chatHistory, isStreaming } = useSessionState();
  const { sendFollowUp } = useTutorChat();

  const canSend = text.trim().length > 0 && !isStreaming && chatHistory.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    const msg = text;
    setText('');
    await sendFollowUp(msg);
  };

  return (
    <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-gray-200">
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={chatHistory.length === 0 ? 'Ask for help first...' : 'Type a follow-up...'}
          disabled={isStreaming || chatHistory.length === 0}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:bg-gray-50"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
    </form>
  );
}
