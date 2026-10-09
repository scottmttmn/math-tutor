'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteSession, listSessions, renameSession } from '@/lib/db';
import { queryHistory, toHistoryItem } from '@/lib/history';
import { discardRecoveryCopy } from '@/lib/sessionRecovery';
import BlobImage from '@/components/common/BlobImage';
import type { HistoryItem, HistoryShow, HistorySort } from '@/types';

interface Props {
  isOpen: boolean;
  currentSessionId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onDeleted?: (id: string) => void;
}

const SHOW_OPTIONS: { value: HistoryShow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'inProgress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
  { value: 'notes', label: 'Notes' },
];

/** Every problem and note worked on, free-form and workbook, as a searchable grid. */
export default function History({ isOpen, currentSessionId, onClose, onOpen, onDeleted }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<HistoryShow>('all');
  const [sort, setSort] = useState<HistorySort>('updated');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    listSessions()
      .then((sessions) => {
        if (!active) return;
        setItems(sessions.map(toHistoryItem).filter((item): item is HistoryItem => item !== null));
        setFailed(false);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [isOpen]);

  const shown = useMemo(() => queryHistory(items ?? [], { search, show, sort }), [items, search, show, sort]);

  if (!isOpen) return null;

  const open = (item: HistoryItem) => {
    if (item.href) router.push(item.href);
    else if (item.id !== currentSessionId) onOpen(item.id);
    onClose();
  };

  const rename = async (item: HistoryItem, name: string) => {
    await renameSession(item.id, name);
    const sessions = await listSessions();
    setItems(sessions.map(toHistoryItem).filter((entry): entry is HistoryItem => entry !== null));
  };

  const remove = async (item: HistoryItem) => {
    await deleteSession(item.id);
    discardRecoveryCopy(item.id);
    setItems((current) => current?.filter((entry) => entry.id !== item.id) ?? null);
    onDeleted?.(item.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-50" role="dialog" aria-label="History">
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-800">History</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-white border-b border-gray-200">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search problems and notes"
          aria-label="Search history"
          className="flex-1 min-w-[12rem] px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex rounded-lg border border-gray-300 overflow-hidden" role="group" aria-label="Show">
          {SHOW_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => setShow(option.value)}
              aria-pressed={show === option.value}
              className={`px-3 py-2 text-sm ${show === option.value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(event) => setSort(event.target.value as HistorySort)}
          aria-label="Sort by"
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white"
        >
          <option value="updated">Last worked on</option>
          <option value="created">Started</option>
          <option value="title">Name</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {failed ? (
          <p className="text-center text-sm text-red-600 py-12">History could not be loaded. Close and try again.</p>
        ) : items === null ? null : items.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-12">Nothing here yet. Everything you work on is saved here automatically.</p>
        ) : shown.length === 0 ? (
          <p className="text-center text-sm text-gray-500 py-12">Nothing matches.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {shown.map((item) => (
              <HistoryCard
                key={item.id}
                item={item}
                isCurrent={item.id === currentSessionId}
                onOpen={() => open(item)}
                onRename={(name) => rename(item, name)}
                onDelete={() => remove(item)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  item: HistoryItem;
  isCurrent: boolean;
  onOpen: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}

function HistoryCard({ item, isCurrent, onOpen, onRename, onDelete }: CardProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isNote = item.sessionType === 'note';
  const updated = new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const finishRename = async () => {
    setRenaming(false);
    if (name.trim() !== item.title) await onRename(name);
  };

  return (
    <li className={`flex flex-col bg-white border rounded-xl overflow-hidden ${item.isSolved ? 'border-green-300' : 'border-gray-200'}`}>
      <button onClick={onOpen} className="text-left hover:bg-gray-50" aria-label={`Open ${item.title}`}>
        <Thumbnail blob={item.thumbnail} />
        <div className="px-3 pt-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-gray-500">{isNote ? '📝 Notes' : '📐 Problem'}</span>
            {item.source !== 'board' && <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{item.source === 'shelf' ? 'Shelf' : 'Workbook'}</span>}
            {item.isSolved && <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200">✓ Solved</span>}
            {isCurrent && <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">Open now</span>}
          </div>
          {!renaming && <p className="mt-1 text-sm font-medium text-gray-800 line-clamp-2">{item.title}</p>}
          {/* The problem itself, when the name doesn't already show it (renamed, or a workbook exercise). */}
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
          className="mx-3 mt-1 px-2 py-1.5 text-sm border border-blue-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
      <div className="mt-auto flex items-center justify-between gap-2 px-3 py-2">
        <span className="text-xs text-gray-400">
          {updated}{item.messageCount > 0 ? ` · ${item.messageCount} ${item.messageCount === 1 ? 'message' : 'messages'}` : ''}
        </span>
        {confirmingDelete ? (
          <span className="flex gap-1.5">
            <button onClick={() => void onDelete()} className="px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
              Delete
            </button>
            <button onClick={() => setConfirmingDelete(false)} className="px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
              Keep
            </button>
          </span>
        ) : (
          <span className="flex gap-1.5">
            <button
              onClick={() => { setName(item.title); setRenaming(true); }}
              className="px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Rename
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${item.title}`}
              className="px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100"
            >
              Delete
            </button>
          </span>
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
