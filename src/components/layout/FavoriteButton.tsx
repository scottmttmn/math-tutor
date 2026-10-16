'use client';

import { useEffect, useRef, useState } from 'react';
import { FavoriteStar } from '@/components/common/Icons';
import { MAX_FAVORITE_REASON } from '@/lib/learnerProfile';
import type { FavoriteProblem } from '@/types';

interface Props {
  favorite: FavoriteProblem | null;
  /** Unset while the board has no id yet (nothing on it). */
  disabled?: boolean;
  failed?: boolean;
  onStar: (reason: string) => void;
  onUnstar: () => void;
}

/**
 * Favorite: stars the board, then asks (optionally) what made the problem good. Tapping a starred
 * board's button opens the same box, to change the reason or take the star off.
 */
export default function FavoriteButton({ favorite, disabled = false, failed = false, onStar, onUnstar }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  // Read by the close handlers, which outlive a render.
  const latest = useRef({ reason, favorite, onStar });
  useEffect(() => { latest.current = { reason, favorite, onStar }; });

  // Closing keeps what was typed.
  const close = () => {
    const { reason: typed, favorite: current, onStar: star } = latest.current;
    // The star itself may still be saving, so a reason typed meanwhile is compared with none.
    if (typed.trim() !== (current?.reason ?? '')) star(typed);
    setOpen(false);
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeRef.current();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const toggle = () => {
    if (open) { close(); return; }
    setReason(favorite?.reason ?? '');
    if (!favorite) onStar('');
    setOpen(true);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        disabled={disabled}
        aria-pressed={Boolean(favorite)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 min-h-11 px-3 text-sm rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40 ${
          favorite ? 'font-semibold text-gray-900 border-2 border-gray-900' : 'text-gray-800 border border-gray-300'
        }`}
        title={disabled ? 'Write something on the board first' : favorite ? 'One of your favorites: change why, or take the star off' : 'Mark this problem as one you really like'}
      >
        <FavoriteStar filled={Boolean(favorite)} />
        Favorite
      </button>
      {open && (
        <div role="dialog" aria-label="Favorite" className="absolute right-0 bottom-full mb-1 w-72 p-3 flex flex-col gap-2 bg-white border border-gray-300 rounded-lg shadow-lg z-50">
          <label htmlFor="favorite-reason" className="text-sm font-medium text-gray-900">What made it good? <span className="font-normal text-gray-500">(optional)</span></label>
          <textarea
            id="favorite-reason"
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, MAX_FAVORITE_REASON))}
            rows={3}
            placeholder="The trick, the idea, how it connected things… or leave it blank."
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <p className="text-xs text-gray-500">The tutor reads your favorites, and why, from your tutor memory.</p>
          {failed && <p role="alert" className="text-sm text-red-600">Not saved. Try again.</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onUnstar(); setOpen(false); }}
              className="min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
            >
              Remove star
            </button>
            <div className="flex-1" />
            <button onClick={close} className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
