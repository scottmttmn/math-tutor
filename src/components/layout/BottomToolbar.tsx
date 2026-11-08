'use client';

import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useCanvasState } from '@/context/CanvasContext';
import { useRateLimit } from '@/hooks/useRateLimit';
import { useScratchOutOff } from '@/hooks/useInkBoardChoice';
import { RATE_LIMIT_MS } from '@/lib/constants';
import type { Paper, SessionType } from '@/types';
import { PAPERS } from '@/lib/paper';
import MoreMenu from '@/components/common/MoreMenu';
import { useCopiedPicture } from '@/hooks/useCopiedPicture';
import { BroomIcon, FullScreenIcon, PaperIcon, PasteIcon, SolvedCheck, TutorIcon, UnsolvedCheck } from '@/components/common/Icons';
import { InBoardHeader, useBoardRail } from './BoardRail';

// The board's rail (BoardFrame): the tutor, InkBoard's tools (portaled in), paper, clear and the Board menu.
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
  /** Shows Add picture… on an ink board: an image or a PDF's first page, put on the board. */
  onAddPicture?: (file: File) => void;
  /** Shows Paste in an ink board's rail while part of a PDF page is copied: puts it on the board. */
  onPastePicture?: () => void;
  /** Shows Paper, which picks the board's paper: blank, lined or grid. */
  paper?: { value: Paper; onChange: (paper: Paper) => void };
  /** The Favorite button (FavoriteButton), shown beside Mark solved on problems. */
  favorite?: ReactNode;
}

