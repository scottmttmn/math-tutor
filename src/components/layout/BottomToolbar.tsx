'use client';

import type { ReactNode } from 'react';
import { useCanvasState } from '@/context/CanvasContext';
import { useRateLimit } from '@/hooks/useRateLimit';
import { useNotebookMode } from '@/hooks/useNotebookMode';
import { useBooxPenAvailable, useBooxPenMode } from '@/hooks/useBooxPen';
import { RATE_LIMIT_MS } from '@/lib/constants';
import type { Paper, SessionType } from '@/types';
import { PAPERS } from '@/lib/paper';
import MoreMenu from '@/components/common/MoreMenu';
import { BroomIcon, FullScreenIcon, PaperIcon, SolvedCheck, TutorIcon, UnsolvedCheck } from '@/components/common/Icons';

// Drawing tools, colors and undo live in tldraw's own toolbar on the canvas.
interface Props {
  /** Asks the tutor about the board; `question` is a direct check-in action, if any. */
  onAskForHelp: (question?: string) => void;
  /** A check-in sends directly instead of opening the drawer's choices. */
  checkInLabel?: 'Start check-in' | 'Hand in answer';
  onClear: () => void;
  isStreaming: boolean;
  isSolved: boolean;
  onToggleSolved: () => void;
  sessionType: SessionType;
  /** Shows the Full screen button (see useBoardFullScreen). */
  fullScreen?: { on: boolean; toggle: () => void };
  /** Shows the Hide tools button (see useToolsHidden). */
  tools?: { hidden: boolean; toggle: () => void };
  /** The Ask tutor toggle, which opens and closes the tutor beside the board. */
  tutor?: { open: boolean; toggle: () => void };
  /** Shows Save as, which saves the whole board as a PNG or a PDF. */
  onSaveAs?: (format: 'png' | 'pdf') => void;
  /** Shows TeX write-up, which opens the board's LaTeX write-up. */
  onWriteUp?: () => void;
  /** Shows Paper, which picks the board's paper: blank, lined or grid. */
  paper?: { value: Paper; onChange: (paper: Paper) => void };
  onFitWidth?: () => void;
  /** The Favorite button (FavoriteButton), shown beside Mark solved on problems. */
  favorite?: ReactNode;
}

