'use client';

import Link from 'next/link';
import { useState } from 'react';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';
import { FolderIcon } from '@/components/common/Icons';
import { folderHref } from '@/lib/folders';
import type { Folder, FolderSummary } from '@/types';

/** What a folder holds, in a line: its folders, books, problems and notes (solved problems are on the bar). */
export function summaryText(summary: FolderSummary) {
  const count = (n: number, one: string, many: string) => (n > 0 ? `${n} ${n === 1 ? one : many}` : '');
  return [
    count(summary.folders, 'folder', 'folders'), count(summary.books, 'book', 'books'),
    count(summary.problems, 'problem', 'problems'), count(summary.notes, 'note', 'notes'),
  ].filter(Boolean).join(' · ') || 'Empty';
}

interface Props {
  folder: Folder;
  summary: FolderSummary;
  /** The cover of a book inside it (a book's own folder shows its book). */
  cover: Blob | null;
  /** Where its contents go when it is deleted: its parent's name, or the Library. */
  parentName: string;
  onRename: (name: string) => Promise<void>;
  onMove: () => void;
  onDelete: () => Promise<void>;
}

/** A folder in a list: its cover (a book's) or icon, name and what it holds; Rename, Move to and Delete in its menu. */
export default function FolderCard({ folder, summary, cover, parentName, onRename, onMove, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState(false);

  const finishRename = async () => {
    setRenaming(false);
    if (name.trim() && name.trim() !== folder.name) await onRename(name);
  };

  return (
    // No overflow-hidden on the card: it would clip the "⋯" menu.
    <li className="flex flex-col bg-white border border-gray-200 rounded-xl">
      <Link href={folderHref(folder.id)} aria-label={`Open ${folder.name}`} className="block rounded-t-xl overflow-hidden hover:bg-gray-50">
        <div className="aspect-[3/4] bg-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden">
          {cover ? <BlobImage blob={cover} className="w-full h-full object-contain" /> : <span className="text-gray-400"><FolderIcon size={48} /></span>}
        </div>
        <div className="px-3 py-2 grid gap-1">
          {!renaming && (
            <p className="flex items-start gap-1.5 text-sm font-medium text-gray-900"><FolderIcon /><span className="line-clamp-2">{folder.name}</span></p>
          )}
          {summary.problems > 0 && (
            <>
              <div aria-hidden="true" className="h-1.5 border border-gray-900 rounded-sm overflow-hidden">
                <div className="h-full bg-gray-900" style={{ width: `${(summary.solved / summary.problems) * 100}%` }} />
              </div>
              <p className="text-xs text-gray-700">{summary.solved} of {summary.problems} solved</p>
            </>
          )}
          <p className="text-xs text-gray-500">{summaryText(summary)}</p>
        </div>
      </Link>
      {renaming && (
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void finishRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') { setName(folder.name); setRenaming(false); }
          }}
          aria-label="Folder name"
          className="mx-3 mt-1 px-2 py-1.5 text-sm border border-gray-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      )}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 px-3 py-2">
        {confirming ? (
          <>
            <span className="mr-auto text-xs text-gray-700">Delete the folder? What’s in it moves to {parentName}.</span>
            <button onClick={() => void onDelete()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Delete</button>
            <button onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
          </>
        ) : (
          <MoreMenu label={`More for ${folder.name}`} items={[
            { label: 'Rename', onSelect: () => { setName(folder.name); setRenaming(true); } },
            { label: 'Move to…', onSelect: onMove },
            { label: 'Delete', onSelect: () => setConfirming(true) },
          ]} />
        )}
      </div>
    </li>
  );
}
