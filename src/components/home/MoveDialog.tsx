'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { folderTree, isWithin, type FolderIndex } from '@/lib/folders';
import { FolderIcon, HomeIcon } from '@/components/common/Icons';

interface Props {
  /** What is being moved, for the heading ("Move Exercise 3 to"). */
  name: string;
  index: FolderIndex;
  /** Where it is now (null: the top level); shown, but not offered. */
  current: string | null;
  /** A folder being moved: it can't go inside itself, so it and its folders aren't offered. */
  folderId?: string;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}

// Deeper folders stop indenting, so names stay readable on a phone.
const INDENT = ['pl-3', 'pl-8', 'pl-13', 'pl-18', 'pl-23'];

/** Move to…: the top level and every folder, indented under its parent. */
export default function MoveDialog({ name, index, current, folderId, onMove, onClose }: Props) {
  const tree = useMemo(() => folderTree(index), [index]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const row = (id: string | null, label: string, depth: number, icon: ReactNode) => {
    const here = id === current;
    return (
      <li key={id ?? 'top'}>
        <button onClick={() => onMove(id)} disabled={here}
          className={`${INDENT[Math.min(depth, INDENT.length - 1)]} w-full min-h-11 flex items-center gap-2 pr-3 text-left text-sm text-gray-900 rounded-lg hover:bg-gray-100 disabled:text-gray-500 disabled:hover:bg-transparent`}>
          {icon}<span className="truncate">{label}</span>{here && <span className="ml-auto shrink-0 text-xs">It’s here</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={`Move ${name}`} className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-4 max-h-[80vh] flex flex-col gap-3">
        <h2 className="text-base font-semibold text-gray-900 truncate">Move {name} to</h2>
        <ul className="flex-1 overflow-y-auto flex flex-col">
          {row(null, 'Library (no folder)', 0, <HomeIcon />)}
          {tree.filter(({ folder }) => !folderId || !isWithin(index, folder.id, folderId))
            .map(({ folder, depth }) => row(folder.id, folder.name, depth + 1, <FolderIcon />))}
        </ul>
        {tree.length === 0 && <p className="text-xs text-gray-500">No folders yet. Make one with <strong>+ New → New folder</strong> on Home.</p>}
        <div className="flex justify-end">
          <button onClick={onClose} className="min-h-11 px-4 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
        </div>
      </div>
    </div>
  );
}
