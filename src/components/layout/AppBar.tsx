'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionType } from '@/types';
import SettingsModal, { type SettingsTab } from './SettingsModal';
import { RESTORE_RESULT_KEY } from './BackupSettings';
import { useBackupStatus } from '@/hooks/useBackupStatus';
import { backupDue, resumeBackup } from '@/lib/autoBackup';
import { useAddPdfs } from '@/hooks/useAddPdfs';
import { FolderIcon, GearIcon, HomeIcon, NotesIcon, ProblemIcon, ShelfIcon } from '@/components/common/Icons';
import { folderHref } from '@/lib/folders';
import { readerHref } from '@/components/shelf/BookCard';

// Only Home has a tab: a folder and a book (the reader) open from Home, and 'memory' from Settings and Home.
export type AppPlace = 'home' | 'folder' | 'book' | 'board' | 'memory';

interface Props {
  /** Where the page sits; its tab is shown as current. */
  place: AppPlace;
  /** Starts a new board in place (the board page); elsewhere New goes to /board. */
  onNew?: (type: SessionType) => void;
  /** Blocks leaving the page, e.g. while a tutor reply streams in. */
  locked?: boolean;
  /** Runs before another page opens, e.g. saving the board so Home lists the latest work. */
  beforeLeave?: () => Promise<unknown>;
  /** The folder New puts a new board or PDF in (a folder's page); unset: the top level. */
  folderId?: string | null;
  /** Offers New folder, which the page (Home, a folder) makes in place. */
  onNewFolder?: () => void;
  /** Page-specific controls, shown before New. */
  children?: ReactNode;
}

const PLACES: { place: AppPlace; href: string; label: string; icon: ReactNode }[] = [
  { place: 'home', href: '/', label: 'Home', icon: <HomeIcon /> },
];

function takeRestoreResult(): { tab: SettingsTab; restored: string } | null {
  try {
    const restored = sessionStorage.getItem(RESTORE_RESULT_KEY);
    if (!restored) return null;
    sessionStorage.removeItem(RESTORE_RESULT_KEY);
    return { tab: 'backup', restored };
  } catch { return null; }
}

