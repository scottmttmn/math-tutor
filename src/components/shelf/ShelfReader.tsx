'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';
import { useTutorChat } from '@/hooks/useTutorChat';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { loadShelfDocument, saveShelfDocument, shelfSessionId } from '@/lib/db';
import { openPdf } from '@/lib/pdf';
import { ensureExerciseBoard, markExercise, nextLabel, solvedExercises, unmarkExercise } from '@/lib/shelf';
import type { PageRect, ShelfDocument, ShelfExercise } from '@/types';
import DrawingCanvas, { type DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import BottomToolbar from '@/components/layout/BottomToolbar';
import ChatPanel from '@/components/chat/ChatPanel';
import PdfPage from './PdfPage';

// Reading position is saved once the student stops turning pages.
const PAGE_SAVE_DELAY_MS = 1000;

function readUrl() {
  const params = new URLSearchParams(window.location.search);
  return { documentId: params.get('doc'), exerciseId: params.get('open') };
}

function writeUrl(documentId: string, exerciseId: string | null) {
  const query = `?doc=${encodeURIComponent(documentId)}${exerciseId ? `&open=${encodeURIComponent(exerciseId)}` : ''}`;
  window.history.replaceState(null, '', `${window.location.pathname}${query}`);
}

/** A Shelf PDF, page by page, with marked exercises; each opens on its own board beside the page. */
export default function ShelfReader() {
  const [shelfDocument, setShelfDocument] = useState<ShelfDocument | null>(null);
  const documentRef = useRef<ShelfDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);
  const [pendingMark, setPendingMark] = useState<PageRect | null>(null);
  const [markLabel, setMarkLabel] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [solvedIds, setSolvedIds] = useState<string[]>([]);
  const [tab, setTab] = useState<'page' | 'tutor'>('page');
  const switching = useRef(false);

  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  const sentRevision = useRef<number | null>(null);
  const { isStreaming, isSolved, currentSessionId } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { status: saveStatus, saveNow, openSession, startNew } = useSessionAutosave(canvasHandle, { reopenLast: false });

  const updateDocument = useCallback((next: ShelfDocument) => {
    documentRef.current = next;
    setShelfDocument(next);
  }, []);

  const openExercise = useCallback(async (exercise: ShelfExercise, loaded?: { pdf: PDFDocumentProxy; document: ShelfDocument }) => {
    const source = loaded ?? (pdf && documentRef.current ? { pdf, document: documentRef.current } : null);
    if (!source || switching.current || isStreaming) return;
    switching.current = true;
    setError('');
    try {
      const id = await ensureExerciseBoard(source.pdf, source.document, exercise);
      if (!await openSession(id)) throw new Error('Not opened');
      setOpenId(exercise.id);
      setPage(exercise.page);
      setMarking(false);
      writeUrl(source.document.id, exercise.id);
    } catch {
      setError('That exercise could not be opened. Try again.');
    } finally { switching.current = false; }
  }, [pdf, isStreaming, openSession]);

  // Load the PDF named in the URL, and the exercise if one is named.
  useEffect(() => {
    let active = true;
    let opened: PDFDocumentProxy | null = null;
    async function load() {
      const { documentId, exerciseId } = readUrl();
      const stored = documentId ? await loadShelfDocument(documentId) : undefined;
      if (!stored) { if (active) setLoadError('This PDF is not on your Shelf.'); return; }
      opened = await openPdf(stored.file);
      if (!active) return;
      updateDocument(stored);
      setPdf(opened);
      setPage(Math.min(Math.max(1, stored.lastPage), opened.numPages));
      setSolvedIds(await solvedExercises(stored));
      const exercise = stored.exercises.find((item) => item.id === exerciseId);
      if (exercise && active) await openExercise(exercise, { pdf: opened, document: stored });
    }
    load().catch(() => { if (active) setLoadError('This PDF could not be opened.'); });
    return () => { active = false; void opened?.loadingTask.destroy(); };
    // Runs once: later openExercise identities must not reload the PDF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [updateDocument]);

  // Remember the page for next time.
  useEffect(() => {
    const current = documentRef.current;
    if (!current || current.lastPage === page) return;
    const timer = setTimeout(() => {
      const latest = documentRef.current;
      if (!latest) return;
      const next = { ...latest, lastPage: page, updatedAt: Date.now() };
      documentRef.current = next;
      void saveShelfDocument(next).catch(() => { /* Only the reading position is lost. */ });
    }, PAGE_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [page]);

  // Keep the marks' ✓ in step with the open board's Mark Solved.
  useEffect(() => {
    if (!openId || !shelfDocument || currentSessionId !== shelfSessionId(shelfDocument.id, openId)) return;
    setSolvedIds((current) => {
      const has = current.includes(openId);
      if (isSolved === has) return current;
      return isSolved ? [...current, openId] : current.filter((id) => id !== openId);
    });
  }, [isSolved, openId, shelfDocument, currentSessionId]);

  const closeExercise = async () => {
    if (!shelfDocument || isStreaming || switching.current) return;
    switching.current = true;
    try {
      if (!await startNew('problem')) { setError('Your board could not be saved. Try again.'); return; }
      setOpenId(null);
      setTab('page');
      writeUrl(shelfDocument.id, null);
    } finally { switching.current = false; }
  };

  const saveMark = async () => {
    const current = documentRef.current;
    if (!pdf || !current || !pendingMark) return;
    const rect = pendingMark;
    setPendingMark(null);
    try {
      const { document: next, exercise } = await markExercise(pdf, current, page, rect, markLabel);
      updateDocument(next);
      await openExercise(exercise, { pdf, document: next });
    } catch {
      setError('The exercise could not be saved. Try again.');
    }
  };

  const removeMark = async (exercise: ShelfExercise) => {
    const current = documentRef.current;
    if (!current || isStreaming) return;
    if (exercise.id === openId) {
      // Let any save already under way land first, so it can't bring the board back after removal.
      await saveNow();
      if (!await startNew('problem', { discardCurrent: true })) return;
      setOpenId(null);
      setTab('page');
      writeUrl(current.id, null);
    }
    try {
      updateDocument(await unmarkExercise(current, exercise.id));
      setSolvedIds((ids) => ids.filter((id) => id !== exercise.id));
    } catch { setError('The exercise could not be removed. Try again.'); }
  };

  const askForHelp = async () => {
    if (getTutorWaitMs() > 0) return;
    const handle = canvasHandle.current;
    sentRevision.current = handle?.getRevision() ?? null;
    const image = await handle?.captureImage() ?? '';
    setTab('tutor');
    await sendHelp(image);
  };

  const followUpImage = useCallback(async (): Promise<string> => {
    const handle = canvasHandle.current;
    if (!handle || handle.getRevision() === sentRevision.current) return '';
    sentRevision.current = handle.getRevision();
    return handle.captureImage();
  }, []);

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 text-center p-6">
        <div className="space-y-3">
          <p className="text-gray-700">{loadError}</p>
          <Link href="/shelf" className="text-blue-700 underline">Back to the Shelf</Link>
        </div>
      </div>
    );
  }
  if (!shelfDocument || !pdf) return <div className="p-6 text-gray-500">Opening PDF…</div>;

  const exercise = shelfDocument.exercises.find((item) => item.id === openId) ?? null;
  const marksOnPage = shelfDocument.exercises.filter((item) => item.page === page);
  const pageCount = pdf.numPages;

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Link href="/" className="text-blue-700 hover:underline">Math Tutor</Link><span>›</span>
            <Link href="/shelf" className="text-blue-700 hover:underline">Shelf</Link>
          </div>
          <h1 className="font-semibold text-gray-900 truncate">{shelfDocument.title}</h1>
        </div>
        {exercise && (
          <span className="text-xs text-gray-500" aria-live="polite">
            {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : saveStatus === 'saved' ? 'Saved' : ''}
          </span>
        )}
      </header>

      {error && <div role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

      {/* Side by side on wide screens; page above board on a tablet held upright, both in view. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <section className="basis-[45%] lg:basis-auto lg:flex-1 min-w-0 min-h-0 flex flex-col border-b lg:border-b-0 border-gray-200">
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
            {exercise && (
              <div className="flex rounded-lg border border-gray-300 overflow-hidden" role="group" aria-label="Show">
                {(['page', 'tutor'] as const).map((value) => (
                  <button key={value} onClick={() => setTab(value)} aria-pressed={tab === value}
                    className={`px-3 py-2 text-sm ${tab === value ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                    {value === 'page' ? 'Page' : 'Tutor'}
                  </button>
                ))}
              </div>
            )}
            {tab === 'page' && (
              <>
                <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1} aria-label="Previous page"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">‹ Prev</button>
                <span className="text-sm text-gray-600 tabular-nums">Page {page} of {pageCount}</span>
                <button onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount} aria-label="Next page"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40">Next ›</button>
                <div className="flex-1" />
                <button
                  onClick={() => { setMarking((on) => !on); setPendingMark(null); }}
                  aria-pressed={marking}
                  className={`px-3 py-2 text-sm font-medium rounded-lg border ${marking ? 'bg-amber-500 border-amber-500 text-white' : 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}
                >
                  {marking ? 'Done marking' : 'Mark exercise'}
                </button>
              </>
            )}
          </div>

          {tab === 'tutor' && exercise ? (
            <div className="flex-1 min-h-0"><ChatPanel getCanvasImage={followUpImage} /></div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto p-3">
              {marking && !pendingMark && <p className="mb-2 text-sm text-amber-800">Drag a box around an exercise on the page.</p>}
              {pendingMark && (
                <form onSubmit={(event) => { event.preventDefault(); void saveMark(); }} className="mb-2 flex flex-wrap items-center gap-2 p-2 rounded-lg bg-amber-50 border border-amber-200">
                  <label className="text-sm text-amber-900" htmlFor="mark-label">Name</label>
                  <input id="mark-label" value={markLabel} onChange={(event) => setMarkLabel(event.target.value)}
                    className="flex-1 min-w-[8rem] px-2 py-1.5 text-sm border border-amber-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-amber-500" />
                  <button type="submit" className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">Save and open</button>
                  <button type="button" onClick={() => setPendingMark(null)} className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">Cancel</button>
                </form>
              )}
              <PdfPage
                pdf={pdf} pageNumber={page} marks={marksOnPage} solvedIds={solvedIds} activeId={openId} marking={marking && !pendingMark}
                onMark={(rect) => { setPendingMark(rect); setMarkLabel(nextLabel(shelfDocument)); }}
                onOpenMark={(mark) => void openExercise(mark)}
              />
            </div>
          )}
        </section>

        <section className="flex-1 lg:flex-none lg:w-1/2 min-h-0 flex flex-col lg:border-l border-gray-200 bg-white">
          {exercise ? (
            <>
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-gray-900 truncate">{exercise.label}</h2>
                  <p className="text-xs text-gray-500">Page {exercise.page}</p>
                </div>
                {exercise.page !== page && (
                  <button onClick={() => { setPage(exercise.page); setTab('page'); }} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Show page</button>
                )}
                <button onClick={() => void removeMark(exercise)} disabled={isStreaming} className="px-3 py-1.5 text-sm text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">Remove</button>
                <button onClick={() => void closeExercise()} disabled={isStreaming} aria-label="Close board" className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Close</button>
              </div>
              <div className="relative flex-1 min-h-0">
                <DrawingCanvas handleRef={canvasHandle} />
              </div>
              <BottomToolbar
                onAskForHelp={() => void askForHelp()}
                onClear={() => canvasHandle.current?.clear()}
                isStreaming={isStreaming}
                isSolved={isSolved}
                onToggleSolved={() => sessionDispatch({ type: 'TOGGLE_SOLVED' })}
                sessionType="problem"
              />
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-4">
              <h2 className="font-semibold text-gray-900">Exercises</h2>
              {shelfDocument.exercises.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">Tap <strong>Mark exercise</strong> and drag a box around a problem on the page. It opens here on its own board, and stays marked on the page.</p>
              ) : (
                <ul className="mt-3 grid gap-2">
                  {[...shelfDocument.exercises].sort((a, b) => a.page - b.page || a.rect.y - b.rect.y).map((item) => (
                    <li key={item.id}>
                      <button onClick={() => void openExercise(item)} disabled={isStreaming}
                        className="w-full text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">
                        <span className="font-medium text-gray-900">{item.label}</span>
                        <span className="ml-2 text-xs text-gray-500">Page {item.page}</span>
                        {solvedIds.includes(item.id) && <span className="ml-2 text-xs text-green-700">✓ Solved</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
