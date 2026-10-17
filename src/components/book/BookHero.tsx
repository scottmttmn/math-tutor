'use client';

import { useState } from 'react';
import Link from 'next/link';
import { isNote } from '@/lib/shelf';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';
import { readerHref } from '@/components/shelf/BookCard';
import type { ShelfDocument } from '@/types';

interface Props {
  book: ShelfDocument;
  /** Its exercises marked solved. */
  solved: number;
  onMove: () => void;
  onRemove: () => Promise<void>;
  /** Names it: false in its own folder, whose name is the text's. */
  named?: boolean;
}

/** A text at the head of its folder: read it where you left off, its progress; Move to and Remove. */
export default function BookHero({ book, solved, onMove, onRemove, named = true }: Props) {
  const [confirming, setConfirming] = useState(false);
  const notes = book.exercises.filter(isNote).length;
  const exercises = book.exercises.length - notes;
  const opened = book.lastPageLabel !== undefined || book.lastPage > 1;
  const summary = [
    exercises > 0 && `${solved} of ${exercises} solved`,
    notes > 0 && `${notes} ${notes === 1 ? 'note page' : 'note pages'}`,
    `${book.pageCount} ${book.pageCount === 1 ? 'page' : 'pages'}`,
  ].filter(Boolean).join(' · ');

  return (
    <section aria-label={book.title} className="flex flex-col sm:flex-row gap-4 p-3 bg-white border border-gray-200 rounded-xl">
      <Link href={readerHref(book.id)} aria-label={`Read ${book.title}`} className="w-32 shrink-0 aspect-[3/4] bg-gray-100 border border-gray-200 rounded-lg overflow-hidden flex items-center justify-center hover:border-gray-400">
        {book.cover ? <BlobImage blob={book.cover} className="w-full h-full object-contain" /> : <span className="text-xs text-gray-400">PDF</span>}
      </Link>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          {named ? <h2 className="mr-auto text-lg font-semibold text-gray-900">{book.title}</h2> : <span className="mr-auto" />}
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-gray-700">{book.exercises.length > 0 ? 'Remove it and its boards?' : 'Remove it?'}</span>
              <button onClick={() => void onRemove()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Remove</button>
              <button onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
            </span>
          ) : (
            <MoreMenu label={`More for the text ${book.title}`} items={[
              { label: 'Move to…', onSelect: onMove },
              { label: 'Remove', onSelect: () => setConfirming(true) },
            ]} />
          )}
        </div>
        <p className="text-sm text-gray-700">{summary}</p>
        {opened && book.lastSection && <p className="text-sm text-gray-500">Left off in {book.lastSection}</p>}
        <div>
          <Link href={readerHref(book.id)} className="inline-flex items-center min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
            {opened ? `Read at p. ${book.lastPageLabel ?? book.lastPage}` : 'Start reading'}
          </Link>
        </div>
      </div>
    </section>
  );
}
