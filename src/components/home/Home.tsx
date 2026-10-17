'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { bookFolderId, deleteSession, listFolders, listSessions, listShelf, loadProfile, renameSession } from '@/lib/db';
import { isProfileEmpty } from '@/lib/learnerProfile';
import { folderSummaries, libraryView, queryHistory, toHistoryItem } from '@/lib/history';
import { bookLocation, folderHref, folderIndex, folderPath, itemFolder } from '@/lib/folders';
import { createFolder, deleteFolder, moveBoard, moveBook, moveFolder, renameFolder } from '@/lib/folderActions';
import { removeFromShelf, setShelfKind, unmarkExercise } from '@/lib/shelf';
import { useAddPdfs } from '@/hooks/useAddPdfs';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import { boardToOpen, setBoardToOpen } from '@/lib/currentBoard';
import AppBar from '@/components/layout/AppBar';
import MoreMenu from '@/components/common/MoreMenu';
import { TutorIcon } from '@/components/common/Icons';
import BoardCard, { KindLine, Thumbnail } from '@/components/home/BoardCard';
import FolderCard from '@/components/home/FolderCard';
import MoveDialog from '@/components/home/MoveDialog';
import BookHero from '@/components/book/BookHero';
import { BookCard } from '@/components/shelf/BookCard';
import type { Folder, HistoryItem, HistoryShow, HistorySort, ShelfDocument, ShelfKind } from '@/types';

const SHOW_OPTIONS: { value: HistoryShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'notes', label: 'Notes' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
  { value: 'favorites', label: 'Favorites' },
];

interface Library {
  items: HistoryItem[];
  books: ShelfDocument[];
  folders: Folder[];
}

// Every board, Shelf exercises only opened too: they are listed where their book is.
const loadLibrary = async (): Promise<Library> => {
  // Favorites live in the tutor memory; without it, nothing shows as starred.
  const [sessions, books, folders, profile] = await Promise.all([listSessions(), listShelf(), listFolders(), loadProfile().catch(() => undefined)]);
  const favoriteIds = new Set((profile?.favorites ?? []).map((favorite) => favorite.id));
  const items = sessions.map((session) => toHistoryItem(session, favoriteIds, { untouched: true })).filter((item): item is HistoryItem => item !== null);
  return { items, books, folders };
};

/** What Move to… is moving. */
type Moving = { kind: 'board'; item: HistoryItem } | { kind: 'book'; book: ShelfDocument } | { kind: 'folder'; folder: Folder };

/**
 * The library: on Home (`folderId` unset) the board last worked on, then the top level; in a folder,
 * what it holds, a book's own folder starting with the book. Its folders, books and boards; a search
 * or filter reaches everything inside, at any depth.
 */
