'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { listSessions, loadProfile, loadShelfDocument, renameSession, shelfSessionId } from '@/lib/db';
import { toHistoryItem } from '@/lib/history';
import { SHELF_KINDS, isNote, removeFromShelf, setShelfKind, unmarkExercise } from '@/lib/shelf';
import AppBar from '@/components/layout/AppBar';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';
import BoardCard from '@/components/home/BoardCard';
import { readerHref } from '@/components/shelf/BookCard';
import type { HistoryItem, ShelfDocument, ShelfKind } from '@/types';

/** The book's boards, in the order their marks sit in it (by page, then as marked). */
async function loadBoards(book: ShelfDocument): Promise<HistoryItem[]> {
  const [sessions, profile] = await Promise.all([listSessions(), loadProfile().catch(() => undefined)]);
  const favoriteIds = new Set((profile?.favorites ?? []).map((favorite) => favorite.id));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return [...book.exercises]
    .sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
    .map((mark) => byId.get(shelfSessionId(book.id, mark.id)))
    .map((session) => (session ? toHistoryItem(session, favoriteIds, { untouched: true }) : null))
    .filter((item): item is HistoryItem => item !== null);
}

/** A book's page: the book (read it where you left off) and every board made from it. Keyed by `doc` where used. */
export default function BookPage({ doc }: { doc: string }) {
  const router = useRouter();
  const [book, setBook] = useState<ShelfDocument | null>(null);
  const [boards, setBoards] = useState<HistoryItem[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    loadShelfDocument(doc)
      .then(async (loaded) => {
        if (!active) return;
        if (!loaded) { setMissing(true); return; }
        setBook(loaded);
        const items = await loadBoards(loaded);
        if (active) setBoards(items);
      })
      .catch(() => { if (active) setError('This book could not be loaded. Reload the page to try again.'); });
    return () => { active = false; };
  }, [doc]);

  const counts = useMemo(() => {
    const marks = book?.exercises ?? [];
    const notes = marks.filter(isNote).length;
    return { exercises: marks.length - notes, notes, solved: (boards ?? []).filter((item) => item.isSolved).length };
  }, [book, boards]);

  if (missing) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <AppBar place="book" />
        <p className="p-12 text-center text-sm text-gray-700">This book isn’t in your library. <Link href="/" className="text-gray-900 underline">Back to Home</Link></p>
      </div>
    );
  }

  const changeKind = async (kind: ShelfKind) => {
    if (!book) return;
    setChoosing(false);
    try { setBook(await setShelfKind(book, kind)); } catch { setError('That could not be saved. Try again.'); }
  };

  const remove = async () => {
    if (!book) return;
    await removeFromShelf(book);
    router.push('/');
  };

  const rename = async (item: HistoryItem, name: string) => {
    await renameSession(item.id, name);
    if (book) setBoards(await loadBoards(book));
  };

  // A book's board belongs to its mark: deleting it removes the mark too, or the reader would make it again.
  const removeBoard = async (item: HistoryItem) => {
    if (!book || !item.exerciseId) return;
    const updated = await unmarkExercise(book, item.exerciseId);
    setBook(updated);
    setBoards((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
  };

  const kind = SHELF_KINDS.find((entry) => entry.kind === book?.kind)?.label;
  const opened = book && (book.lastPageLabel !== undefined || book.lastPage > 1);
  const summary = [
    kind,
    counts.exercises > 0 && `${counts.solved} of ${counts.exercises} solved`,
    counts.notes > 0 && `${counts.notes} ${counts.notes === 1 ? 'note page' : 'note pages'}`,
    book && `${book.pageCount} ${book.pageCount === 1 ? 'page' : 'pages'}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <AppBar place="book" />
      <main className="flex-1 w-full max-w-7xl mx-auto p-4 flex flex-col gap-6">
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

        {book && (
          <section aria-label="The book" className="flex flex-col sm:flex-row gap-4 p-3 bg-white border border-gray-200 rounded-xl">
            <Link href={readerHref(book.id)} aria-label={`Read ${book.title}`} className="w-32 shrink-0 aspect-[3/4] bg-gray-100 border border-gray-200 rounded-lg overflow-hidden flex items-center justify-center hover:border-gray-400">
              {book.cover ? <BlobImage blob={book.cover} className="w-full h-full object-contain" /> : <span className="text-xs text-gray-400">PDF</span>}
            </Link>
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <h1 className="mr-auto text-xl font-semibold text-gray-900">{book.title}</h1>
                {confirming ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-700">{book.exercises.length > 0 ? 'Remove it and its boards?' : 'Remove it?'}</span>
                    <button onClick={() => void remove()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Remove</button>
                    <button onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
                  </span>
                ) : (
                  <MoreMenu label={`More for ${book.title}`} items={[
                    ...(book.kind ? [{ label: 'Change kind', onSelect: () => setChoosing(true) }] : []),
                    { label: 'Remove', onSelect: () => setConfirming(true) },
                  ]} />
                )}
              </div>
              <p className="text-sm text-gray-700">{summary}</p>
              {opened && book.lastSection && <p className="text-sm text-gray-500">Left off in {book.lastSection}</p>}
              {(!book.kind || choosing) && (
                <div role="group" aria-label={`What ${book.title} is`}>
                  <p className="text-xs text-gray-600">What is it?</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {SHELF_KINDS.map((entry) => (
                      <button key={entry.kind} aria-pressed={book.kind === entry.kind} onClick={() => void changeKind(entry.kind)}
                        className={`min-h-11 px-2 text-xs rounded-lg border border-gray-900 ${book.kind === entry.kind ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{entry.label}</button>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <Link href={readerHref(book.id)} className="inline-flex items-center min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
                  {opened ? `Read at p. ${book.lastPageLabel ?? book.lastPage}` : 'Start reading'}
                </Link>
              </div>
            </div>
          </section>
        )}

        {book && boards && (
          <section aria-labelledby="book-boards-heading" className="flex flex-col gap-3">
            <h2 id="book-boards-heading" className="text-base font-semibold text-gray-900">Exercises and note pages</h2>
            {boards.length === 0 ? (
              <p className="text-sm text-gray-500">None yet. While reading, use <strong>Mark</strong> on an exercise or a passage to take notes on, and it gets its own board, listed here.</p>
            ) : (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {boards.map((item) => (
                  <BoardCard
                    key={item.id}
                    item={item}
                    onOpen={() => { if (item.href) router.push(item.href); }}
                    onRename={(name) => rename(item, name)}
                    onDelete={() => removeBoard(item)}
                    deleteQuestion="Delete it and its mark?"
                  />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
