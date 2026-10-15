'use client';

import { useCanvasState } from '@/context/CanvasContext';
import { useRateLimit } from '@/hooks/useRateLimit';
import { RATE_LIMIT_MS } from '@/lib/constants';
import type { SessionType } from '@/types';
import MoreMenu from '@/components/common/MoreMenu';
import { FullScreenIcon, SolvedCheck, TutorIcon, UnsolvedCheck } from '@/components/common/Icons';

// Drawing tools, colors and undo live in tldraw's own toolbar on the canvas.
interface Props {
  onAskForHelp: () => void;
  onClear: () => void;
  isStreaming: boolean;
  isSolved: boolean;
  onToggleSolved: () => void;
  sessionType: SessionType;
  /** Shows the Full screen button (see useBoardFullScreen). */
  fullScreen?: { on: boolean; toggle: () => void };
  /** Shows the Hide tools button (see useToolsHidden). */
  tools?: { hidden: boolean; toggle: () => void };
  /** Shows the Tutor button, which opens and closes the tutor beside the board. */
  tutor?: { open: boolean; toggle: () => void };
  /** Shows Save as, which saves the whole board as a PNG or a PDF. */
  onSaveAs?: (format: 'png' | 'pdf') => void;
  /** Shows TeX write-up, which opens the board's LaTeX write-up. */
  onWriteUp?: () => void;
}

export default function BottomToolbar({ onAskForHelp, onClear, isStreaming, isSolved, onToggleSolved, sessionType, fullScreen, tools, tutor, onSaveAs, onWriteUp }: Props) {
  const { hasContent } = useCanvasState();
  const { isLimited } = useRateLimit(RATE_LIMIT_MS);
  const helpDisabled = isLimited || isStreaming;
  const plain = 'flex items-center gap-1.5 min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 bg-white flex-wrap">
      {fullScreen && (
        <button
          onClick={fullScreen.toggle}
          aria-pressed={fullScreen.on}
          className={plain}
          title={fullScreen.on ? 'Show the rest of the page again (Esc)' : 'Give the board the whole screen'}
        >
          <FullScreenIcon />
          {fullScreen.on ? 'Exit full screen' : 'Full screen'}
        </button>
      )}

      {tools && (
        <button
          onClick={tools.toggle}
          aria-pressed={tools.hidden}
          className={plain}
          title={tools.hidden ? 'Show the drawing tools and colors' : 'Hide the drawing tools and colors; the pen keeps writing'}
        >
          {tools.hidden ? 'Show tools' : 'Hide tools'}
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {onWriteUp && (
        <button onClick={onWriteUp} className={plain} title="Turn the handwriting into a LaTeX document you can edit and download">
          TeX write-up
        </button>
      )}

      {onSaveAs && (
        <MoreMenu
          label="Save board as"
          button="Save as…"
          above
          disabled={!hasContent}
          items={[
            { label: 'PNG picture', onSelect: () => onSaveAs('png') },
            { label: 'PDF', onSelect: () => onSaveAs('pdf') },
          ]}
        />
      )}

      <button onClick={onClear} disabled={!hasContent} className={plain} title="Erase the whole board (undo with Ctrl+Z)">
        Clear
      </button>

      {/* Solved: only for problems. A filled ink check once solved; no color. */}
      {sessionType === 'problem' && (
        <button
          onClick={onToggleSolved}
          aria-pressed={isSolved}
          className={`flex items-center gap-1.5 min-h-11 px-3 text-sm rounded-lg bg-white hover:bg-gray-50 ${
            isSolved ? 'font-semibold text-gray-900 border-2 border-gray-900' : 'text-gray-800 border border-gray-300'
          }`}
          title={isSolved ? 'Mark it as not solved yet' : 'Mark this problem as solved'}
        >
          {isSolved ? <SolvedCheck /> : <UnsolvedCheck />}
          {isSolved ? 'Solved' : 'Mark solved'}
        </button>
      )}

      {/* The tutor's controls are the only ones in its color. */}
      {tutor && (
        <button
          onClick={() => {
            // Full screen hides the tutor, so opening it leaves full screen (as Ask tutor does).
            if (fullScreen?.on) { fullScreen.toggle(); if (!tutor.open) tutor.toggle(); }
            else tutor.toggle();
          }}
          aria-pressed={tutor.open && !fullScreen?.on}
          className={`flex items-center gap-1.5 min-h-11 px-3 text-sm text-indigo-700 border rounded-lg ${
            tutor.open && !fullScreen?.on ? 'bg-indigo-50 border-indigo-700' : 'bg-white border-gray-300 hover:bg-indigo-50'
          }`}
          title={tutor.open ? 'Close the tutor' : 'Show the conversation with the tutor'}
        >
          Tutor
        </button>
      )}

      <button
        onClick={onAskForHelp}
        disabled={helpDisabled}
        title={isLimited ? 'Please wait a moment before asking again.' : sessionType === 'note' ? 'Ask the tutor about these notes' : 'Ask the tutor for a hint'}
        className="flex items-center gap-1.5 min-h-11 px-4 text-sm font-semibold text-white bg-indigo-700 rounded-lg hover:bg-indigo-800 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed"
      >
        <TutorIcon />
        Ask tutor
      </button>
    </div>
  );
}