/** The bar on every page: Home, New (a problem, notes, or a PDF to work from), and Settings. Full screen hides it. */
export default function AppBar({ place, onNew, locked = false, beforeLeave, folderId = null, onNewFolder, children }: Props) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(false);
  // The Settings dialog: which tab, and a restore's result to show on Backup.
  const [settings, setSettings] = useState<{ tab: SettingsTab; restored?: string } | null>(null);
  const backup = useBackupStatus();

  // A restore reloads the page; show what it did in the Backup settings it was started from
  // (after hydration, since sessionStorage is the browser's).
  useEffect(() => {
    const timer = setTimeout(() => setSettings((open) => open ?? takeRestoreResult()));
    return () => clearTimeout(timer);
  }, []);
  const newRef = useRef<HTMLDivElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const pdfs = useAddPdfs();

  useEffect(() => {
    if (!newOpen) return;
    const close = (event: MouseEvent) => {
      if (newRef.current && !newRef.current.contains(event.target as Node)) setNewOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [newOpen]);

  const startNew = (type: SessionType) => {
    setNewOpen(false);
    if (onNew) onNew(type);
    else {
      const href = `/board?new=${type}${folderId ? `&folder=${encodeURIComponent(folderId)}` : ''}`;
      void (beforeLeave?.() ?? Promise.resolve()).catch(() => undefined).then(() => router.push(href));
    }
  };

  // A new PDF comes in a folder of its own, and opens on that folder's page, where its boards will be.
  const addPdfs = async (files: File[]) => {
    if (!files.length) return;
    await (beforeLeave?.() ?? Promise.resolve()).catch(() => undefined);
    const added = await pdfs.add(files, folderId);
    if (added.length) router.push(added[0].folderId ? folderHref(added[0].folderId) : readerHref(added[0].id));
  };

  return (
    <nav aria-label="Main" className="flex items-center gap-1.5 sm:gap-2 px-3 py-2 border-b border-gray-200 bg-white">
      <span className="hidden sm:inline px-1 mr-1 text-base font-bold text-gray-900">Math Tutor</span>
      {PLACES.map((item) => (
        <Link
          key={item.place}
          href={item.href}
          aria-label={item.label}
          aria-current={place === item.place ? 'page' : undefined}
          aria-disabled={locked}
          onClick={(event) => {
            if (locked) { event.preventDefault(); return; }
            if (!beforeLeave) return;
            event.preventDefault();
            // Leave even if the save fails: the page's recovery copy keeps the work.
            void beforeLeave().catch(() => undefined).then(() => router.push(item.href));
          }}
          className={`flex items-center gap-1.5 min-h-11 px-3 text-sm rounded-lg ${
            place === item.place ? 'font-semibold text-gray-900 bg-gray-100' : 'text-gray-600 hover:bg-gray-50'
          } ${locked ? 'opacity-50' : ''}`}
        >
          {item.icon}
          <span className="hidden sm:inline">{item.label}</span>
        </Link>
      ))}

      <div className="flex-1" />
      {children}

      {/* Folder backup needs the browser's permission again after a restart, and it only asks from a click. */}
      {backup.state === 'paused' ? (
        <button
          onClick={() => void resumeBackup()}
          title="The browser needs your permission again to write the backup to its folder"
          className="min-h-11 px-3 text-sm font-medium text-gray-900 border-2 border-gray-900 rounded-lg bg-white hover:bg-gray-50"
        >
          Backup paused
        </button>
      ) : backupDue(backup) && (
        <button
          onClick={() => setSettings({ tab: 'backup' })}
          title="Your work has no backup from the last week. Download one or pick a folder to back up to."
          className="min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50"
        >
          Back up
        </button>
      )}

      <div ref={newRef} className="relative">
        <button
          onClick={() => setNewOpen((open) => !open)}
          disabled={locked || Boolean(pdfs.busy)}
          aria-expanded={newOpen}
          className="flex items-center gap-1 min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50"
        >
          <span aria-hidden="true">+</span> New
        </button>
        {newOpen && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
            <button onClick={() => startNew('problem')} className="w-full min-h-11 flex items-center gap-2 text-left px-3 text-sm text-gray-900 hover:bg-gray-100">
              <ProblemIcon />New Problem
            </button>
            <button onClick={() => startNew('note')} className="w-full min-h-11 flex items-center gap-2 text-left px-3 text-sm text-gray-900 hover:bg-gray-100">
              <NotesIcon />New Notes
            </button>
            <button onClick={() => { setNewOpen(false); pdfInput.current?.click(); }} className="w-full min-h-11 flex items-center gap-2 text-left px-3 text-sm text-gray-900 border-t border-gray-100 hover:bg-gray-100">
              <ShelfIcon />Add a PDF…
            </button>
            {onNewFolder && (
              <button onClick={() => { setNewOpen(false); onNewFolder(); }} className="w-full min-h-11 flex items-center gap-2 text-left px-3 text-sm text-gray-900 hover:bg-gray-100">
                <FolderIcon />New folder
              </button>
            )}
          </div>
        )}
        <input ref={pdfInput} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Add a PDF"
          onChange={(event) => { void addPdfs([...(event.target.files ?? [])]); event.target.value = ''; }} />
        {(pdfs.busy || pdfs.error) && (
          <p role={pdfs.error ? 'alert' : 'status'} className={`absolute right-0 top-full mt-1 w-64 px-3 py-2 text-sm bg-white border rounded-lg shadow-lg z-50 ${pdfs.error ? 'text-red-700 border-red-200' : 'text-gray-700 border-gray-200'}`}>
            {pdfs.error || pdfs.busy}
            {pdfs.error && <button onClick={pdfs.clearError} className="ml-2 underline">OK</button>}
          </p>
        )}
      </div>

      <button
        onClick={() => setSettings({ tab: 'tutor' })}
        aria-label="Settings"
        title="Tutor model and backup"
        className="flex items-center justify-center min-h-11 min-w-11 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
      >
        <GearIcon />
      </button>
      <SettingsModal
        isOpen={settings !== null}
        tab={settings?.tab}
        onClose={() => setSettings(null)}
        saveOpenBoard={beforeLeave}
        restoredMessage={settings?.restored}
      />
    </nav>
  );
}
