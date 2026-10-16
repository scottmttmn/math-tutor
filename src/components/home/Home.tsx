'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deleteSession, listSessions, listShelf, loadProfile, renameSession } from '@/lib/db';
import { isProfileEmpty } from '@/lib/learnerProfile';
import { libraryView, queryHistory, toHistoryItem } from '@/lib/history';
import { removeFromShelf, setShelfKind } from '@/lib/shelf';
import { useAddPdfs } from '@/hooks/useAddPdfs';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import { boardToOpen, setBoardToOpen } from '@/lib/currentBoard';
import AppBar from '@/components/layout/AppBar';
import { TutorIcon } from '@/components/common/Icons';
import BoardCard, { KindLine, Thumbnail } from '@/components/home/BoardCard';
import { BookCard } from '@/components/shelf/BookCard';
import type { HistoryItem, HistoryShow, HistorySort, ShelfDocument, ShelfKind } from '@/types';

const SHOW_OPTIONS: { value: HistoryShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'notes', label: 'Notes' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
  { value: 'favorites', label: 'Favorites' },
];

const loadItems = async () => {
  // Favorites live in the tutor memory; without it, nothing shows as starred.
  const [sessions, profile] = await Promise.all([listSessions(), loadProfile().catch(() => undefined)]);
  const favoriteIds = new Set((profile?.favorites ?? []).map((favorite) => favorite.id));
  return sessions.map((session) => toHistoryItem(session, favoriteIds)).filter((item): item is HistoryItem => item !== null);
};

/**
 * The page the app opens on, the library: the board last worked on, then the books (Shelf PDFs) and
 * free-form boards, searchable. A book's own boards are on its page, and a search reaches them here.
 */