export default function BottomToolbar({ onAskForHelp, checkInLabel, onClear, isStreaming, isSolved, onToggleSolved, sessionType, fullScreen, tools, tutor, onSaveAs, onWriteUp, onAddPicture, onPastePicture, paper, favorite }: Props) {
  const pictureInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { hasContent } = useCanvasState();
  const [scratchOff, toggleScratchOff] = useScratchOutOff();
  const rail = useBoardRail();
  const copied = useCopiedPicture();
  const { isLimited } = useRateLimit(RATE_LIMIT_MS);
  const helpDisabled = isLimited || isStreaming;
  const askClass = 'flex items-center gap-1.5 min-h-11 px-4 text-sm font-semibold text-white bg-indigo-700 rounded-lg hover:bg-indigo-800 disabled:bg-gray-200 disabled:text-gray-500 disabled:cursor-not-allowed';
  const plain = 'flex shrink-0 items-center justify-center gap-1.5 min-h-11 min-w-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';
  const square = `${plain} w-11 p-0`;
  // Part of a PDF page copied on the page: Paste puts it on this board.
  const pasteButton = copied && onPastePicture && (
    <button onClick={onPastePicture} disabled={isStreaming} className={square} aria-label="Paste" title={`Paste: ${copied.from}`} data-testid="paste-picture">
      <PasteIcon />
    </button>
  );
  const paperLabel = PAPERS.find((item) => item.paper === paper?.value)?.label ?? 'Blank';

  const fullScreenButton = fullScreen && (
    <button
      onClick={fullScreen.toggle}
      aria-pressed={fullScreen.on}
      className={square}
      aria-label={fullScreen.on ? 'Exit full screen' : 'Full screen'}
      title={fullScreen.on ? 'Exit full screen' : 'Full screen'}
    >
      <FullScreenIcon />
    </button>
  );

  const paperMenu = paper && (
    <MoreMenu
      label={`Paper: ${paperLabel}`}
      title={`Paper: ${paperLabel}`}
      button={<PaperIcon paper={paper.value} />}
      buttonClassName={square}
      side
      align="left"
      menuClassName="w-56 p-2 grid grid-cols-3 gap-1"
      items={PAPERS.map((item) => ({
        label: item.label, role: 'menuitemradio', checked: paper.value === item.paper,
        onSelect: () => paper.onChange(item.paper),
        content: <><PaperIcon paper={item.paper} size={30} /><span>{item.label}</span></>,
        className: `flex flex-col items-center justify-center gap-1 min-h-20 text-sm rounded-lg border-2 ${paper.value === item.paper ? 'border-gray-900' : 'border-transparent hover:bg-gray-100'}`,
      }))}
    />
  );

  const clearButton = (
    <button onClick={onClear} disabled={!hasContent} className={square} aria-label="Clear board" title="Clear board">
      <BroomIcon />
    </button>
  );

  const addPicture = onAddPicture;
  const boardMenu = (tools || onWriteUp || onSaveAs) && (
    <>
    {addPicture && (
      <input
        ref={pictureInput}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        data-testid="add-picture"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) addPicture(file);
        }}
      />
    )}
    <MoreMenu
      label="Board menu"
      title="Board menu"
      button={<span aria-hidden="true">⋯</span>}
      buttonClassName={square}
      side
      align="left"
      items={[
        ...(addPicture ? [{ label: 'Add picture…', disabled: isStreaming, onSelect: () => pictureInput.current?.click() }] : []),
        { label: 'Scratch out to erase', separatorBefore: Boolean(addPicture), role: 'menuitemcheckbox', checked: !scratchOff, onSelect: toggleScratchOff },
        ...(tools ? [{ label: 'Hide tool rail', role: 'menuitemcheckbox' as const, checked: tools.hidden, onSelect: tools.toggle }] : []),
        // The Android app has no address bar, so the pen test is reached from here.
        { label: 'Pen test…', disabled: isStreaming, onSelect: () => router.push('/pen-test') },
        ...(onWriteUp ? [{ label: 'TeX write-up…', separatorBefore: Boolean(tools), onSelect: onWriteUp }] : []),
        ...(onSaveAs ? [
          { label: 'Save as PNG', separatorBefore: Boolean(tools && !onWriteUp), disabled: !hasContent, onSelect: () => onSaveAs('png') },
          { label: 'Save as PDF', disabled: !hasContent, onSelect: () => onSaveAs('pdf') },
        ] : []),
      ]}
    />
    </>
  );

  // Solved: only for problems. A filled ink check once solved; no color.
  const solvedButton = sessionType === 'problem' && (
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
  );

  // Opening the drawer is always available, including during a reply or rate limit.
  const tutorButton = !checkInLabel && tutor && (
    <button
      onClick={() => {
        // Full screen hides the tutor, so opening it leaves full screen (as Ask tutor does).
        if (fullScreen?.on) { fullScreen.toggle(); if (!tutor.open) tutor.toggle(); }
        else tutor.toggle();
      }}
      aria-pressed={tutor.open && !fullScreen?.on}
      aria-label="Ask tutor"
      className={`flex shrink-0 items-center justify-center gap-1.5 min-h-11 w-11 text-sm font-semibold border-2 border-indigo-700 rounded-lg ${
        tutor.open && !fullScreen?.on ? 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' : 'bg-indigo-700 text-white hover:bg-indigo-800'
      }`}
      title="Ask tutor"
    >
      <TutorIcon />
    </button>
  );

  const checkInButton = checkInLabel && (
    <button
      onClick={() => onAskForHelp()}
      disabled={helpDisabled}
      title={isLimited ? 'Please wait a moment before asking again.' : 'Ask the tutor about your board'}
      aria-label={checkInLabel}
      className={`${askClass} w-11 justify-center px-0`}
    >
      <TutorIcon />
    </button>
  );

  // A rail down the board's left, the tutor at its top, away from a resting hand; the ink tools go
  // in the middle (InkBoard puts them there). Favorite, Mark solved and Full screen go in the
  // board's header. Hidden, only those stay, and a tab brings the rail back.
  const divider = <div aria-hidden="true" className="w-7 my-0.5 border-t border-gray-200" />;
  return (
    <>
      {/* A short board (a panel above it, a landscape phone) scrolls the rail; its menus are placed on the screen. */}
      {!tools?.hidden && (
        <div role="group" aria-label="Board controls" className="flex flex-col items-center gap-1 w-12 shrink-0 py-1.5 overflow-y-auto overscroll-contain border-r border-gray-200 bg-white">
          {tutorButton}{checkInButton}
          {divider}
          <div ref={rail?.setTools} className="contents" />
          {pasteButton}
          {divider}
          {paperMenu}
          {clearButton}
          {boardMenu}
          {fullScreen?.on && fullScreenButton}
        </div>
      )}
      {rail?.header && createPortal(
        <InBoardHeader.Provider value={true}>
          {sessionType === 'problem' && favorite}
          {solvedButton}
          {!fullScreen?.on && fullScreenButton}
        </InBoardHeader.Provider>,
        rail.header,
      )}
    </>
  );
}