export default function Home({ folderId = null }: { folderId?: string | null }) {
  const router = useRouter();
  const [library, setLibrary] = useState<Library | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<HistoryShow>('all');
  const [sortChoice, setSortChoice] = useState<HistorySort | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<Moving | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pdfs = useAddPdfs();
  // Until the student tells the tutor about themselves, Home offers it once, quietly.
  const [memoryEmpty, setMemoryEmpty] = useState(false);

  const reload = useCallback(async () => { setLibrary(await loadLibrary()); }, []);

  useEffect(() => {
    let active = true;
    loadLibrary()
      .then((loaded) => { if (active) setLibrary(loaded); })
      .catch(() => { if (active) setFailed(true); });
    if (folderId === null) {
      loadProfile()
        .then((profile) => { if (active) setMemoryEmpty(!profile || isProfileEmpty(profile)); })
        .catch(() => { /* Not worth an error here. */ });
    }
    return () => { active = false; };
  }, [folderId]);

  const index = useMemo(() => folderIndex(library?.folders ?? [], library?.books ?? []), [library]);
  const folder = folderId ? index.folders.get(folderId) : undefined;
  const path = useMemo(() => folderPath(index, folderId), [index, folderId]);
  // A folder holding a book lists the book's boards in its order, until another order is picked.
  const holdsBook = Boolean(folderId) && (library?.books ?? []).some((book) => bookLocation(index, book) === folderId);
  const sort: HistorySort = sortChoice ?? (holdsBook ? 'book' : 'updated');
  const view = useMemo(
    () => libraryView(library?.items ?? [], library?.books ?? [], library?.folders ?? [], { folderId, search, show, sort }),
    [library, folderId, search, show, sort],
  );
  const summaries = useMemo(() => folderSummaries(library?.items ?? [], library?.books ?? [], library?.folders ?? []), [library]);
  const latest = useMemo(() => queryHistory((library?.items ?? []).filter((item) => item.hasWork), { search: '', show: 'all', sort: 'updated' })[0], [library]);
  const browsing = !search.trim() && show === 'all';
  const nameOf = (id: string | null) => (id ? index.folders.get(id)?.name ?? 'the Library' : 'the Library');

  const open = (item: HistoryItem) => {
    if (item.href) { router.push(item.href); return; }
    setBoardToOpen(item.id);
    router.push('/board');
  };

  // A Shelf board's name of its book, unless it is listed where its book is.
  const bookTitle = (item: HistoryItem) => {
    const book = item.bookId ? index.books.get(item.bookId) : undefined;
    return book && (!browsing || bookLocation(index, book) !== folderId) ? book.title : undefined;
  };

  const run = async (change: () => Promise<unknown>) => {
    setError('');
    try { await change(); } catch { setError('That could not be saved. Try again.'); }
    await reload().catch(() => setFailed(true));
  };

  const removeBoard = (item: HistoryItem) => run(async () => {
    // A book's board belongs to its mark: deleting it removes the mark too, or the reader would make it again.
    const book = item.bookId ? index.books.get(item.bookId) : undefined;
    if (book && item.exerciseId) await unmarkExercise(book, item.exerciseId);
    else {
      await deleteSession(item.id);
      discardRecoveryCopy(item.id);
    }
    // /board would otherwise try to reopen it.
    if (boardToOpen() === item.id) setBoardToOpen(null);
  });

  const removeBook = async (book: ShelfDocument) => {
    await run(() => removeFromShelf(book));
    // A book's own folder left empty goes with it, wherever the book was removed from.
    const own = bookFolderId(book.id);
    if (book.folderId !== own) return;
    const after = await loadLibrary().catch(() => null);
    const summary = after && folderSummaries(after.items, after.books, after.folders).get(own);
    if (!summary || summary.folders || summary.books || summary.problems || summary.notes) return;
    await run(() => deleteFolder(own));
    if (folderId === own) router.push(folderHref(index.parent.get(own)));
  };

  const changeKind = (book: ShelfDocument, kind: ShelfKind) => run(() => setShelfKind(book, kind));

  const move = (to: string | null) => {
    const target = moving;
    setMoving(null);
    if (!target) return;
    void run(() => {
      if (target.kind === 'board') return moveBoard(index, target.item, to);
      if (target.kind === 'book') return moveBook(target.book, to);
      return moveFolder(index, target.folder, to);
    });
  };

  const removeFolder = async (id: string) => {
    const parent = index.parent.get(id) ?? null;
    await run(() => deleteFolder(id));
    if (id === folderId) router.push(folderHref(parent));
  };

  const addBooks = async (files: File[]) => {
    const added = await pdfs.add(files.filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)), folderId);
    if (added.length) await reload().catch(() => setFailed(true));
  };

  const makeFolder = async (name: string) => {
    setNaming(null);
    await run(() => createFolder(name, folderId));
  };

  const missing = folderId !== null && library !== null && !folder;
  const empty = library !== null && view.folders.length === 0 && view.books.length === 0 && view.boards.length === 0;
  const status = pdfs.error || error || pdfs.busy;
  const heading = folder?.name ?? 'Library';
  const solvedOf = (book: ShelfDocument) => (library?.items ?? []).filter((item) => item.bookId === book.id && item.isSolved).length;

  if (missing) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <AppBar place="folder" />
        <p className="p-12 text-center text-sm text-gray-700">This folder isn’t in your library. <Link href="/" className="text-gray-900 underline">Back to Home</Link></p>
      </div>
    );
  }

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
      <AppBar place={folderId ? 'folder' : 'home'} folderId={folderId} onNewFolder={() => setNaming('')} />

      <main className={`flex-1 w-full max-w-7xl mx-auto p-4 flex flex-col gap-6 ${dragging ? 'outline-2 outline-dashed outline-gray-900 -outline-offset-8 bg-gray-100' : ''}`}>
        {folderId === null && latest && (
          <ContinueCard item={latest} bookTitle={latest.bookId ? index.books.get(latest.bookId)?.title : undefined} onOpen={() => open(latest)} />
        )}
        {folderId === null && memoryEmpty && (
          <Link href="/memory" className="flex items-center gap-3 min-h-11 px-4 py-3 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
            <span className="text-indigo-700"><TutorIcon /></span>
            <span className="flex-1 text-gray-700">
              <span className="font-medium text-gray-900">Tell the tutor what you know.</span> Rate a few topics so its hints start at your level. Optional.
            </span>
            <span aria-hidden="true" className="text-gray-500">→</span>
          </Link>
        )}

        <section aria-labelledby="library-heading" className="flex flex-col gap-4">
          {folder && (
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-gray-500 min-w-0">
              <Link href="/" className="text-gray-900 underline">Library</Link>
              {path.slice(0, -1).map((step) => (
                <span key={step.id} className="flex items-center gap-1 min-w-0">
                  <span aria-hidden="true">›</span>
                  <Link href={folderHref(step.id)} className="text-gray-900 underline truncate">{step.name}</Link>
                </span>
              ))}
            </nav>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto flex items-center gap-1 min-w-0">
              {folder && renaming !== null ? (
                <input autoFocus value={renaming} aria-label="Folder name"
                  onChange={(event) => setRenaming(event.target.value)}
                  onBlur={() => { const name = renaming; setRenaming(null); if (name.trim() && name.trim() !== folder.name) void run(() => renameFolder(folder, name)); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') setRenaming(null); }}
                  className="min-h-11 px-2 text-lg font-semibold border border-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
              ) : (
                <h1 id="library-heading" className="text-lg font-semibold text-gray-900 truncate">{heading}</h1>
              )}
              {folder && renaming === null && (confirmingDelete ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-700">Delete the folder? What’s in it moves to {nameOf(index.parent.get(folder.id) ?? null)}.</span>
                  <button onClick={() => void removeFolder(folder.id)} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Delete</button>
                  <button onClick={() => setConfirmingDelete(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
                </span>
              ) : (
                <MoreMenu label="More for this folder" items={[
                  { label: 'Rename', onSelect: () => setRenaming(folder.name) },
                  { label: 'Move to…', onSelect: () => setMoving({ kind: 'folder', folder }) },
                  { label: 'Delete', onSelect: () => setConfirmingDelete(true) },
                ]} />
              ))}
            </div>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={folder ? `Search in ${folder.name}` : 'Search books, problems and notes'}
              aria-label={folder ? `Search in ${folder.name}` : 'Search books, problems and notes'}
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
              onChange={(event) => setSortChoice(event.target.value as HistorySort)}
              aria-label="Sort by"
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white"
            >
              {holdsBook && <option value="book">Book order</option>}
              <option value="updated">Last worked on</option>
              <option value="created">Started</option>
              <option value="title">Name</option>
            </select>
          </div>

          {status && (
            <p role={pdfs.error || error ? 'alert' : 'status'} className={`text-sm ${pdfs.error || error ? 'text-red-700' : 'text-gray-600'}`}>{status}</p>
          )}

          {naming !== null && (
            <form onSubmit={(event) => { event.preventDefault(); void makeFolder(naming); }}
              onKeyDown={(event) => { if (event.key === 'Escape') setNaming(null); }}
              className="flex flex-wrap items-center gap-2 p-3 bg-white border border-gray-900 rounded-xl">
              <label htmlFor="new-folder" className="text-sm text-gray-900">New folder{folder ? ` in ${folder.name}` : ''}</label>
              <input id="new-folder" autoFocus value={naming} onChange={(event) => setNaming(event.target.value)} placeholder="e.g. Chapter 4"
                className="flex-1 min-w-[10rem] max-w-sm min-h-11 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <button type="submit" className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Make folder</button>
              <button type="button" onClick={() => setNaming(null)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            </form>
          )}

          {failed ? (
            <p className="text-center text-sm text-red-600 py-12">Your library could not be loaded. Reload the page to try again.</p>
          ) : library === null ? null : empty && browsing ? (
            folder ? (
              <p className="max-w-md mx-auto text-center text-sm text-gray-500 py-12">
                This folder is empty. Use <strong>+ New</strong> to start a problem or notes here, add a PDF or make a folder, or file something here with <strong>Move to…</strong> in its menu.
              </p>
            ) : (
              <div className="max-w-md mx-auto text-center text-sm text-gray-500 py-12 space-y-2">
                <p className="text-base text-gray-700">Nothing here yet.</p>
                <p>Start with <strong>+ New</strong>: a problem, notes, a PDF to work from (a textbook, a problem set, a handout), or a folder. You can also drop a PDF here.</p>
                <p>Everything you work on is saved here automatically.</p>
              </div>
            )
          ) : empty ? (
            <p className="text-center text-sm text-gray-500 py-12">Nothing matches.</p>
          ) : (
            <>
              {folder && view.books.map((book) => (
                <BookHero key={book.id} book={book} solved={solvedOf(book)} onKind={(kind) => changeKind(book, kind)} named={book.title !== folder.name}
                  onMove={() => setMoving({ kind: 'book', book })} onRemove={() => removeBook(book)} />
              ))}
              {folder && browsing && view.books.length > 0 && view.boards.length === 0 && (
                <p className="text-sm text-gray-500">No boards yet. While reading, use <strong>Mark</strong> on an exercise or a passage to take notes on, and it gets its own board, listed here.</p>
              )}
              {view.folders.length > 0 && (
                <section aria-labelledby="folders-heading" className="flex flex-col gap-3">
                  <h2 id="folders-heading" className="text-base font-semibold text-gray-900">Folders</h2>
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {view.folders.map((entry) => {
                      const cover = (library.books.find((book) => bookLocation(index, book) === entry.id && book.cover)?.cover) ?? null;
                      return (
                        <FolderCard key={entry.id} folder={entry} summary={summaries.get(entry.id)!} cover={cover}
                          parentName={nameOf(index.parent.get(entry.id) ?? null)}
                          onRename={(name) => run(() => renameFolder(entry, name))}
                          onMove={() => setMoving({ kind: 'folder', folder: entry })}
                          onDelete={() => removeFolder(entry.id)} />
                      );
                    })}
                  </ul>
                </section>
              )}
              {!folder && view.books.length > 0 && (
                <section aria-labelledby="books-heading" className="flex flex-col gap-3">
                  <h2 id="books-heading" className="text-base font-semibold text-gray-900">Books</h2>
                  <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {view.books.map((book) => (
                      <BookCard key={book.id} document={book} onRemove={() => removeBook(book)} onKind={(kind) => changeKind(book, kind)}
                        onMove={() => setMoving({ kind: 'book', book })} />
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
                        bookTitle={bookTitle(item)}
                        onOpen={() => open(item)}
                        onRename={(name) => run(() => renameSession(item.id, name))}
                        onMove={() => setMoving({ kind: 'board', item })}
                        onDelete={() => removeBoard(item)}
                        deleteQuestion={item.exerciseId ? 'Delete it and its mark?' : undefined}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </section>
      </main>

      {moving && (
        <MoveDialog
          name={moving.kind === 'board' ? moving.item.title : moving.kind === 'book' ? moving.book.title : moving.folder.name}
          index={index}
          current={moving.kind === 'board' ? itemFolder(index, moving.item) : moving.kind === 'book' ? bookLocation(index, moving.book) : index.parent.get(moving.folder.id) ?? null}
          folderId={moving.kind === 'folder' ? moving.folder.id : undefined}
          onMove={move}
          onClose={() => setMoving(null)}
        />
      )}
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