export default function BottomToolbar({ onAskForHelp, checkInLabel, onClear, isStreaming, isSolved, onToggleSolved, sessionType, fullScreen, tools, tutor, onSaveAs, onWriteUp, paper, onFitWidth, favorite }: Props) {
  const { notebook, toggleNotebook } = useNotebookMode();
  const [booxPen, toggleBooxPen] = useBooxPenMode();
  const booxAvailable = useBooxPenAvailable();
  const { hasContent } = useCanvasState();
  const { isLimited } = useRateLimit(RATE_LIMIT_MS);
  const helpDisabled = isLimited || isStreaming;
  const askClass = 'flex items-center gap-1.5 min-h-11 px-4 text-sm font-semibold text-white bg-indigo-700 rounded-lg hover:bg-indigo-800 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed';
  const plain = 'flex shrink-0 items-center justify-center gap-1.5 min-h-11 min-w-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';
  const square = `${plain} w-11 p-0`;
  const paperLabel = PAPERS.find((item) => item.paper === paper?.value)?.label ?? 'Blank';

  return (
    <div role="group" aria-label="Board controls" className="flex items-center gap-1.5 lg:gap-2 px-2 lg:px-3 py-2 border-t border-gray-200 bg-white flex-wrap">
      {fullScreen && (
        <button
          onClick={fullScreen.toggle}
          aria-pressed={fullScreen.on}
          className={square}
          aria-label={fullScreen.on ? 'Exit full screen' : 'Full screen'}
          title={fullScreen.on ? 'Exit full screen' : 'Full screen'}
        >
          <FullScreenIcon />
        </button>
      )}

      {paper && (
        <MoreMenu
          label={`Paper: ${paperLabel}`}
          title={`Paper: ${paperLabel}`}
          button={<PaperIcon paper={paper.value} />}
          buttonClassName={square}
          above
          align="left"
          menuClassName="w-56 p-2 grid grid-cols-3 gap-1"
          items={PAPERS.map((item) => ({
            label: item.label, role: 'menuitemradio', checked: paper.value === item.paper,
            onSelect: () => paper.onChange(item.paper),
            content: <><PaperIcon paper={item.paper} size={30} /><span>{item.label}</span></>,
            className: `flex flex-col items-center justify-center gap-1 min-h-20 text-sm rounded-lg border-2 ${paper.value === item.paper ? 'border-gray-900' : 'border-transparent hover:bg-gray-100'}`,
          }))}
        />
      )}

      <button onClick={onClear} disabled={!hasContent} className={square} aria-label="Clear board" title="Clear board">
        <BroomIcon />
      </button>

      {notebook && onFitWidth && <button onClick={onFitWidth} className={plain} title="Return to notebook writing width">Fit width</button>}

      {(tools || onWriteUp || onSaveAs) && (
        <MoreMenu
          label="Board menu"
          title="Board menu"
          button={<><span className="hidden lg:inline">Board</span><span aria-hidden="true">⋯</span></>}
          buttonClassName={plain}
          above
          align="left"
          items={[
            { label: 'Notebook mode (experiment)', role: 'menuitemcheckbox', checked: notebook, onSelect: toggleNotebook },
            ...(booxAvailable ? [{ label: 'BOOX pen (experiment)', role: 'menuitemcheckbox' as const, checked: booxPen, onSelect: toggleBooxPen }] : []),
            ...(tools ? [{ label: 'Hide drawing tools', role: 'menuitemcheckbox' as const, checked: tools.hidden, onSelect: tools.toggle }] : []),
            ...(onWriteUp ? [{ label: 'TeX write-up…', separatorBefore: Boolean(tools), onSelect: onWriteUp }] : []),
            ...(onSaveAs ? [
              { label: 'Save as PNG', separatorBefore: Boolean(tools && !onWriteUp), disabled: !hasContent, onSelect: () => onSaveAs('png') },
              { label: 'Save as PDF', disabled: !hasContent, onSelect: () => onSaveAs('pdf') },
            ] : []),
          ]}
        />
      )}

      <div className="flex-1" />

      {sessionType === 'problem' && favorite}

      {/* Solved: only for problems. A filled ink check once solved; no color. */}
      {sessionType === 'problem' && (
        <button
          onClick={onToggleSolved}
          aria-pressed={isSolved}
          aria-label={isSolved ? 'Solved' : 'Mark solved'}
          className={`flex items-center gap-1.5 min-h-11 px-3 text-sm rounded-lg bg-white hover:bg-gray-50 ${
            isSolved ? 'font-semibold text-gray-900 border-2 border-gray-900' : 'text-gray-800 border border-gray-300'
          }`}
          title={isSolved ? 'Mark it as not solved yet' : 'Mark this problem as solved'}
        >
          {isSolved ? <SolvedCheck /> : <UnsolvedCheck />}
          <span className="lg:hidden">Solved</span><span className="hidden lg:inline">{isSolved ? 'Solved' : 'Mark solved'}</span>
        </button>
      )}

      {/* Opening the drawer is always available, including during a reply or rate limit. */}
      {!checkInLabel && tutor && (
        <button
          onClick={() => {
            // Full screen hides the tutor, so opening it leaves full screen (as Ask tutor does).
            if (fullScreen?.on) { fullScreen.toggle(); if (!tutor.open) tutor.toggle(); }
            else tutor.toggle();
          }}
          aria-pressed={tutor.open && !fullScreen?.on}
          aria-label="Ask tutor"
          className={`flex shrink-0 items-center gap-1.5 min-h-11 px-4 text-sm font-semibold border-2 border-indigo-700 rounded-lg ${
            tutor.open && !fullScreen?.on ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-indigo-700 text-white hover:bg-indigo-800'
          }`}
          title="Ask tutor"
        >
          <TutorIcon />Ask tutor
        </button>
      )}

      {checkInLabel && (
        <button
          onClick={() => onAskForHelp()}
          disabled={helpDisabled}
          title={isLimited ? 'Please wait a moment before asking again.' : 'Ask the tutor about your board'}
          className={askClass}
        >
          <TutorIcon />
          {checkInLabel}
        </button>
      )}
    </div>
  );
}
