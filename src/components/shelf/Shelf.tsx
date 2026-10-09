'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { listShelf } from '@/lib/db';
import { addToShelf, removeFromShelf, startProblemFromFile } from '@/lib/shelf';
import type { ShelfDocument } from '@/types';
import BlobImage from '@/components/common/BlobImage';

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
      router.push('/');
    } catch {
      setBusy('');
      setError(`${file.name} could not be opened. Use a PDF or an image.`);
    }
  };

  const remove = async (document: ShelfDocument) => {
    await removeFromShelf(document);
    setDocuments((current) => current?.filter((item) => item.id !== document.id) ?? null);
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
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="min-w-0">
          <div className="text-xs text-gray-500"><Link href="/" className="text-blue-700 hover:underline">Math Tutor</Link> <span>›</span> Shelf</div>
          <h1 className="font-semibold text-gray-900">Shelf</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => problemInput.current?.click()} disabled={Boolean(busy)} className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 bg-white rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Single problem
          </button>
          <button onClick={() => addInput.current?.click()} disabled={Boolean(busy)} className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">
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

      <main className={`flex-1 p-4 ${dragging ? 'outline-2 outline-dashed outline-blue-400 -outline-offset-8 bg-blue-50' : ''}`}>
        {documents === null ? null : documents.length === 0 ? (
          <div className="max-w-md mx-auto text-center text-sm text-gray-500 py-16 space-y-2">
            <p className="text-base text-gray-700">Your Shelf is empty.</p>
            <p>Add a book or an assignment as a PDF, or drop one here. Mark exercises on its pages and each one gets its own board beside the page.</p>
            <p>For one problem, <strong>Single problem</strong> puts a picture or PDF straight onto a new board.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {documents.map((document) => <ShelfCard key={document.id} document={document} onRemove={() => remove(document)} />)}
          </ul>
        )}
      </main>
    </div>
  );
}

function ShelfCard({ document, onRemove }: { document: ShelfDocument; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const marked = document.exercises.length;
  return (
    <li className="flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
      <Link href={`/shelf/read?doc=${encodeURIComponent(document.id)}`} aria-label={`Open ${document.title}`} className="hover:bg-gray-50">
        <div className="aspect-[3/4] bg-gray-100 border-b border-gray-100 flex items-center justify-center overflow-hidden">
          {document.cover ? <BlobImage blob={document.cover} className="w-full h-full object-contain" /> : <span className="text-xs text-gray-400">PDF</span>}
        </div>
        <div className="px-3 pt-2">
          <p className="text-sm font-medium text-gray-800 line-clamp-2">{document.title}</p>
          <p className="text-xs text-gray-500">
            {document.pageCount} {document.pageCount === 1 ? 'page' : 'pages'}
            {marked > 0 ? ` · ${marked} ${marked === 1 ? 'exercise' : 'exercises'}` : ''}
          </p>
        </div>
      </Link>
      <div className="mt-auto flex justify-end gap-1.5 px-3 py-2">
        {confirming ? (
          <>
            <span className="mr-auto self-center text-xs text-gray-500">{marked > 0 ? 'And its boards?' : 'Remove?'}</span>
            <button onClick={() => void onRemove()} className="px-2.5 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">Remove</button>
            <button onClick={() => setConfirming(false)} className="px-2.5 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Keep</button>
          </>
        ) : (
          <button onClick={() => setConfirming(true)} aria-label={`Remove ${document.title}`} className="px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100">
            Remove
          </button>
        )}
      </div>
    </li>
  );
}
