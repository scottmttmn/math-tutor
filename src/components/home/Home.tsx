'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { deleteSession, listSessions, listShelf, loadProfile, renameSession } from '@/lib/db';
import { isProfileEmpty } from '@/lib/learnerProfile';
import { queryHistory, toHistoryItem } from '@/lib/history';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import { boardToOpen, setBoardToOpen } from '@/lib/currentBoard';
import AppBar from '@/components/layout/AppBar';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';
import { FavoriteStar, KindIcon, ShelfIcon, SolvedCheck, TutorIcon } from '@/components/common/Icons';
import { ShelfCover } from '@/components/shelf/Shelf';
import type { HistoryItem, HistoryShow, HistorySort, ShelfDocument } from '@/types';

const SHOW_OPTIONS: { value: HistoryShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'problems', label: 'Problems' },
  { value: 'notes', label: 'Notes' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
  { value: 'favorites', label: 'Favorites' },
];

// The Shelf row on Home shows the most recently added PDFs; the Shelf has the rest.
const SHELF_PREVIEW = 3;

const loadItems = async () => {
  // Favorites live in the tutor memory; without it, nothing shows as starred.
  const [sessions, profile] = await Promise.all([listSessions(), loadProfile().catch(() => undefined)]);
  const favoriteIds = new Set((profile?.favorites ?? []).map((favorite) => favorite.id));
  return sessions.map((session) => toHistoryItem(session, favoriteIds)).filter((item): item is HistoryItem => item !== null);
};

/**
 * The page the app opens on: the board last worked on, every problem and note (free boards,
 * Shelf exercises) as a searchable grid, and what's on the Shelf.
 */
export default function Home() {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [shelf, setShelf] = useState<ShelfDocument[]>([]);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<HistoryShow>('all');
  const [sort, setSort] = useState<HistorySort>('updated');
  // Until the student tells the tutor about themselves, Home offers it once, quietly.
  const [memoryEmpty, setMemoryEmpty] = useState(false);

  useEffect(() => {
    let active = true;
    loadItems()
      .then((loaded) => { if (active) setItems(loaded); })
      .catch(() => { if (active) setFailed(true); });
    listShelf()
      .then((documents) => { if (active) setShelf(documents.sort((a, b) => b.createdAt - a.createdAt)); })
      .catch(() => { /* The Shelf page reports its own errors. */ });
    loadProfile()
      .then((profile) => { if (active) setMemoryEmpty(!profile || isProfileEmpty(profile)); })
      .catch(() => { /* Not worth an error here. */ });
    return () => { active = false; };
  }, []);

  const shown = useMemo(() => queryHistory(items ?? [], { search, show, sort }), [items, search, show, sort]);
  const latest = useMemo(() => queryHistory(items ?? [], { search: '', show: 'all', sort: 'updated' })[0], [items]);

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

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <AppBar place="home" />

      <main className="flex-1 w-full max-w-7xl mx-auto p-4 flex flex-col gap-6">
        {latest && <ContinueCard item={latest} onOpen={() => open(latest)} />}
        {memoryEmpty && (
          <Link href="/memory" className="flex items-center gap-3 min-h-11 px-4 py-3 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
            <span className="text-indigo-700"><TutorIcon /></span>
            <span className="flex-1 text-gray-700">
              <span className="font-medium text-gray-900">Tell the tutor what you know.</span> Rate a few topics so its hints start at your level. Optional.
            </span>
            <span aria-hidden="true" className="text-gray-500">→</span>
          </Link>
        )}

        <section aria-labelledby="boards-heading" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h1 id="boards-heading" className="mr-auto text-lg font-semibold text-gray-900">Problems and notes</h1>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search problems and notes"
              aria-label="Search problems and notes"
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

          {failed ? (
            <p className="text-center text-sm text-red-600 py-12">Your problems and notes could not be loaded. Reload the page to try again.</p>
          ) : items === null ? null : items.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-12">
              Nothing here yet. Start with <strong>+ New</strong>, or open something on the Shelf. Everything you work on is saved here automatically.
            </p>
          ) : shown.length === 0 ? (
            <p className="text-center text-sm text-gray-500 py-12">Nothing matches.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {shown.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onOpen={() => open(item)}
                  onRename={(name) => rename(item, name)}
                  onDelete={() => remove(item)}
                />
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="shelf-heading" className="flex flex-col gap-3">
          <div className="flex items-baseline gap-3">
            <h2 id="shelf-heading" className="text-lg font-semibold text-gray-900">On your Shelf</h2>
            <Link href="/shelf" className="text-sm text-gray-600 underline hover:text-gray-900">Open the Shelf</Link>
          </div>
          {shelf.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing on your Shelf yet. Add a textbook, a problem set or a handout there as a PDF.</p>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {shelf.slice(0, SHELF_PREVIEW).map((document) => (
                <li key={document.id} className="border border-gray-200 rounded-xl overflow-hidden"><ShelfCover document={document} /></li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}

function ContinueCard({ item, onOpen }: { item: HistoryItem; onOpen: () => void }) {
  return (
    <section aria-label="Continue" className="flex flex-col sm:flex-row gap-4 p-3 bg-white border border-gray-200 rounded-xl">
      <button onClick={onOpen} aria-label={`Continue ${item.title}`} className="sm:w-72 shrink-0 rounded-lg border border-gray-200 overflow-hidden hover:border-gray-400">
        <Thumbnail blob={item.thumbnail} />
      </button>
      <div className="flex flex-col justify-center gap-2 min-w-0">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Continue</span>
        <p className="text-lg font-semibold text-gray-900 line-clamp-2">{item.title}</p>
        <KindLine item={item} />
        <div>
          <button onClick={onOpen} className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">
            Open
          </button>
        </div>
      </div>
    </section>
  );
}

/** What a board is (problem or notes), where it came from, and whether it's solved or a favorite. */
function KindLine({ item }: { item: HistoryItem }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-700">
      <span className="flex items-center gap-1"><KindIcon type={item.sessionType} />{item.sessionType === 'note' ? 'Notes' : 'Problem'}</span>
      {item.source === 'shelf' && <span className="flex items-center gap-1"><ShelfIcon />Shelf</span>}
      {item.isSolved && <span className="flex items-center gap-1 font-semibold text-gray-900"><SolvedCheck size={14} />Solved</span>}
      {item.favorite && <span className="flex items-center gap-1 font-semibold text-gray-900"><FavoriteStar filled size={14} />Favorite</span>}
    </div>
  );
}

interface CardProps {
  item: HistoryItem;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

function HistoryCard({ item, onOpen, onRename, onDelete }: CardProps) {
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
          <KindLine item={item} />
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
            <span className="text-xs text-gray-700">Delete it?</span>
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
              { label: 'Delete', onSelect: () => setConfirmingDelete(true) },
            ]}
          />
        )}
      </div>
    </li>
  );
}

function Thumbnail({ blob }: { blob: Blob | null }) {
  return (
    <div className="aspect-[4/3] bg-white border-b border-gray-100 flex items-center justify-center overflow-hidden">
      {blob ? <BlobImage blob={blob} className="max-w-full max-h-full object-contain p-2" /> : <span className="text-xs text-gray-300">Empty board</span>}
    </div>
  );
}
