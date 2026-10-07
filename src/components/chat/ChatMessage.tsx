'use client';

import type { ChatMessage as ChatMessageType } from '@/types';
import TutorContent from './TutorContent';
import { CHATGPT_USAGE_URL } from '@/lib/constants';

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`min-w-0 max-w-[85%] overflow-x-auto px-3 py-2 rounded-lg text-sm leading-relaxed ${
          isUser
            ? 'bg-blue-500 text-white rounded-br-sm'
            : 'bg-gray-100 text-gray-800 rounded-bl-sm'
        }`}
      >
        {message.imagePreview && (
          <div className="mb-1 text-xs opacity-75">
            [Canvas snapshot sent]
          </div>
        )}
        {message.model && <div className="mb-1 text-xs text-gray-500">Answered with {message.model} after a quota limit</div>}
        <TutorContent content={message.content} markdown={!isUser} />
        {message.usage && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-200 text-xs text-gray-500">
            {(message.usage.inputTokens + message.usage.outputTokens).toLocaleString()} tokens on your ChatGPT plan ·{' '}
            <a href={CHATGPT_USAGE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">
              Manage usage
            </a>
          </div>
        )}
        {!message.content && (
          <div className="flex gap-1 py-1">
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>
    </div>
  );
}
