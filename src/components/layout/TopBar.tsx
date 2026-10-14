'use client';

import type { AutosaveStatus, SessionType } from '@/types';
import AppBar from './AppBar';

interface Props {
  onNew: (type: SessionType) => void;
  saveStatus: AutosaveStatus;
  onSave: () => Promise<unknown>;
  /** A tutor reply is streaming in; leaving or starting a new board would lose it. */
  isStreaming: boolean;
}

/** The app bar on a free board, with its save status. */
export default function TopBar({ onNew, saveStatus, onSave, isStreaming }: Props) {
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
    </AppBar>
  );
}
