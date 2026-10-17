'use client';

import { useState } from 'react';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';
import { FavoriteStar, KindIcon, ShelfIcon, SolvedCheck } from '@/components/common/Icons';
import type { HistoryItem } from '@/types';

/** What a board is (problem or notes), the book it came from, and whether it's solved or a favorite. */
export function KindLine({ item, bookTitle }: { item: HistoryItem; bookTitle?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
      <span className="flex items-center gap-1"><KindIcon type={item.sessionType} />{item.sessionType === 'note' ? 'Notes' : 'Problem'}</span>
      {item.source === 'shelf' && bookTitle && <span className="flex items-center gap-1 min-w-0"><ShelfIcon /><span className="truncate">{bookTitle}</span></span>}
      {item.isSolved && <span className="flex items-center gap-1 font-semibold text-gray-900"><SolvedCheck size={14} />Solved</span>}
      {item.favorite && <span className="flex items-center gap-1 font-semibold text-gray-900"><FavoriteStar filled size={14} />Favorite</span>}
    </div>
  );
}

interface CardProps {
  item: HistoryItem;
  /** The book a Shelf entry came from, named when it is listed away from the book's page. */
  bookTitle?: string;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Offers Move to…, which the list opens. */
  onMove?: () => void;
  /** The question Delete asks first. */
  deleteQuestion?: string;
}

/** A board in a list: its picture, kind and name; opens it; Rename, Move to and Delete in its menu. */
export default function BoardCard({ item, bookTitle, onOpen, onRename, onDelete, onMove, deleteQuestion = 'Delete it?' }: CardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const updated = new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const finishRename = async () => {
    setRenaming(false);
    if (name.trim() !== item.title) await onRename(name);
  };

  return (
    // No overflow-hidden on the card: it would clip the "⋯" menu. The open button rounds its own corners.
    <li className="flex flex-col bg-white border border-gray-200 rounded-xl">
      <button onClick={onOpen} className="text-left rounded-t-xl overflow-hidden hover:bg-gray-50" aria-label={`Open ${item.title}`}>
        <Thumbnail blob={item.thumbnail} />
        <div className="px-3 pt-2">
          <KindLine item={item} bookTitle={bookTitle} />
          {!renaming && <p className="mt-1 text-sm font-medium text-gray-900 line-clamp-2">{item.title}</p>}
          {/* The problem itself, when the name doesn't already show it (renamed, or a Shelf exercise). */}
          {item.problemStatement && !item.problemStatement.startsWith(item.title) && !renaming && (
            <p className="text-xs text-gray-500 line-clamp-1">{item.problemStatement}</p>
          )}
        </div>
      </button>
      {renaming && (
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void finishRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { setName(item.title); setRenaming(false); }
          }}
          aria-label="Name"
          className="mx-3 mt-1 px-2 py-1.5 text-sm border border-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      )}
      <div className="mt-auto flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs text-gray-500">
          {updated}{item.messageCount > 0 ? ` · ${item.messageCount} ${item.messageCount === 1 ? 'message' : 'messages'}` : ''}
        </span>
        {confirmingDelete ? (
          <span className="flex items-center gap-1.5">
            <span className="text-xs text-gray-700">{deleteQuestion}</span>
            <button onClick={() => void onDelete()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
              Delete
            </button>
            <button onClick={() => setConfirmingDelete(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">
              Keep
            </button>
          </span>
        ) : (
          <MoreMenu
            label={`More for ${item.title}`}
            items={[
              { label: 'Rename', onSelect: () => { setName(item.title); setRenaming(true); } },
              ...(onMove ? [{ label: 'Move to…', onSelect: onMove }] : []),
              { label: 'Delete', onSelect: () => setConfirmingDelete(true) },
            ]}
          />
        )}
      </div>
    </li>
  );
}

export function Thumbnail({ blob }: { blob: Blob | null }) {
  return (
    <div className="aspect-[4/3] bg-white border-b border-gray-100 flex items-center justify-center overflow-hidden">
      {blob ? <BlobImage blob={blob} className="max-w-full max-h-full object-contain p-2" /> : <span className="text-xs text-gray-300">Empty board</span>}
    </div>
  );
}
