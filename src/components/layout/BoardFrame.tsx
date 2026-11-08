'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { TutorIcon } from '@/components/common/Icons';
import { BoardRailContext } from './BoardRail';

// Tailwind's 2xl: wide enough for the source, the board and the tutor side by side.
const WIDE_QUERY = '(min-width: 96rem)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isWide = () => window.matchMedia(WIDE_QUERY).matches;
// Below Tailwind's lg (an upright tablet, a phone): too narrow for a page beside the board.
const NARROW_QUERY = '(max-width: 63.99rem)';
const subscribeNarrow = (onChange: () => void) => {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

interface Props {
  fullScreen: boolean;
  /**
   * What the board works from, shown beside it (above it on an upright tablet): a book page, an
   * exercise, the typed problem. `wide` gives it half the width, for a PDF page.
   */
  source?: {
    /** `toolbar` is a column of controls, shown down the source's left. */
    label: string; content: ReactNode; toolbar?: ReactNode; wide?: boolean;
    /**
     * On a narrow screen, swap rather than stack: the board gets the screen, and a button named
     * `label` (e.g. "Page 47") flips to the source, which has a way back. `key` names the open
     * board, so another one opens on its board. Full screen swaps at any width. `railLabel` is
     * its short name on the board's rail ("p. 47").
     */
    swap?: { label: string; railLabel?: string; key: string; onFlip?: (flipped: boolean) => void };
  };
  /** The board's name and details, at the top of the board column. */
  title: ReactNode;
  /** Buttons beside the title. */
  actions?: ReactNode;
  /** The DrawingCanvas; its wrapper here is positioned and sized. */
  canvas: ReactNode;
  /** The BottomToolbar: a rail down the board's left. */
  toolbar: ReactNode;
  /** The tutor, closed until asked: a column on the right, in the source's place unless the screen is very wide. */
  tutor: { open: boolean; onClose: () => void; content: ReactNode };
}

/** The layout every board shares: source, board with its header and toolbar, and the tutor when asked. */
export default function BoardFrame({ fullScreen, source, title, actions, canvas, toolbar, tutor }: Props) {
  const [sourceHidden, setSourceHidden] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow, () => false);
  // Swapping: the board, or the source in its place (for the board named when it was flipped).
  // Full screen swaps too, so the page is a tap away without leaving it.
  const swapping = Boolean(source?.swap) && (narrow || fullScreen);
  const [flippedFor, setFlippedFor] = useState<string | null>(null);
  const flipped = swapping && flippedFor === source?.swap?.key;
  const onFlip = source?.swap?.onFlip;
  useEffect(() => { onFlip?.(flipped); }, [onFlip, flipped]);
  // Full screen keeps the tutor: it comes out beside the board and goes with the tutor button.
  const showTutor = tutor.open && !flipped;
  const showSource = Boolean(source) && (swapping ? flipped : !fullScreen && !sourceHidden);
  // Below 2xl the open tutor takes the source's place, whether or not the source was hidden.
  const sourceCovered = Boolean(source) && showTutor && !wide && !swapping;
  // The board's controls are in a rail on the left (BoardRail), and full screen hides its header too.
  const [railTools, setRailTools] = useState<HTMLElement | null>(null);
  const [railHeader, setRailHeader] = useState<HTMLElement | null>(null);
  // Out of sight, a source with a rail name (a book's page) gets a button on the rail ("p. 47") that brings it back.
  const swapKey = source?.swap?.key ?? null;
  const railLabel = source?.swap?.railLabel;
  const sourceName = source?.label;
  const closeTutor = useRef(tutor.onClose);
  useEffect(() => { closeTutor.current = tutor.onClose; });
  const sourceOut = Boolean(source) && !flipped && (swapping || sourceHidden || sourceCovered);
  const railSource = useMemo(() => (sourceOut && sourceName && railLabel ? {
    label: railLabel, title: `Show the ${sourceName.toLowerCase()}`,
    show: () => {
      closeTutor.current();
      if (swapping) setFlippedFor(swapKey);
      else setSourceHidden(false);
    },
  } : null), [sourceOut, sourceName, railLabel, swapping, swapKey]);
  const railSlots = useMemo(() => ({ tools: railTools, header: railHeader, setTools: setRailTools, setHeader: setRailHeader, source: railSource }), [railTools, railHeader, railSource]);

  return (
    <div className={`flex-1 min-h-0 flex ${fullScreen ? 'flex-row' : 'flex-col lg:flex-row'}`}>
      {source && showSource && (
        <section
          aria-label={source.label}
          // Below a very wide screen the tutor takes the source's place, so the board keeps its room.
          // Keep lg:flex-1's zero basis for a wide PDF; its rendered width must not crowd out the board.
          className={`${showTutor ? 'hidden 2xl:flex' : 'flex'} flex-col min-w-0 min-h-0 ${flipped ? 'flex-1' : 'basis-[40%] shrink-0'} ${
            flipped ? '' : source.wide ? 'lg:flex-1' : 'lg:w-[22rem] lg:flex-none'
          } ${!flipped ? 'boox:max-lg:basis-auto boox:max-lg:max-h-[35%]' : ''} border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50`}
        >
          {flipped && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
              <button onClick={() => setFlippedFor(null)}
                className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Back to board</button>
            </div>
          )}
          {/* The source's toolbar is a rail down its left, like an ink board's. */}
          <div className="relative flex-1 min-h-0 flex">
            {source.toolbar}
            <div className="flex-1 min-w-0 overflow-y-auto">{source.content}</div>
          </div>
        </section>
      )}

      {/* Flipped to the source, the board stays mounted (hidden), so its drawing and undo stay. */}
      <section className={`${flipped ? 'hidden' : 'flex'} flex-1 min-w-0 min-h-0 flex-col bg-white ${source?.wide && showSource && !showTutor ? 'lg:flex-none lg:w-1/2' : ''}`}>
        <BoardRailContext.Provider value={railSlots}>
        <div className={`${fullScreen ? 'hidden' : 'flex'} flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200`}>
          {/* The title keeps room to read; the buttons wrap below it on a narrow board. */}
          <div className="min-w-[min(100%,16rem)] flex-1">{title}</div>
          {actions}
          <div ref={setRailHeader} className="contents" />
          {source?.swap && swapping ? !fullScreen && (
            <button onClick={() => { tutor.onClose(); setFlippedFor(source.swap?.key ?? null); }}
              title={`Show the ${source.label.toLowerCase()} in the board's place`}
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">{source.swap.label}</button>
          ) : source && !fullScreen && (
            <button
              onClick={() => {
                if (sourceCovered) { tutor.onClose(); setSourceHidden(false); }
                else setSourceHidden((hidden) => !hidden);
              }}
              aria-pressed={showSource && !sourceCovered}
              title={sourceHidden || sourceCovered ? `Show the ${source.label.toLowerCase()} beside the board` : `Give the board the ${source.label.toLowerCase()}'s room`}
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {sourceHidden || sourceCovered ? `Show ${source.label.toLowerCase()}` : `Hide ${source.label.toLowerCase()}`}
            </button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex">
          {toolbar}
          <div className="relative flex-1 min-w-0">{canvas}</div>
        </div>
        </BoardRailContext.Provider>
      </section>

      {/* Keep the conversation mounted when closed, so drafts and an active reply survive toggling. */}
        <aside
          aria-label="Tutor"
          className={`${showTutor ? 'flex' : 'hidden'} flex-col min-h-0 bg-white border-indigo-700 ${fullScreen
            ? 'w-[min(24rem,45%)] flex-none border-l-2'
            : 'order-first lg:order-none basis-[40%] shrink-0 lg:basis-auto lg:w-[24rem] lg:flex-none border-b-2 lg:border-b-0 lg:border-l-2'}`}
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
            <h2 className="flex-1 flex items-center gap-1.5 font-semibold text-indigo-700"><TutorIcon />Tutor</h2>
            <button onClick={tutor.onClose} aria-label="Close tutor" className="min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50">
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">{tutor.content}</div>
        </aside>
    </div>
  );
}
