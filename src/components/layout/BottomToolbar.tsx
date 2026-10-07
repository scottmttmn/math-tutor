'use client';

import { useCanvasState } from '@/context/CanvasContext';
import type { SessionType } from '@/types';

// Drawing tools, colors and undo live in tldraw's own toolbar on the canvas.
interface Props {
  onAskForHelp: () => void;
  onClear: () => void;
  isStreaming: boolean;
  isSolved: boolean;
  onToggleSolved: () => void;
  sessionType: SessionType;
  completionLabel?: 'attempt';
}

export default function BottomToolbar({ onAskForHelp, onClear, isStreaming, isSolved, onToggleSolved, sessionType, completionLabel }: Props) {
  const { hasContent } = useCanvasState();
  const helpDisabled = isStreaming;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-200 bg-white flex-wrap">
      {/* Spacer */}
      <div className="flex-1" />

      <button
        onClick={onClear}
        disabled={!hasContent}
        className="px-2 py-1 text-xs text-gray-600 rounded hover:bg-gray-100 disabled:opacity-30"
        title="Erase the whole canvas (undo with Ctrl+Z)"
      >
        Clear
      </button>

      {/* Mark Solved — only for problem sessions */}
      {sessionType === 'problem' && (
        <button
          onClick={onToggleSolved}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors border ${
            isSolved
              ? 'bg-green-500 text-white border-green-500 hover:bg-green-600'
              : 'text-gray-600 border-gray-300 hover:bg-gray-50'
          }`}
          title={completionLabel ? 'Toggle attempt completion' : isSolved ? 'Click to un-mark as solved' : 'Mark this problem as solved'}
        >
          <CheckIcon solved={isSolved} />
          {completionLabel ? isSolved ? 'Attempt complete' : 'Mark attempt complete' : isSolved ? 'Solved!' : 'Mark Solved'}
        </button>
      )}

      {/* Ask for Help / Ask About This */}
      <button
        onClick={onAskForHelp}
        disabled={helpDisabled}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          helpDisabled
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : sessionType === 'note'
            ? 'bg-blue-500 text-white hover:bg-blue-600'
            : 'bg-green-500 text-white hover:bg-green-600'
        }`}
      >
        {sessionType === 'note'
          ? 'Ask About This'
          : 'Ask for Help'}
      </button>
    </div>
  );
}

function CheckIcon({ solved }: { solved: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={solved ? 2.5 : 1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6.5" />
      <polyline points="5,8.5 7,10.5 11,6" />
    </svg>
  );
}
