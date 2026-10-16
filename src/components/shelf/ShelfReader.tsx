'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useBoardFullScreen } from '@/hooks/useBoardFullScreen';
import { useToolsHidden } from '@/hooks/useToolsHidden';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { loadShelfDocument, saveShelfDocument, shelfSessionId } from '@/lib/db';
import { openPdf, trimmedArea } from '@/lib/pdf';
import { findPage, pageName } from '@/lib/reader';
import { ensureExerciseBoard, markExercise, nextLabel, setReadFrom, solvedExercises, unmarkExercise } from '@/lib/shelf';
import { MAX_BOOK_PAGES, loadContents, loadSectionStarts, readBookPages, readingRange, type ContentsEntry, type ReadingRange, type SectionStart } from '@/lib/bookContext';
import type { BookContext, PageRect, ShelfDocument, ShelfExercise } from '@/types';
import DrawingCanvas, { type DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import BottomToolbar from '@/components/layout/BottomToolbar';
import AppBar from '@/components/layout/AppBar';
import ChatPanel, { focusTutorQuestion } from '@/components/chat/ChatPanel';
import MoreMenu from '@/components/common/MoreMenu';
import { ProblemIcon, SolvedCheck } from '@/components/common/Icons';
import BoardFrame from '@/components/layout/BoardFrame';
import { saveBoardAs } from '@/lib/exportBoard';
import PdfPage from './PdfPage';

// Whether the Exercises list beside the page is hidden, so the page gets the width.
const LIST_HIDDEN_KEY = 'math-tutor:shelfListHidden';

// Which list is beside the page: the marked exercises or the PDF's contents.
type ListTab = 'exercises' | 'contents';

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
  const [tutorOpen, setTutorOpen] = useState(false);
  const [sectionStarts, setSectionStarts] = useState<SectionStart[]>([]);
  const [bookHasText, setBookHasText] = useState(true);
  const { fullScreen, toggle: toggleFullScreen, leave: leaveFullScreen } = useBoardFullScreen();
  const { toolsHidden, toggleTools } = useToolsHidden();
  const [listHidden, setListHidden] = useState(false);
  const [listTab, setListTab] = useState<ListTab>('exercises');
  // Printed page numbers ("xii", "47") when the PDF records them; the PDF's bookmarks.
  const [labels, setLabels] = useState<string[] | null>(null);
  const [contents, setContents] = useState<ContentsEntry[]>([]);
  // The printed part of the pages; undefined while it is being measured.
  const [printed, setPrinted] = useState<PageRect | null | undefined>(undefined);
  // Typing a page to go to (null when not), and what went wrong with the last one.
  const [goTo, setGoTo] = useState<string | null>(null);
  const [goToError, setGoToError] = useState('');
  // Reading full screen: the bars come and go with a tap in the middle of the page; the list is a panel.
  const [barsShown, setBarsShown] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const pageArea = useRef<HTMLDivElement>(null);
  const switching = useRef(false);
  const book = useRef<{ pdf: PDFDocumentProxy; document: ShelfDocument; range: ReadingRange } | null>(null);

  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  const sentRevision = useRef<number | null>(null);
  const { isStreaming, isSolved, currentSessionId, problemImage } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  // The pages before the open exercise, read when a question is sent (each page's text is kept).
  const getBookContext = useCallback(async (): Promise<BookContext | null> => {
    const current = book.current;
    return current ? readBookPages(current.pdf, current.document, current.range) : null;
  }, []);
  const { sendHelp } = useTutorChat(getBookContext);
  const { status: saveStatus, saveNow, openSession, startNew } = useSessionAutosave(canvasHandle, { reopenLast: false });

  const updateDocument = useCallback((next: ShelfDocument) => {
    documentRef.current = next;
    setShelfDocument(next);
  }, []);

  // Writes to the PDF's record run one at a time, each from the record the previous one left, so a
  // slow write (a page turn, a mark) can't save over a newer one with stale exercises.
  const documentWrites = useRef<Promise<unknown>>(Promise.resolve());
  const writeDocument = useCallback(<T,>(write: (current: ShelfDocument) => Promise<T>): Promise<T> => {
    const run = () => {
      const current = documentRef.current;
      return current ? write(current) : Promise.reject(new Error('No document'));
    };
    const result = documentWrites.current.then(run, run);
    documentWrites.current = result.catch(() => undefined);
    return result;
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
      setTutorOpen(false);
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
      // Left before it finished opening: the cleanup has already run, so free it here.
      if (!active) { void opened.loadingTask.destroy(); return; }
      updateDocument(stored);
      setPdf(opened);
      void loadSectionStarts(opened).then((starts) => { if (active) setSectionStarts(starts); });
      void loadContents(opened).then((entries) => { if (active) setContents(entries); });
      void opened.getPageLabels().then((found) => { if (active) setLabels(found); }, () => undefined);
      void trimmedArea(opened).then((area) => { if (active) setPrinted(area); });
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

  // Read in an effect: localStorage isn't there during server rendering.
  useEffect(() => {
    try { setListHidden(localStorage.getItem(LIST_HIDDEN_KEY) === '1'); } catch { /* stays shown */ }
  }, []);
  const changeListHidden = (next: boolean) => {
    setListHidden(next);
    try { localStorage.setItem(LIST_HIDDEN_KEY, next ? '1' : '0'); } catch { /* only for this visit */ }
  };

  // Remember the page for next time.
  useEffect(() => {
    const current = documentRef.current;
    if (!current || current.lastPage === page) return;
    const timer = setTimeout(() => {
      void writeDocument(async (latest) => {
        const next = { ...latest, lastPage: page, updatedAt: Date.now() };
        await saveShelfDocument(next);
        documentRef.current = next;
      }).catch(() => { /* Only the reading position is lost. */ });
    }, PAGE_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [page, writeDocument]);

  // Keep the marks' ✓ in step with the open board's Mark Solved.
  useEffect(() => {
    if (!openId || !shelfDocument || currentSessionId !== shelfSessionId(shelfDocument.id, openId)) return;
    setSolvedIds((current) => {
      const has = current.includes(openId);
      if (isSolved === has) return current;
      return isSolved ? [...current, openId] : current.filter((id) => id !== openId);
    });
  }, [isSolved, openId, shelfDocument, currentSessionId]);

  // A new page starts at its top, and a box drawn but not saved stays with the page it was drawn on.
  useEffect(() => {
    pageArea.current?.closest('.overflow-y-auto')?.scrollTo?.(0, 0);
    setPendingMark(null);
  }, [page]);

  const pageCount = pdf?.numPages ?? 1;
  const turn = useCallback((direction: -1 | 1) => {
    setPage((current) => Math.min(pageCount, Math.max(1, current + direction)));
  }, [pageCount]);

  // Arrow keys turn the page while no board is open (a board uses them for its drawing).
  useEffect(() => {
    if (openId) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.altKey || event.ctrlKey || event.metaKey || target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') turn(-1);
      else if (event.key === 'ArrowRight') turn(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openId, turn]);

  // Leaving full screen brings the bars back for next time.
  useEffect(() => { if (!fullScreen) { setBarsShown(true); setPanelOpen(false); } }, [fullScreen]);

  const closeExercise = async () => {
    if (!shelfDocument || isStreaming || switching.current) return;
    switching.current = true;
    try {
      if (!await startNew('problem')) { setError('Your board could not be saved. Try again.'); return; }
      setOpenId(null);
      setTutorOpen(false);
      writeUrl(shelfDocument.id, null);
    } finally { switching.current = false; }
  };

  const saveMark = async () => {
    if (!pdf || !pendingMark) return;
    const rect = pendingMark;
    const markPage = page;
    setPendingMark(null);
    try {
      const { document: next, exercise } = await writeDocument(async (current) => {
        const marked = await markExercise(pdf, current, markPage, rect, markLabel);
        updateDocument(marked.document);
        return marked;
      });
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
      setTutorOpen(false);
      writeUrl(current.id, null);
    }
    try {
      await writeDocument(async (latest) => updateDocument(await unmarkExercise(latest, exercise.id)));
      setSolvedIds((ids) => ids.filter((id) => id !== exercise.id));
    } catch { setError('The exercise could not be removed. Try again.'); }
  };

  const changeTrim = async (trimMargins: boolean) => {
    try {
      await writeDocument(async (latest) => {
        const next = { ...latest, trimMargins, updatedAt: Date.now() };
        await saveShelfDocument(next);
        updateDocument(next);
      });
    } catch { setError('That could not be saved. Try again.'); }
  };

  const submitGoTo = () => {
    const found = findPage(goTo ?? '', labels, pageCount);
    if (!found) { setGoToError(`There is no page ${goTo?.trim()} in this PDF.`); return; }
    setPage(found);
    setGoTo(null);
    setGoToError('');
  };

  const goToEntry = (target: number) => {
    setPage(target);
    setPanelOpen(false);
  };

  const changeReadFrom = async (exerciseId: string, readFrom: number) => {
    try {
      await writeDocument(async (latest) => updateDocument(await setReadFrom(latest, exerciseId, readFrom)));
    } catch { setError('That could not be saved. Try again.'); }
  };

  const openExerciseForBook = shelfDocument?.exercises.find((item) => item.id === openId) ?? null;
  const range = shelfDocument && openExerciseForBook ? readingRange(shelfDocument, openExerciseForBook, sectionStarts) : null;
  book.current = pdf && shelfDocument && range ? { pdf, document: shelfDocument, range } : null;

  // Say so when the pages have no text to read (a scanned book).
  const rangeKey = range ? `${range.from}-${range.to}` : '';
  useEffect(() => {
    setBookHasText(true);
    const current = book.current;
    if (!current) return;
    let active = true;
    void readBookPages(current.pdf, current.document, current.range)
      .then((context) => { if (active) setBookHasText(context !== null); }, () => undefined);
    return () => { active = false; };
  }, [pdf, rangeKey]);

  const askForHelp = async (question?: string) => {
    if (getTutorWaitMs() > 0) return;
    const handle = canvasHandle.current;
    sentRevision.current = handle?.getRevision() ?? null;
    const image = await handle?.captureImage() ?? '';
    // The reply shows beside the board.
    leaveFullScreen();
    setTutorOpen(true);
    await sendHelp(image, question);
  };

  // Ask… under Ask tutor: the question is typed or spoken in the tutor's chat box.
  const askOwn = () => {
    leaveFullScreen();
    setTutorOpen(true);
    focusTutorQuestion();
  };

  const followUpImage = useCallback(async (fresh = false): Promise<string> => {
    const handle = canvasHandle.current;
    if (!handle || (!fresh && handle.getRevision() === sentRevision.current)) return '';
    sentRevision.current = handle.getRevision();
    return handle.captureImage();
  }, []);

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 text-center p-6">
        <div className="space-y-3">
          <p className="text-gray-700">{loadError}</p>
          <Link href="/shelf" className="text-gray-900 underline">Back to the Shelf</Link>
        </div>
      </div>
    );
  }
  const trim = shelfDocument?.trimMargins !== false;
  // With trimming on, the page waits for the measurement so it doesn't change shape once shown.
  if (!shelfDocument || !pdf || (trim && printed === undefined)) return <div className="p-6 text-gray-500">Opening PDF…</div>;
  const crop = trim ? printed ?? null : null;

  const exercise = openExerciseForBook;
  // An open board always shows; with none open, the list can make way for the page.
  const pageOnly = listHidden && !exercise;
  const marksOnPage = shelfDocument.exercises.filter((item) => item.page === page);
  const name = pageName(labels, page);
  const pageText = name === String(page) ? `Page ${page} of ${pageCount}` : `p. ${name} (${page} of ${pageCount})`;
  const readingFullScreen = fullScreen && !exercise;
  // The bookmark the page is in: the last one starting at or before it.
  const hereIndex = contents.reduce((found, entry, index) => (entry.page <= page && (found < 0 || entry.page >= contents[found].page) ? index : found), -1);

  // The page and its controls: beside an open board, or beside the list of exercises.
  const smallButton = 'min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';
  const pageToolbar = (
    <>
      <button onClick={() => turn(-1)} disabled={page <= 1} aria-label="Previous page" className={smallButton}>‹ Prev</button>
      {goTo === null ? (
        <button onClick={() => { setGoTo(''); setGoToError(''); }} title="Go to a page" aria-label={`${pageText}. Go to a page`}
          className="min-h-11 px-2 text-sm text-gray-700 tabular-nums rounded-lg hover:bg-gray-100">{pageText}</button>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submitGoTo(); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { setGoTo(null); setGoToError(''); } }}
          className="flex items-center gap-1">
          <input autoFocus aria-label="Go to page" value={goTo} onChange={(event) => { setGoTo(event.target.value); setGoToError(''); }}
            placeholder={labels ? 'e.g. 47' : `1–${pageCount}`} inputMode={labels ? 'text' : 'numeric'}
            className="w-24 min-h-11 px-2 text-sm border border-gray-900 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
          <button type="submit" className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Go</button>
          <button type="button" onClick={() => { setGoTo(null); setGoToError(''); }} className={smallButton}>Cancel</button>
        </form>
      )}
      <button onClick={() => turn(1)} disabled={page >= pageCount} aria-label="Next page" className={smallButton}>Next ›</button>
      {goToError && <span role="alert" className="text-sm text-red-700">{goToError}</span>}
      <div className="flex-1" />
      <button onClick={() => void changeTrim(!trim)} aria-pressed={trim} title="Hide the pages' blank margins so the print is bigger"
        className={`min-h-11 px-3 text-sm rounded-lg border ${trim ? 'border-gray-900 bg-gray-100 text-gray-900' : 'border-gray-300 bg-white text-gray-700'} hover:bg-gray-50`}>Trim margins</button>
      {/* Reading full screen has its way out in the top bar; a board has its own Full screen. */}
      {!exercise && !fullScreen && <button onClick={toggleFullScreen} className={smallButton}>Full screen</button>}
      <button
        onClick={() => { setMarking((on) => !on); setPendingMark(null); }}
        aria-pressed={marking}
        className={`min-h-11 px-3 text-sm font-medium rounded-lg border border-gray-900 ${marking ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}
      >
        {marking ? 'Done marking' : 'Mark exercise'}
      </button>
    </>
  );
  const pageView = (
    <div ref={pageArea} className="p-3">
      {marking && <p className="mb-2 text-sm font-medium text-gray-900">{pendingMark ? 'Name it and save, or drag again to redraw the box.' : 'Drag a box around an exercise on the page.'}</p>}
      <PdfPage
        pdf={pdf} pageNumber={page} marks={marksOnPage} solvedIds={solvedIds} activeId={openId} marking={marking}
        pending={pendingMark}
        pendingForm={(
          <form onSubmit={(event) => { event.preventDefault(); void saveMark(); }}
            onKeyDown={(event) => { if (event.key === 'Escape') setPendingMark(null); }}
            className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-white border border-gray-900 shadow-md w-max max-w-[22rem]">
            <label className="text-sm text-gray-900" htmlFor="mark-label">Name</label>
            <input id="mark-label" value={markLabel} onChange={(event) => setMarkLabel(event.target.value)}
              className="w-36 min-h-11 px-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <button type="submit" className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Save and open</button>
            <button type="button" onClick={() => setPendingMark(null)} className="min-h-11 px-3 text-sm text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">Cancel</button>
          </form>
        )}
        onMark={(rect) => { if (!pendingMark) setMarkLabel(nextLabel(shelfDocument)); setPendingMark(rect); }}
        onOpenMark={(mark) => void openExercise(mark)}
        crop={crop}
        onTurn={turn}
        onTapMiddle={readingFullScreen ? () => { setBarsShown((shown) => !shown); setPanelOpen(false); } : undefined}
      />
    </div>
  );

  // The book's lists: its marked exercises, and its contents from the PDF's bookmarks.
  const listPanel = (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 border-b border-gray-200">
        <div role="tablist" aria-label="Lists" className="flex gap-1">
          {(['exercises', 'contents'] as const).map((tab) => (
            <button key={tab} role="tab" aria-selected={listTab === tab} onClick={() => setListTab(tab)}
              className={`min-h-11 px-3 text-sm ${listTab === tab ? 'font-semibold text-gray-900 shadow-[inset_0_-3px_0_#111827]' : 'text-gray-600 hover:text-gray-900'}`}>
              {tab === 'exercises' ? 'Exercises' : 'Contents'}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {!readingFullScreen && (
          <button onClick={() => changeListHidden(true)} title="Hide this list so the page gets the whole width"
            className="mb-2 min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Hide</button>
        )}
      </div>
      <div role="tabpanel" className="flex-1 overflow-y-auto p-4">
        {listTab === 'contents' ? (
          contents.length === 0 ? (
            <p className="text-sm text-gray-500">This PDF has no contents (bookmarks). Tap the page number to go to a page.</p>
          ) : (
            <ul className="grid">
              {contents.map((entry, index) => (
                <li key={`${index}-${entry.title}`}>
                  <button onClick={() => goToEntry(entry.page)} aria-current={index === hereIndex ? 'location' : undefined}
                    style={{ paddingLeft: `${0.75 + entry.depth * 1.25}rem` }}
                    className={`w-full min-h-11 flex items-baseline gap-3 pr-3 py-2 text-left text-sm border-l-[3px] hover:bg-gray-100 ${index === hereIndex ? 'border-gray-900 font-semibold text-gray-900' : `border-transparent ${entry.depth === 0 ? 'font-medium text-gray-900' : 'text-gray-700'}`}`}>
                    <span className="flex-1 min-w-0">{entry.title}</span>
                    <span className="text-xs text-gray-500 tabular-nums">{pageName(labels, entry.page)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : shelfDocument.exercises.length === 0 ? (
          <p className="text-sm text-gray-500">Tap <strong>Mark exercise</strong> and drag a box around a problem on the page. It opens here on its own board, and stays marked on the page.</p>
        ) : (
          <ul className="grid gap-2">
            {[...shelfDocument.exercises].sort((a, b) => a.page - b.page || a.rect.y - b.rect.y).map((item) => (
              <li key={item.id}>
                <button onClick={() => { setPanelOpen(false); void openExercise(item); }} disabled={isStreaming}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-gray-900 hover:bg-gray-50 disabled:opacity-50">
                  <span className="font-medium text-gray-900">{item.label}</span>
                  <span className="ml-2 text-xs text-gray-500">Page {pageName(labels, item.page)}</span>
                  {solvedIds.includes(item.id) && <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-semibold text-gray-900"><SolvedCheck size={14} />Solved</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {!fullScreen && <AppBar place="shelf" locked={isStreaming} beforeLeave={saveNow} />}
      <header className={`${fullScreen ? 'hidden' : 'flex'} flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Link href="/shelf" className="text-gray-900 underline">Shelf</Link>
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

      {exercise ? (
        <BoardFrame
          fullScreen={fullScreen}
          source={{ label: 'Page', wide: true, toolbar: pageToolbar, content: pageView }}
          title={(
            <>
              <h2 className="font-semibold text-gray-900 truncate">{exercise.label}</h2>
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-gray-600">
                <ProblemIcon />Problem · p. {exercise.page} ·{' '}
                <label className="text-indigo-700">
                  Tutor reads{' '}
                  <select
                    value={range?.from ?? 0}
                    onChange={(event) => void changeReadFrom(exercise.id, Number(event.target.value))}
                    title={range?.section ? `Section: ${range.section}` : undefined}
                    className="px-1 py-0.5 text-xs text-gray-700 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value={0}>no pages</option>
                    {Array.from({ length: Math.min(MAX_BOOK_PAGES, exercise.page) }, (_, index) => exercise.page - index).reverse().map((from) => (
                      <option key={from} value={from}>{from === exercise.page ? `p. ${from}` : `pp. ${from}–${exercise.page}`}</option>
                    ))}
                  </select>
                </label>
                {range && !bookHasText && <span className="font-medium text-gray-900"> · no text in this PDF to read</span>}
              </p>
            </>
          )}
          actions={(
            <>
              {problemImage && (
                <button onClick={() => void canvasHandle.current?.placeProblemImage(problemImage)}
                  title="Put the marked problem on the board to write on and around it"
                  className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Put on board</button>
              )}
              {!fullScreen && exercise.page !== page && (
                <button onClick={() => { setPage(exercise.page); setTutorOpen(false); }} className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Back to p. {exercise.page}</button>
              )}
              <button onClick={() => void closeExercise()} disabled={isStreaming} aria-label="Close board" className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50">Close</button>
              {!fullScreen && (
                <MoreMenu label={`More for ${exercise.label}`} disabled={isStreaming}
                  items={[{ label: 'Remove exercise', onSelect: () => void removeMark(exercise) }]} />
              )}
            </>
          )}
          canvas={<DrawingCanvas handleRef={canvasHandle} toolsHidden={toolsHidden} />}
          toolbar={(
            <BottomToolbar
              onAskForHelp={(question) => void askForHelp(question)}
              onAskOwn={askOwn}
              onClear={() => canvasHandle.current?.clear()}
              isStreaming={isStreaming}
              isSolved={isSolved}
              onToggleSolved={() => sessionDispatch({ type: 'TOGGLE_SOLVED' })}
              sessionType="problem"
              fullScreen={{ on: fullScreen, toggle: toggleFullScreen }}
              tools={{ hidden: toolsHidden, toggle: toggleTools }}
              tutor={{ open: tutorOpen, toggle: () => setTutorOpen((open) => !open) }}
              onSaveAs={(format) => void saveBoardAs(canvasHandle.current, format, `${exercise.label} - ${shelfDocument.title}`)}
            />
          )}
          tutor={{ open: tutorOpen, onClose: () => setTutorOpen(false), content: <ChatPanel getCanvasImage={followUpImage} getBookContext={getBookContext} /> }}
        />
      ) : readingFullScreen ? (
        // Reading full screen: the page, with its bars until a tap in the middle hides them.
        <div className="flex-1 min-h-0 flex flex-col bg-white">
          {barsShown && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-900 bg-white">
              <button onClick={toggleFullScreen} className={smallButton}>Exit full screen</button>
              <span className="min-w-0 flex-1 truncate font-semibold text-gray-900">{shelfDocument.title}</span>
              <button onClick={() => setPanelOpen((open) => !open)} aria-pressed={panelOpen} aria-label="Book: exercises and contents"
                className={`min-h-11 px-3 text-sm rounded-lg border border-gray-900 ${panelOpen ? 'bg-gray-900 text-white' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>Book</button>
            </div>
          )}
          <div className="flex-1 min-h-0 relative">
            <div className="absolute inset-0 overflow-y-auto">{pageView}</div>
            {barsShown && panelOpen && (
              <section aria-label="Book" className="absolute inset-y-0 left-0 z-20 w-[min(22rem,85%)] flex flex-col bg-white border-r border-gray-900 shadow-lg">
                {listPanel}
              </section>
            )}
          </div>
          {barsShown && <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-t border-gray-900 bg-white">{pageToolbar}</div>}
        </div>
      ) : (
        // No board open: the page, and the list beside it (which can make way).
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <section className={`flex ${pageOnly ? 'flex-1' : 'basis-[45%]'} lg:basis-auto lg:flex-1 min-w-0 min-h-0 flex-col border-b lg:border-b-0 border-gray-200`}>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-gray-200">
              {pageToolbar}
              {pageOnly && (
                <button onClick={() => changeListHidden(false)} title="Show the exercises and contents beside the page"
                  className={smallButton}>Exercises</button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">{pageView}</div>
          </section>
          <section className={`${pageOnly ? 'hidden' : 'flex'} flex-1 lg:flex-none lg:w-1/2 min-h-0 flex-col lg:border-l border-gray-200 bg-white`}>
            {listPanel}
          </section>
        </div>
      )}
    </div>
  );
}
