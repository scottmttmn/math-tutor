'use client';

import type { AutosaveStatus, SessionType } from '@/types';
import AppBar from './AppBar';

interface Props {
  onNew: (type: SessionType) => void;
  saveStatus: AutosaveStatus;
  onSave: () => Promise<unknown>;
  chatOpen: boolean;
  onToggleChat: () => void;
  /** A tutor reply is streaming in; leaving or starting a new board would lose it. */
  isStreaming: boolean;
}

/** The app bar on a free board, with its save status and the chat toggle. */
export default function TopBar({ onNew, saveStatus, onSave, chatOpen, onToggleChat, isStreaming }: Props) {
  return (
    // Save before leaving, so Home lists the latest work.
    <AppBar place="board" onNew={onNew} locked={isStreaming} beforeLeave={onSave}>
      {/* Sessions save themselves; this only reports it, or offers a retry after a failure. */}
      {saveStatus === 'error' ? (
        <button
          onClick={() => void onSave()}
          className="min-h-10 px-3 text-sm font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100"
          title="Your latest changes aren't saved"
        >
          Couldn&apos;t save · Retry
        </button>
      ) : (
        <span role="status" className="w-14 text-center text-xs text-gray-400">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''}
        </span>
      )}
      <button
        onClick={onToggleChat}
        title={chatOpen ? 'Hide chat' : 'Show chat'}
        aria-pressed={chatOpen}
        className={`flex items-center gap-1 min-h-10 px-3 text-sm font-medium rounded-lg border transition-colors ${
          chatOpen ? 'bg-blue-50 text-blue-600 border-blue-200' : 'text-gray-600 border-gray-300 hover:bg-gray-50'
        }`}
      >
        <ChatIcon />
        Chat
      </button>
    </AppBar>
  );
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 10a2 2 0 0 1-2 2H5l-3 3V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v7z" />
    </svg>
  );
}
