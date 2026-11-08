'use client';

import { useEffect, useState } from 'react';
import type { ErrorLogEntry } from '@/types';
import { ERROR_KIND_LABELS, clearErrors, errorLogText, listErrors } from '@/lib/errorLog';
import { downloadBlob } from '@/lib/backup';
import { APP_BUILD } from '@/lib/constants';
import { timeAgo } from './BackupSettings';

const plain = 'min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50';

/** Settings' Errors tab: what went wrong on this device, newest first, to copy or save and send. */
export default function ErrorLogSettings({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let live = true;
    void listErrors().then((log) => { if (live) setEntries(log); }, () => { if (live) setEntries([]); });
    return () => { live = false; };
  }, []);

  const text = () => errorLogText(entries ?? [], { build: APP_BUILD, userAgent: navigator.userAgent, now: Date.now() });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setMessage('Copied. Paste it into a message to send it.');
    } catch {
      setMessage('This device wouldn’t copy it. Use Save as file instead.');
    }
  };

  const save = async () => {
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (await downloadBlob(new Blob([text()], { type: 'text/plain' }), `math-tutor-errors-${day}.txt`)) setMessage('Saved.');
    } catch {
      setMessage('Couldn’t save the file.');
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    await clearErrors().catch(() => undefined);
    setEntries(await listErrors().catch(() => []));
    setMessage(null);
  };

  const newestFirst = [...(entries ?? [])].reverse();

  return (
    <div className="text-sm text-gray-700">
      <p className="mb-3">
        Problems the app ran into on this device. If the app closes by itself, why is listed here the next time it opens.
        Nothing is sent anywhere: copy it or save it as a file to share.
      </p>
      {entries === null ? (
        <p className="mb-4 text-gray-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mb-4 text-gray-900" data-testid="error-log-empty">No errors recorded on this device.</p>
      ) : (
        <>
          <ul aria-label="Errors" className="mb-3 max-h-80 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-200">
            {newestFirst.map((entry) => (
              <li key={`${entry.at}-${entry.kind}-${entry.message}`} data-testid="error-entry">
                <details className="px-3 py-2">
                  <summary className="cursor-pointer min-h-11 flex flex-col justify-center">
                    <span className="font-medium text-gray-900">{ERROR_KIND_LABELS[entry.kind] ?? entry.kind}</span>
                    <span className="break-words">{entry.message}</span>
                    <span className="text-xs text-gray-500">
                      {timeAgo(entry.at)}{entry.build ? ` · build ${entry.build}` : ''}{entry.page ? ` · ${entry.page}` : ''}
                    </span>
                  </summary>
                  {entry.detail && <pre className="mt-2 text-xs whitespace-pre-wrap break-words text-gray-700">{entry.detail}</pre>}
                </details>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => void copy()} className={plain}>Copy all</button>
            <button onClick={() => void save()} className={plain}>Save as file</button>
            {confirmClear ? (
              <>
                <button onClick={() => void clear()} className={plain}>Clear the log</button>
                <button onClick={() => setConfirmClear(false)} className={plain}>Keep it</button>
              </>
            ) : (
              <button onClick={() => setConfirmClear(true)} className={plain}>Clear…</button>
            )}
          </div>
        </>
      )}
      {message && <p role="status" className="mb-4 text-gray-900">{message}</p>}
      <div className="flex justify-end">
        <button onClick={onClose} className="min-h-11 px-4 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Done</button>
      </div>
    </div>
  );
}
