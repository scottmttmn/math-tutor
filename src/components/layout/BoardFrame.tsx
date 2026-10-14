'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

// Tailwind's 2xl: wide enough for the source, the board and the tutor side by side.
const WIDE_QUERY = '(min-width: 96rem)';
const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const isWide = () => window.matchMedia(WIDE_QUERY).matches;

interface Props {
  fullScreen: boolean;
  /**
   * What the board works from, shown beside it (above it on an upright tablet): a book page, an
   * exercise, the typed problem. `wide` gives it half the width, for a PDF page.
   */
  source?: { label: string; content: ReactNode; toolbar?: ReactNode; wide?: boolean };
  /** The board's name and details, at the top of the board column. */
  title: ReactNode;
  /** Buttons beside the title. */
  actions?: ReactNode;
  /** The DrawingCanvas; its wrapper here is positioned and sized. */
  canvas: ReactNode;
  /** The BottomToolbar. */
  toolbar: ReactNode;
  /** The tutor, closed until asked: a column on the right, in the source's place unless the screen is very wide. */
  tutor: { open: boolean; onClose: () => void; content: ReactNode };
}

/** The layout every board shares: source, board with its header and toolbar, and the tutor when asked. */
export default function BoardFrame({ fullScreen, source, title, actions, canvas, toolbar, tutor }: Props) {
  const [sourceHidden, setSourceHidden] = useState(false);
  const showSource = Boolean(source) && !fullScreen && !sourceHidden;
  const showTutor = tutor.open && !fullScreen;
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  // Below 2xl the open tutor takes the source's place.
  const sourceCovered = showSource && showTutor && !wide;

  return (
    <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
      {source && showSource && (
        <section
          aria-label={source.label}
          // Below a very wide screen the tutor takes the source's place, so the board keeps its room.
          className={`${showTutor ? 'hidden 2xl:flex' : 'flex'} flex-col min-w-0 min-h-0 basis-[40%] shrink-0 lg:basis-auto ${
            source.wide ? 'lg:flex-1' : 'lg:w-[22rem] lg:flex-none'
          } border-b lg:border-b-0 lg:border-r border-gray-200 bg-gray-50`}
        >
          {source.toolbar && <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">{source.toolbar}</div>}
          <div className="flex-1 min-h-0 overflow-y-auto">{source.content}</div>
        </section>
      )}

      <section className={`flex-1 min-w-0 min-h-0 flex flex-col bg-white ${source?.wide && showSource && !showTutor ? 'lg:flex-none lg:w-1/2' : ''}`}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-gray-200">
          <div className="min-w-0 flex-1">{title}</div>
          {actions}
          {source && !fullScreen && (
            <button
              onClick={() => {
                if (sourceCovered) tutor.onClose();
                else setSourceHidden((hidden) => !hidden);
              }}
              aria-pressed={showSource && !sourceCovered}
              title={sourceHidden || sourceCovered ? `Show the ${source.label.toLowerCase()} beside the board` : `Give the board the ${source.label.toLowerCase()}'s room`}
              className="min-h-10 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              {sourceHidden || sourceCovered ? `Show ${source.label.toLowerCase()}` : `Hide ${source.label.toLowerCase()}`}
            </button>
          )}
        </div>
        <div className="relative flex-1 min-h-0">{canvas}</div>
        {toolbar}
      </section>

      {showTutor && (
        <aside
          aria-label="Tutor"
          className="order-first lg:order-none flex flex-col min-h-0 basis-[40%] shrink-0 lg:basis-auto lg:w-[24rem] lg:flex-none border-b lg:border-b-0 lg:border-l border-gray-200 bg-white"
        >
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
            <h2 className="flex-1 font-semibold text-gray-900">Tutor</h2>
            <button onClick={tutor.onClose} aria-label="Close tutor" className="min-h-10 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">
              Close
            </button>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">{tutor.content}</div>
        </aside>
      )}
    </div>
  );
}
