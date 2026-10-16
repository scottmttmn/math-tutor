'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { listShelf } from '@/lib/db';
import { SHELF_KINDS, addToShelf, removeFromShelf, setShelfKind, solvedExercises, startProblemFromFile } from '@/lib/shelf';
import type { ShelfDocument, ShelfKind } from '@/types';
import AppBar from '@/components/layout/AppBar';
import BlobImage from '@/components/common/BlobImage';
import MoreMenu from '@/components/common/MoreMenu';

/** PDFs (books, assignments) kept for working through, plus a way to drop a single problem onto a board. */
export default function Shelf() {
  const router = useRouter();
  const [documents, setDocuments] = useState<ShelfDocument[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const problemInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    listShelf()
      .then((items) => { if (active) setDocuments(items); })
      .catch(() => { if (active) setError('The Shelf could not be loaded. Reload to try again.'); });
    return () => { active = false; };
  }, []);

  const add = async (files: File[]) => {
    if (files.length === 0) return;
    setError('');
    const failed: string[] = [];
    for (const file of files) {
      setBusy(`Adding ${file.name}…`);
      try {
        const document = await addToShelf(file);
        setDocuments((current) => [document, ...(current ?? [])]);
      } catch { failed.push(file.name); }
    }
    setBusy('');
    if (failed.length) setError(`${failed.join(', ')} could not be read as a PDF.`);
  };

  const startProblem = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setBusy(`Opening ${file.name}…`);
    try {
      await startProblemFromFile(file);
      router.push('/board');
    } catch {
      setBusy('');
      setError(`${file.name} could not be opened. Use a PDF or an image.`);
    }
  };

  const remove = async (document: ShelfDocument) => {
    await removeFromShelf(document);
    setDocuments((current) => current?.filter((item) => item.id !== document.id) ?? null);
  };

  const changeKind = async (document: ShelfDocument, kind: ShelfKind) => {
    try {
      const updated = await setShelfKind(document, kind);
      setDocuments((current) => current?.map((item) => (item.id === updated.id ? updated : item)) ?? null);
    } catch { setError('That could not be saved. Try again.'); }
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-gray-50"
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void add([...event.dataTransfer.files]);
      }}
    >
      <AppBar place="shelf" />
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="min-w-0">
          <h1 className="font-semibold text-gray-900">Shelf</h1>
          <p className="text-xs text-gray-500">What you work from: textbooks, problem sets, handouts.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => problemInput.current?.click()} disabled={Boolean(busy)} className="min-h-11 px-3 text-sm font-medium text-gray-700 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Single problem
          </button>
          <button onClick={() => addInput.current?.click()} disabled={Boolean(busy)} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-50">
            Add PDF
          </button>
          <input ref={addInput} type="file" accept="application/pdf,.pdf" multiple hidden aria-label="Add PDF"
            onChange={(event) => { void add([...(event.target.files ?? [])]); event.target.value = ''; }} />
          <input ref={problemInput} type="file" accept="application/pdf,.pdf,image/*" hidden aria-label="Single problem"
            onChange={(event) => { void startProblem(event.target.files?.[0]); event.target.value = ''; }} />
        </div>
      </header>

      {(busy || error) && (
        <div role={error ? 'alert' : 'status'} className={`px-4 py-2 text-sm border-b ${error ? 'text-red-700 bg-red-50 border-red-100' : 'text-gray-600 bg-white border-gray-200'}`}>
          {error || busy}
        </div>
      )}

      <main className={`flex-1 p-4 ${dragging ? 'outline-2 outline-dashed outline-gray-900 -outline-offset-8 bg-gray-100' : ''}`}>
        {!documents?.length ? null : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {documents.map((document) => <ShelfCard key={document.id} document={document} onRemove={() => remove(document)} onKind={(kind) => changeKind(document, kind)} />)}
          </ul>
        )}
        {documents?.length === 0 && (
          <div className="max-w-md mx-auto text-center text-sm text-gray-500 py-12 space-y-2">
            <p className="text-base text-gray-700">No PDFs yet.</p>
            <p>Add a textbook, a problem set or a handout as a PDF, or drop one here. Mark exercises, or passages to take notes on, and each one gets its own board beside the page.</p>
            <p>For one problem, <strong>Single problem</strong> puts a picture or PDF straight onto a new board.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ShelfCard({ document, onRemove, onKind }: { document: ShelfDocument; onRemove: () => Promise<void>; onKind: (kind: ShelfKind) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  // What it is is asked until chosen, and again from the menu.
  const [choosing, setChoosing] = useState(false);
  const [solved, setSolved] = useState<number | undefined>(undefined);
  const marked = document.exercises.length;
  useEffect(() => {
    let active = true;
    void solvedExercises(document).then((ids) => { if (active) setSolved(ids.length); }, () => undefined);
    return () => { active = false; };
  }, [document]);
  return (
    // No overflow-hidden on the card: it would clip the "⋯" menu.
    <li className="flex flex-col bg-white border border-gray-200 rounded-xl">
      <div className="rounded-t-xl overflow-hidden"><ShelfCover document={document} solved={solved} /></div>
      {(!document.kind || choosing) && (
        <div role="group" aria-label={`What ${document.title} is`} className="px-3 pt-1">
          <p className="text-xs text-gray-600">What is it?</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {SHELF_KINDS.map(({ kind, label }) => (
              <button key={kind} aria-pressed={document.kind === kind}
                onClick={() => { void onKind(kind); setChoosing(false); }}
                className={`min-h-11 px-2 text-xs rounded-lg border border-gray-900 ${document.kind === kind ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-end gap-1.5 px-3 py-2">
        {confirming ? (
          <>
            <span className="mr-auto text-xs text-gray-700">{marked > 0 ? 'Remove it and its boards?' : 'Remove it?'}</span>
            <button onClick={() => void onRemove()} className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Remove</button>
            <button onClick={() => setConfirming(false)} className="min-h-11 px-3 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
          </>
        ) : (
          <MoreMenu label={`More for ${document.title}`} items={[
            ...(document.kind ? [{ label: 'Change kind', onSelect: () => setChoosing(true) }] : []),
            { label: 'Remove', onSelect: () => setConfirming(true) },
          ]} />
        )}
      </div>
    </li>
  );
}

/**
 * A PDF's cover, title, kind, progress and where you left off, opening it there in the reader. Also
 * used on Home, which passes no `solved` (exercises then show as a count).
 */
export function ShelfCover({ document, solved }: { document: ShelfDocument; solved?: number }) {
  const notes = document.exercises.filter((item) => item.kind === 'note').length;
  const exercises = document.exercises.length - notes;
  const kind = SHELF_KINDS.find((item) => item.kind === document.kind)?.label;
  const notesText = `${notes} ${notes === 1 ? 'note page' : 'note pages'}`;
  // Where you left off, once the reader has saved a place (older records only have the page).
  const opened = document.lastPageLabel !== undefined || document.lastPage > 1;
  return (
    <Link href={`/shelf/read?doc=${encodeURIComponent(document.id)}`} aria-label={`Open ${document.title}`} className="block bg-white hover:bg-gray-50">
      <div className="aspect-[3/4] bg-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden">
        {document.cover ? <BlobImage blob={document.cover} className="w-full h-full object-contain" /> : <span className="text-xs text-gray-400">PDF</span>}
      </div>
      <div className="px-3 py-2 grid gap-1">
        <p className="text-sm font-medium text-gray-900 line-clamp-2">{document.title}</p>
        {kind && <span className="justify-self-start px-2 text-xs leading-5 text-gray-900 border border-gray-900 rounded-full">{kind}</span>}
        {exercises > 0 && solved !== undefined ? (
          <>
            <div aria-hidden="true" className="h-1.5 border border-gray-900 rounded-sm overflow-hidden">
              <div className="h-full bg-gray-900" style={{ width: `${(solved / exercises) * 100}%` }} />
            </div>
            <p className="text-xs text-gray-700">{solved} of {exercises} solved{notes > 0 ? ` · ${notesText}` : ''}</p>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            {exercises > 0 ? `${exercises} ${exercises === 1 ? 'exercise' : 'exercises'}` : notes > 0 ? '' : `${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}`}
            {exercises > 0 && notes > 0 ? ' · ' : ''}{notes > 0 ? notesText : ''}
          </p>
        )}
        {opened && (
          <p className="text-xs text-gray-500 truncate">
            p. {document.lastPageLabel ?? document.lastPage}{document.lastSection ? ` · ${document.lastSection}` : ''}
          </p>
        )}
      </div>
    </Link>
  );
}
