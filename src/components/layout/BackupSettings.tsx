'use client';

import { useRef, useState } from 'react';
import { useBackupStatus } from '@/hooks/useBackupStatus';
import { BACKUP_FOLDER_NAME, backUpNow, chooseBackupFolder, recordDownload, resumeBackup, stopBackup } from '@/lib/autoBackup';
import { backupFileName, backupZip, downloadBlob, restoreFromFiles } from '@/lib/backup';
import type { RestoreResult } from '@/types';

/** "just now", "5 minutes ago", "3 days ago", or the date. */
export function timeAgo(at: number, now = Date.now()) {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function describeRestore(result: RestoreResult) {
  const parts: string[] = [];
  const boards = result.restoredSessions;
  const pdfs = result.restoredShelf;
  const restored = [
    boards && `${boards} board${boards === 1 ? '' : 's'}`,
    pdfs && `${pdfs} Shelf PDF${pdfs === 1 ? '' : 's'}`,
    result.restoredProfile && 'your tutor memory',
    result.restoredInk && `ink on ${result.restoredInk} page${result.restoredInk === 1 ? '' : 's'}`,
  ].filter(Boolean);
  if (restored.length) {
    parts.push(`Restored ${restored.length > 1 ? `${restored.slice(0, -1).join(', ')} and ${restored.at(-1)}` : restored[0]}.`);
  } else parts.push('Nothing to restore: this device already has everything in the backup.');
  if (result.skipped && restored.length) parts.push(`${result.skipped} already up to date here.`);
  if (result.missingPdfs.length) parts.push(`Not restored, because the PDF wasn't with the backup: ${result.missingPdfs.join(', ')}.`);
  return parts.join(' ');
}

/** Where a restore's result waits while the page reloads; the bar reopens Backup with it. */
export const RESTORE_RESULT_KEY = 'math-tutor:restoreResult';

const plain = 'min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50';

/** The Backup tab of Settings: folder backup, download, restore, and whether the browser keeps the data. */
interface Props {
  onClose: () => void;
  /** Saves the board open on this page, so a backup holds its latest strokes; false when the save failed. */
  saveOpenBoard?: () => Promise<unknown>;
  /** What a restore did, shown after the page reloaded for it. */
  restoredMessage?: string;
}

export default function BackupSettings({ onClose, saveOpenBoard, restoredMessage }: Props) {
  const status = useBackupStatus();
  const [busy, setBusy] = useState<'download' | 'restore' | 'backup' | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(restoredMessage ? { text: restoredMessage } : null);

  // The open board autosaves after a pause; a backup taken now must not miss what was just written.
  const saveBoard = async () => {
    if (!saveOpenBoard) return;
    const saved = await saveOpenBoard().catch(() => false);
    if (saved === false) throw new Error('This board’s latest changes could not be saved, so nothing was backed up or restored. Try again.');
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const run = async (kind: NonNullable<typeof busy>, work: () => Promise<string | null>) => {
    setBusy(kind);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ text });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : 'Something went wrong.', error: true });
    } finally { setBusy(null); }
  };

  const download = () => run('download', async () => {
    await saveBoard();
    // A cancelled Save dialog (Android app) is not a backup, so the reminder stays.
    if (await downloadBlob(await backupZip(), backupFileName())) await recordDownload();
    return null;
  });

  const restore = (files: FileList | null) => {
    if (!files?.length) return;
    const picked = [...files];
    void run('restore', async () => {
      await saveBoard();
      const result = await restoreFromFiles(picked);
      if (!result.restoredSessions && !result.restoredShelf && !result.restoredProfile && !result.restoredInk) return describeRestore(result);
      // The page still holds what it loaded before the restore, and its next autosave would write
      // that over a restored copy; reload so it shows what is saved now.
      try { sessionStorage.setItem(RESTORE_RESULT_KEY, describeRestore(result)); } catch { /* The reload still happens. */ }
      window.location.reload();
      return null;
    });
  };

  return (
    <div className="text-sm text-gray-700">
      <section aria-label="Backup folder" className="mb-5">
        <h3 className="font-semibold text-gray-900 mb-1">Back up automatically</h3>
        {!status.folderSupported ? (
          <p>This browser can&apos;t keep a backup in a folder by itself. Download a backup now and then and keep it somewhere safe, like Google Drive.</p>
        ) : status.state === 'off' ? (
          <>
            <p className="mb-2">Pick a folder, for example one in Dropbox or iCloud Drive, and a copy of all your work is kept there, updated shortly after each change.</p>
            <button onClick={() => void run('backup', async () => { await chooseBackupFolder(); return null; })} disabled={busy !== null} className={plain}>Choose folder…</button>
          </>
        ) : (
          <>
            <p className="mb-2">
              Backing up to <span className="font-medium text-gray-900">{status.folderName === BACKUP_FOLDER_NAME ? status.folderName : `${status.folderName}/${BACKUP_FOLDER_NAME}`}</span>.{' '}
              {status.state === 'writing' ? 'Writing the backup…' : status.lastBackupAt ? `Last backup ${timeAgo(status.lastBackupAt)}.` : ''}
            </p>
            {status.state === 'paused' && <p className="mb-2 text-gray-900">Paused: the browser needs your permission again to write to that folder.</p>}
            {status.state === 'error' && <p className="mb-2 text-red-700">The last backup failed: {status.error}</p>}
            <div className="flex flex-wrap gap-2">
              {status.state === 'paused'
                ? <button onClick={() => void run('backup', async () => { await resumeBackup(); return null; })} disabled={busy !== null} className={plain}>Allow and back up</button>
                : <button onClick={() => void run('backup', async () => { await saveBoard(); await backUpNow(true); return null; })} disabled={busy !== null || status.state === 'writing'} className={plain}>Back up now</button>}
              <button onClick={() => void run('backup', async () => { await chooseBackupFolder(); return null; })} disabled={busy !== null} className={plain}>Change folder…</button>
              <button onClick={() => void stopBackup()} disabled={busy !== null} className={plain}>Stop</button>
            </div>
          </>
        )}
      </section>

      <section aria-label="Download and restore" className="mb-5">
        <h3 className="font-semibold text-gray-900 mb-1">Download or restore</h3>
        <p className="mb-2">
          One file with every board, note and Shelf PDF, and your tutor memory.
          {status.lastDownloadAt ? ` Last downloaded ${timeAgo(status.lastDownloadAt)}.` : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void download()} disabled={busy !== null} className={plain}>{busy === 'download' ? 'Preparing…' : 'Download backup'}</button>
          <button onClick={() => fileInput.current?.click()} disabled={busy !== null} className={plain}>{busy === 'restore' ? 'Restoring…' : 'Restore from file…'}</button>
          <button onClick={() => folderInput.current?.click()} disabled={busy !== null} className={plain} title={`Pick the "${BACKUP_FOLDER_NAME}" folder`}>Restore from folder…</button>
        </div>
        <p className="mt-2 text-xs text-gray-500">Restoring adds what this device doesn&apos;t have and updates older copies; newer work here is kept.</p>
        <input ref={fileInput} type="file" accept=".zip,.json,application/zip,application/json" className="hidden" data-testid="restore-file"
          onChange={(event) => { restore(event.target.files); event.target.value = ''; }} />
        <input ref={folderInput} type="file" className="hidden" data-testid="restore-folder"
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(event) => { restore(event.target.files); event.target.value = ''; }} />
      </section>

      {message && <p role="status" className={`mb-4 ${message.error ? 'text-red-700' : 'text-gray-900'}`}>{message.text}</p>}

      {status.persisted !== null && (
        <p className="mb-4 text-xs text-gray-500">
          {status.persisted
            ? 'This browser has agreed to keep your work stored, even when the device runs low on space.'
            : 'This browser may clear stored work if the device runs low on space, so keep a backup.'}
        </p>
      )}

      <div className="flex justify-end">
        <button onClick={onClose} className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Done</button>
      </div>
    </div>
  );
}
