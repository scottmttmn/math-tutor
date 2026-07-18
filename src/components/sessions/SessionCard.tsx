'use client';

import type { SessionMetadata } from '@/types';

interface Props {
  session: SessionMetadata;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function SessionCard({ session, onLoad, onDelete }: Props) {
  const date = new Date(session.updatedAt);
  const dateStr = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const isNote = session.sessionType === 'note';
  const borderClass = session.isSolved
    ? 'border-green-300 bg-green-50 hover:bg-green-100'
    : isNote
    ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
    : 'border-gray-200 hover:bg-gray-50';

  return (
    <div className={`flex items-center justify-between p-3 border rounded-lg ${borderClass}`}>
      <div className="flex-1 min-w-0 mr-3">
        <div className="flex items-center gap-2">
          <span className="text-sm shrink-0" title={isNote ? 'Notes' : 'Problem'}>
            {isNote ? '📝' : '📐'}
          </span>
          <p className="text-sm font-medium text-gray-800 truncate">
            {session.title || 'Untitled'}
          </p>
          {session.isSolved && (
            <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full border border-green-200">
              ✓ Solved
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate mt-0.5">
          {session.problemStatement || (isNote ? 'No topic set' : 'No problem set')}
        </p>
        <p className="text-xs text-gray-400 mt-0.5">
          {dateStr} &middot; {session.messageCount} messages
        </p>
      </div>
      <div className="flex gap-1.5 shrink-0">
        <button
          onClick={() => onLoad(session.id)}
          className="px-2.5 py-1 text-xs font-medium bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Load
        </button>
        <button
          onClick={() => onDelete(session.id)}
          className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-600 rounded hover:bg-red-100"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