export default function Home() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [books, setBooks] = useState<ShelfDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<HistoryShow>('all');
  const [sort, setSort] = useState<HistorySort>('updated');
  const [dragging, setDragging] = useState(false);
  const [bookError, setBookError] = useState('');
  const pdfs = useAddPdfs();
  // Until the student tells the tutor about themselves, Home offers it once, quietly.
  const [memoryEmpty, setMemoryEmpty] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadItems(), listShelf()])
      .then(([loaded, shelf]) => { if (active) { setItems(loaded); setBooks(shelf); } })
      .catch(() => { if (active) setFailed(true); });
    loadProfile()
      .then((profile) => { if (active) setMemoryEmpty(!profile || isProfileEmpty(profile)); })
      .catch(() => { /* Not worth an error here. */ });
    return () => { active = false; };
  }, []);

  const view = useMemo(() => libraryView(items ?? [], books ?? [], { search, show, sort }), [items, books, search, show, sort]);
  const latest = useMemo(() => queryHistory(items ?? [], { search: '', show: 'all', sort: 'updated' })[0], [items]);
  const bookTitles = useMemo(() => new Map((books ?? []).map((book) => [book.id, book.title])), [books]);
  const browsing = !search.trim() && show === 'all';

  const open = (item: HistoryItem) => {
    if (item.href) { router.push(item.href); return; }
    setBoardToOpen(item.id);
    router.push('/board');
  };

  const rename = async (item: HistoryItem, name: string) => {
    await renameSession(item.id, name);
    setItems(await loadItems());
  };

  const remove = async (item: HistoryItem) => {
    await deleteSession(item.id);
    discardRecoveryCopy(item.id);
    // /board would otherwise try to reopen it.
    if (boardToOpen() === item.id) setBoardToOpen(null);
    setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
  };

  const addBooks = async (files: File[]) => {
    const added = await pdfs.add(files.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)));
    if (added.length) setBooks((current) => [...added, ...(current ?? [])]);
  };

  const removeBook = async (book: ShelfDocument) => {
    await removeFromShelf(book);
    setBooks((current) => current?.filter((entry) => entry.id !== book.id) ?? null);
    setItems((current) => current?.filter((entry) => entry.bookId !== book.id) ?? null);
  };

  const changeKind = async (book: ShelfDocument, kind: ShelfKind) => {
    try {
      const updated = await setShelfKind(book, kind);
      setBooks((current) => current?.map((entry) => (entry.id === updated.id ? updated : entry)) ?? null);
    } catch { setBookError('That could not be saved. Try again.'); }
  };

  const empty = items !== null && books !== null && items.length === 0 && books.length === 0;
  const status = pdfs.error || bookError || pdfs.busy;

  return (
    <div
      className="min-h-screen flex flex-col bg-gray-50"
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void addBooks([...event.dataTransfer.files]);
      }}
    >
      <AppBar place="home" />

      <main className={`flex-1 w-full max-w-7xl mx-auto p-4 flex flex-col gap-6 ${dragging ? 'outline-2 outline-dashed outline-gray-900 -outline-offset-8 bg-gray-100' : ''}`}>
        {latest && <ContinueCard item={latest} bookTitle={latest.bookId ? bookTitles.get(latest.bookId) : undefined} onOpen={() => open(latest)} />}
        {memoryEmpty && (
          <Link href="/memory" className="flex items-center gap-3 min-h-11 px-4 py-3 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
            <span className="text-indigo-700"><TutorIcon /></span>
            <span className="flex-1 text-gray-700">
              <span className="font-medium text-gray-900">Tell the tutor what you know.</span> Rate a few topics so its hints start at your level. Optional.
            </span>
            <span aria-hidden="true" className="text-gray-500">→</span>
          </Link>
        )}

        <section aria-labelledby="library-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="library-heading" className="mr-auto text-lg font-semibold text-gray-900">Library</h1>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search books, problems and notes"
              aria-label="Search books, problems and notes"
              className="flex-1 min-w-[12rem] max-w-md min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            {/* Two rows of three on a phone, where six don't fit in one. */}
            <div className="grid grid-cols-3 sm:flex rounded-lg border border-gray-300 overflow-hidden" role="group" aria-label="Show">
              {SHOW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => setShow(option.value)}
                  aria-pressed={show === option.value}
                  className={`min-h-11 px-3 text-sm whitespace-nowrap ${show === option.value ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as HistorySort)}
              aria-label="Sort by"
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white"
            >
              <option value="updated">Last worked on</option>
              <option value="created">Started</option>
              <option value="title">Name</option>
            </select>
          </div>

          {status && (
            <p role={pdfs.error || bookError ? 'alert' : 'status'} className={`text-sm ${pdfs.error || bookError ? 'text-red-700' : 'text-gray-600'}`}>{status}</p>
          )}

          {failed ? (
            <p className="text-center text-sm text-red-600 py-12">Your library could not be loaded. Reload the page to try again.</p>
          ) : items === null || books === null ? null : empty ? (
            <div className="max-w-md mx-auto text-center text-sm text-gray-500 py-12 space-y-2">
              <p className="text-base text-gray-700">Nothing here yet.</p>
              <p>Start with <strong>+ New</strong>: a problem, notes, or a PDF to work from (a textbook, a problem set, a handout). You can also drop a PDF here.</p>
              <p>Everything you work on is saved here automatically.</p>
            </div>
          ) : view.books.length === 0 && view.boards.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-12">Nothing matches.</p>
          ) : (
            <>
              {view.books.length > 0 && (
                <section aria-labelledby="books-heading" className="flex flex-col gap-3">
                  <h2 id="books-heading" className="text-base font-semibold text-gray-900">Books</h2>
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {view.books.map((book) => (
                      <BookCard key={book.id} document={book} onRemove={() => removeBook(book)} onKind={(kind) => changeKind(book, kind)} />
                    ))}
                  </ul>
                </section>
              )}
              {view.boards.length > 0 && (
                <section aria-labelledby="boards-heading" className="flex flex-col gap-3">
                  <h2 id="boards-heading" className="text-base font-semibold text-gray-900">{browsing ? 'Problems and notes' : 'Boards'}</h2>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {view.boards.map((item) => (
                      <BoardCard
                        key={item.id}
                        item={item}
                        bookTitle={item.bookId ? bookTitles.get(item.bookId) : undefined}
                        onOpen={() => open(item)}
                        onRename={(name) => rename(item, name)}
                        onDelete={() => remove(item)}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

function ContinueCard({ item, bookTitle, onOpen }: { item: HistoryItem; bookTitle?: string; onOpen: () => void }) {
  return (
    <section aria-label="Continue" className="flex flex-col sm:flex-row gap-4 p-3 bg-white border border-gray-200 rounded-xl">
      <button onClick={onOpen} aria-label={`Continue ${item.title}`} className="sm:w-72 shrink-0 rounded-lg border border-gray-200 overflow-hidden hover:border-gray-400">
        <Thumbnail blob={item.thumbnail} />
      </button>
      <div className="flex flex-col justify-center gap-2 min-w-0">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Continue</span>
        <p className="text-lg font-semibold text-gray-900 line-clamp-2">{item.title}</p>
        <KindLine item={item} bookTitle={bookTitle} />
        <div>
          <button onClick={onOpen} className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
            Open
          </button>
        </div>
      </div>
    </section>
  );
}

