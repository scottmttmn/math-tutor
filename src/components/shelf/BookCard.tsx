'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SHELF_KINDS, solvedExercises } from '@/lib/shelf';
import type { ShelfDocument, ShelfKind } from '@/types';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';

/** Where the reader opens a book, on the page last read. */
export const readerHref = (id: string) => `/shelf/read?doc=${encodeURIComponent(id)}`;

/** A book (a PDF) outside a folder: its cover opens the reader; asks what it is until told; Change kind, Move to and Remove. */
export function BookCard({ document, onRemove, onKind, onMove }: { document: ShelfDocument; onRemove: () => Promise<void>; onKind: (kind: ShelfKind) => Promise<void>; onMove: () => void }) {
  const [confirming, setConfirming] = useState(false);
  // What it is is asked until chosen, and again from the menu.
  const [choosing, setChoosing] = useState(false);
  const [solved, setSolved] = useState<number | undefined>(undefined);
  const marked = document.exercises.length;
  useEffect(() => {
    let active = true;
    void solvedExercises(document).then((ids) => { if (active) setSolved(ids.length); }, () => undefined);
    return () => { active = false; };
  }, [document]);
  return (
    // No overflow-hidden on the card: it would clip the "⋯" menu.
    <li className="flex flex-col bg-white border border-gray-200 rounded-xl">
      <div className="rounded-t-xl overflow-hidden"><BookCover document={document} solved={solved} /></div>
      {(!document.kind || choosing) && (
        <div role="group" aria-label={`What ${document.title} is`} className="px-3 pt-1">
          <p className="text-xs text-gray-600">What is it?</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {SHELF_KINDS.map(({ kind, label }) => (
              <button key={kind} aria-pressed={document.kind === kind}
                onClick={() => { void onKind(kind); setChoosing(false); }}
                className={`min-h-11 px-2 text-xs rounded-lg border border-gray-900 ${document.kind === kind ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 px-3 py-2">
        {confirming ? (
          <>
            <span className="mr-auto text-xs text-gray-700">{marked > 0 ? 'Remove it and its boards?' : 'Remove it?'}</span>
            <button onClick={() => void onRemove()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Remove</button>
            <button onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
          </>
        ) : (
          <MoreMenu label={`More for ${document.title}`} items={[
            ...(document.kind ? [{ label: 'Change kind', onSelect: () => setChoosing(true) }] : []),
            { label: 'Move to…', onSelect: onMove },
            { label: 'Remove', onSelect: () => setConfirming(true) },
          ]} />
        )}
      </div>
    </li>
  );
}

/**
 * A PDF's cover, title, kind, progress and where you left off, opening the reader (or `href`).
 * Without `solved`, exercises show as a count.
 */
export function BookCover({ document, solved, href = readerHref(document.id) }: { document: ShelfDocument; solved?: number; href?: string }) {
  const notes = document.exercises.filter((item) => item.kind === 'note').length;
  const exercises = document.exercises.length - notes;
  const kind = SHELF_KINDS.find((item) => item.kind === document.kind)?.label;
  const notesText = `${notes} ${notes === 1 ? 'note page' : 'note pages'}`;
  // Where you left off, once the reader has saved a place (older records only have the page).
  const opened = document.lastPageLabel !== undefined || document.lastPage > 1;
  return (
    <Link href={href} aria-label={`Open ${document.title}`} className="block bg-white hover:bg-gray-50">
      <div className="aspect-[3/4] bg-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden">
        {document.cover ? <BlobImage blob={document.cover} className="w-full h-full object-contain" /> : <span className="text-xs text-gray-400">PDF</span>}
      </div>
      <div className="px-3 py-2 grid gap-1">
        <p className="text-sm font-medium text-gray-900 line-clamp-2">{document.title}</p>
        {kind && <span className="justify-self-start px-2 text-xs leading-5 text-gray-900 border border-gray-900 rounded-full">{kind}</span>}
        {exercises > 0 && solved !== undefined ? (
          <>
            <div aria-hidden="true" className="h-1.5 border border-gray-900 rounded-sm overflow-hidden">
              <div className="h-full bg-gray-900" style={{ width: `${(solved / exercises) * 100}%` }} />
            </div>
            <p className="text-xs text-gray-700">{solved} of {exercises} solved{notes > 0 ? ` · ${notesText}` : ''}</p>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            {exercises > 0 ? `${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}` : notes > 0 ? '' : `${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}`}
            {exercises > 0 && notes > 0 ? ' · ' : ''}{notes > 0 ? notesText : ''}
          </p>
        )}
        {opened && (
          <p className="text-xs text-gray-500 truncate">
            p. {document.lastPageLabel ?? document.lastPage}{document.lastSection ? ` · ${document.lastSection}` : ''}
          </p>
        )}
      </div>
    </Link>
  );
}
