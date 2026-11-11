'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { useCanvasState } from '@/context/CanvasContext';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useBoardFullScreen } from '@/hooks/useBoardFullScreen';
import { useToolsHidden } from '@/hooks/useToolsHidden';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { loadRecoveredSession } from '@/lib/sessionRecovery';
import { listFolders, loadInk, loadProfile, loadShelfDocument, savePageInk, saveShelfDocument, shelfSessionId } from '@/lib/db';
import { folderHref, folderIndex, folderPath, folderTree, isWithin } from '@/lib/folders';
import { cropPage, cropParts, openPdf, trimmedArea } from '@/lib/pdf';
import { pageTextBoxes, sectionAt } from '@/lib/bookList';
import { exerciseNumberIn, printedLabel, sectionNumberAt } from '@/lib/exerciseLabel';
import { findPage, pageName } from '@/lib/reader';
import { MAX_BOARD_PICTURE, cropMark, ensureExerciseBoard, exerciseStatement, isNote, markBoardId, markExercise, marksOn, nextLabel, renameMark, setReadFrom, solvedExercises, unmarkExercise } from '@/lib/shelf';
import { boardMarkOf, pictureKey, sameBoard } from '@/lib/boardProblems';
import { paperFor } from '@/lib/paper';
import { MAX_BOOK_PAGES, loadContents, loadSectionStarts, readBookPages, readingRange, type ContentsEntry, type ReadingRange, type SectionStart } from '@/lib/bookContext';
import type { BoardMark, BookContext, ChatMessage, Folder, InkStroke, InkTool, MarkPart, PageRect, ShelfDocument, ShelfExercise, ShelfMarkKind } from '@/types';
import { askQuestion } from '@/lib/tutorAsk';
import DrawingCanvas, { type DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import BottomToolbar from '@/components/layout/BottomToolbar';
import AppBar from '@/components/layout/AppBar';
import ChatPanel from '@/components/chat/ChatPanel';
import MoreMenu from '@/components/common/MoreMenu';
import { ChevronIcon, CloseIcon, EraserIcon, FullScreenIcon, HighlightIcon, KindIcon, ListIcon, MarkIcon, PenIcon, SelectBoxIcon, SolvedCheck, UndoIcon } from '@/components/common/Icons';
import BoardFrame from '@/components/layout/BoardFrame';
import { saveBoardAs } from '@/lib/exportBoard';
import { addPictureFromFile, pasteCopiedPicture } from '@/lib/boardPicture';
import { copyPicture } from '@/lib/copiedPicture';
import PdfPage from './PdfPage';
import BookList from './BookList';
import BookSearch from './BookSearch';
import PageAsk from './PageAsk';
import { useBookSearch } from '@/hooks/useBookSearch';
import { useFavorite, useMarkFavorites } from '@/hooks/useFavorite';
import { markAbout, useMarkConversation } from '@/hooks/useMarkConversation';
import { useQuietCheck } from '@/hooks/useQuietCheck';
import { BOARD_CHECK } from '@/lib/quietCheck';
import FavoriteButton from '@/components/layout/FavoriteButton';

// Whether the list beside the page is hidden, so the page gets the width.
const LIST_HIDDEN_KEY = 'math-tutor:shelfListHidden';
// The page's tool rail, folded away to give the page its width (Text menu → Hide tool rail).
const RAIL_HIDDEN_KEY = 'math-tutor:pageRailHidden';

// Which list is beside the page: what the student made in the book, the PDF's contents, or a search.
type ListTab = 'list' | 'contents' | 'search';
const LIST_TABS: { tab: ListTab; label: string }[] = [{ tab: 'list', label: 'Your list' }, { tab: 'contents', label: 'Contents' }, { tab: 'search', label: 'Search' }];
// What a box being marked will be.
const MARK_KINDS: { kind: ShelfMarkKind; label: string }[] = [{ kind: 'exercise', label: 'Exercise' }, { kind: 'note', label: 'Note' }];

// The page toolbar's ink tools, as labelled there.
const INK_TOOLS = [
  { tool: 'pen', label: 'Pen', icon: PenIcon },
  { tool: 'highlighter', label: 'Highlight', icon: HighlightIcon },
  { tool: 'eraser', label: 'Eraser', icon: EraserIcon },
] as const;
// A page with no ink: one array, so the page isn't redrawn on every render.
const NO_INK: InkStroke[] = [];
const NO_LIT: PageRect[] = [];
// Undo steps kept for each page while the PDF is open.
const MAX_UNDO = 50;

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

/** A Shelf PDF, page by page, with marked exercises and note pages; each opens on its own board beside the page. */
export default function ShelfReader() {
  const [shelfDocument, setShelfDocument] = useState<ShelfDocument | null>(null);
  const documentRef = useRef<ShelfDocument | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [marking, setMarking] = useState(false);
  // Asking about a box on the page (Select's Explain): the conversation.
  const [pageAsk, setPageAsk] = useState<{ page: number; rect: PageRect; question: string; key: number } | null>(null);
  const [pendingMark, setPendingMark] = useState<PageRect | null>(null);
  // Select: a box on the page to explain (no board open) or copy to paste on a board: the tool, the box drawn, and how the copy went.
  const [copyBox, setCopyBox] = useState(false);
  const [copyDraft, setCopyDraft] = useState<{ page: number; rect: PageRect } | null>(null);
  const [copyState, setCopyState] = useState<'ready' | 'copying' | 'copied' | 'failed'>('ready');
  const [markLabel, setMarkLabel] = useState('');
  // The book's own number for the box being marked ("4.2 #55"), read from the page's text; null when none was found.
  const [printedName, setPrintedName] = useState<string | null>(null);
  const printedRef = useRef<string | null>(null);
  // An exercise that goes on over the page: the boxes already drawn, before the one pending.
  const [markParts, setMarkParts] = useState<MarkPart[]>([]);
  // Renaming the open exercise on its board: the name being typed (null when not renaming).
  const [renaming, setRenaming] = useState<string | null>(null);
  const [markKind, setMarkKind] = useState<ShelfMarkKind>('exercise');
  // An exercise marked while a problem board is open goes on that board, not one of its own.
  const [markOnBoard, setMarkOnBoard] = useState(false);
  // The library's folders: where the book is (the breadcrumb) and where a new mark's board is filed.
  const [folders, setFolders] = useState<Folder[]>([]);
  const [markFolder, setMarkFolder] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [solvedIds, setSolvedIds] = useState<string[]>([]);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [sectionStarts, setSectionStarts] = useState<SectionStart[]>([]);
  const [bookHasText, setBookHasText] = useState(true);
  const { fullScreen, toggle: toggleFullScreen } = useBoardFullScreen();
  const { toolsHidden, toggleTools } = useToolsHidden();
  const [listHidden, setListHidden] = useState(false);
  const [railHidden, setRailHidden] = useState(false);
  const [listTab, setListTab] = useState<ListTab>('list');
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
  // Ink on the pages, by page number; the tool writing (null: reading); earlier ink for Undo.
  const [ink, setInk] = useState<Record<number, InkStroke[]>>({});
  const [inkTool, setInkTool] = useState<InkTool | null>(null);
  // On a narrow screen the open board can swap out for the page, which then has the BOOX pen.
  const [pageSwapped, setPageSwapped] = useState(false);
  const [inkUndo, setInkUndo] = useState<Record<number, InkStroke[][]>>({});
  const inkWrites = useRef<Promise<unknown>>(Promise.resolve());
  const switching = useRef(false);
  const book = useRef<{ pdf: PDFDocumentProxy; document: ShelfDocument; range: ReadingRange } | null>(null);

  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  const { isStreaming, isSolved, currentSessionId, problemImage, problemStatement, paper: chosenPaper, problems, currentProblem, conversationKey } = useSessionState();
  const quietCheck = useQuietCheck(canvasHandle);
  const sessionDispatch = useSessionDispatch();
  // An exercise opened on an empty board is put on it, once it has loaded (so the tutor also reads
  // anything written on the figure). A board with work keeps it as it is.
  const [placeOn, setPlaceOn] = useState<{ board: string; key: string | true } | null>(null);
  // Counts openings, so opening an exercise (even the open one, from its mark) shows its board.
  const [openings, setOpenings] = useState(0);
  const { pendingLoad, hasContent } = useCanvasState();
  useEffect(() => {
    if (!placeOn || placeOn.board !== currentSessionId || pendingLoad) return;
    setPlaceOn(null);
    if (!hasContent && problemImage) void canvasHandle.current?.placeProblemImage(problemImage, placeOn.key);
  }, [placeOn, currentSessionId, pendingLoad, hasContent, problemImage]);
  // Home opens a problem marked on a note page with &mark=<id>: once its board has loaded, show it.
  const markToShow = useRef<string | null>(null);
  useEffect(() => { markToShow.current = new URLSearchParams(window.location.search).get('mark'); }, []);
  useEffect(() => {
    if (pendingLoad || !markToShow.current || !currentSessionId || !canvasHandle.current) return;
    if (canvasHandle.current.showMark(markToShow.current)) markToShow.current = null;
  }, [pendingLoad, currentSessionId]);
  // The pages before the open exercise, read when a question is sent (each page's text is kept).
  // A note page sends none: the tutor explains directly there, and book pages would make it hold back.
  const getBookContext = useCallback(async (): Promise<BookContext | null> => {
    const current = book.current;
    return current ? readBookPages(current.pdf, current.document, current.range) : null;
  }, []);
  const { sendHelp } = useTutorChat(getBookContext);
  const markConversation = useMarkConversation(canvasHandle, conversationKey);
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
      const onOpenBoard = id === currentSessionId;
      const listed = onOpenBoard ? problems : (await loadRecoveredSession(id).catch(() => undefined))?.problems;
      if (!onOpenBoard && !await openSession(id)) throw new Error('Not opened');
      // An added exercise the board never saved (its save failed after the mark was kept) joins it again.
      let image = listed?.find((problem) => problem.id === exercise.id)?.problemImage ?? null;
      if (exercise.boardOf && !listed?.some((problem) => problem.id === exercise.id)) {
        image = await cropMark(source.pdf, exercise);
        const own = source.document.exercises.find((item) => item.id === exercise.boardOf);
        sessionDispatch({
          type: 'ADD_PROBLEM', first: { id: exercise.boardOf, label: own?.label ?? 'Exercise' },
          problem: { id: exercise.id, label: exercise.label, problemStatement: exerciseStatement(source.document, exercise), problemImage: image, isSolved: false },
        });
      } else sessionDispatch({ type: 'SELECT_PROBLEM', id: exercise.id });
      // Another exercise on the open board: go to its picture there (put on the board if it isn't).
      if (onOpenBoard) { if (image) void canvasHandle.current?.placeProblemImage(image, pictureKey(exercise)); }
      else setPlaceOn({ board: id, key: pictureKey(exercise) });
      setOpenings((count) => count + 1);
      setOpenId(exercise.id);
      setPage(exercise.page);
      setPageAsk(null);
      // Moving between a board's exercises keeps the tutor and Mark as they were.
      if (!onOpenBoard) { setMarking(false); setTutorOpen(false); }
      writeUrl(source.document.id, exercise.id);
    } catch {
      setError(`That ${isNote(exercise) ? 'note page' : 'exercise'} could not be opened. Try again.`);
    } finally { switching.current = false; }
  }, [pdf, isStreaming, openSession, currentSessionId, problems, sessionDispatch]);

  // Load the PDF named in the URL, and the exercise if one is named.
  useEffect(() => {
    let active = true;
    let opened: PDFDocumentProxy | null = null;
    async function load() {
      const { documentId, exerciseId } = readUrl();
      const stored = documentId ? await loadShelfDocument(documentId) : undefined;
      if (!stored) { if (active) setLoadError('This PDF isn’t in your library.'); return; }
      opened = await openPdf(stored.file);
      // Left before it finished opening: the cleanup has already run, so free it here.
      if (!active) { void opened.loadingTask.destroy(); return; }
      const pages = await loadInk(stored.id);
      if (!active) { void opened.loadingTask.destroy(); return; }
      setInk(Object.fromEntries(pages.map((entry) => [entry.page, entry.strokes])));
      setFolders(await listFolders().catch(() => []));
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
    try { setRailHidden(localStorage.getItem(RAIL_HIDDEN_KEY) === '1'); } catch { /* stays shown */ }
  }, []);
  const changeRailHidden = (next: boolean) => {
    setRailHidden(next);
    try { localStorage.setItem(RAIL_HIDDEN_KEY, next ? '1' : '0'); } catch { /* only for this visit */ }
  };
  const changeListHidden = (next: boolean) => {
    setListHidden(next);
    try { localStorage.setItem(LIST_HIDDEN_KEY, next ? '1' : '0'); } catch { /* only for this visit */ }
  };

  // Remember the page for next time.
  useEffect(() => {
    const current = documentRef.current;
    if (!current) return;
    // Where that is, for the Shelf card: the printed page number and the last bookmark at or before it.
    // Written again when they change on the same page too (a book opened on its first page, or labels
    // and bookmarks that load after the page).
    const lastPageLabel = pageName(labels, page);
    const section = contents.reduce<ContentsEntry | undefined>((found, entry) => (entry.page <= page && (!found || entry.page >= found.page) ? entry : found), undefined);
    if (current.lastPage === page && current.lastPageLabel === lastPageLabel && current.lastSection === section?.title) return;
    const timer = setTimeout(() => {
      void writeDocument(async (latest) => {
        const next = { ...latest, lastPage: page, lastPageLabel, lastSection: section?.title, updatedAt: Date.now() };
        await saveShelfDocument(next);
        documentRef.current = next;
      }).catch(() => { /* Only the reading position is lost. */ });
    }, PAGE_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [page, labels, contents, writeDocument]);

  // Keep the marks' ✓ in step with the open board's Mark Solved.
  useEffect(() => {
    const open = shelfDocument?.exercises.find((item) => item.id === openId);
    if (!openId || !shelfDocument || !open || currentSessionId !== markBoardId(shelfDocument, open)) return;
    setSolvedIds((current) => {
      const has = current.includes(openId);
      if (isSolved === has) return current;
      return isSolved ? [...current, openId] : current.filter((id) => id !== openId);
    });
  }, [isSolved, openId, shelfDocument, currentSessionId]);

  useEffect(() => { if (!marking) setMarkParts([]); }, [marking]);
  // A rename under way belongs to the exercise it started on.
  useEffect(() => { setRenaming(null); }, [openId]);

  // A new page starts at its top, and a box drawn but not saved stays with the page it was drawn on.
  useEffect(() => {
    pageArea.current?.closest('.overflow-y-auto')?.scrollTo?.(0, 0);
    setPendingMark(null);
  }, [page]);

  const pageCount = pdf?.numPages ?? 1;
  const search = useBookSearch(pdf);
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

  // The default name for a mark of `kind`: the book's own number for an exercise when the page's text gives one.
  const defaultLabel = (kind: ShelfMarkKind) => (kind === 'exercise' && printedName) || (shelfDocument ? nextLabel(shelfDocument, kind) : '');

  // Reads the exercise's number from the text at the top of the box ("55." in section 4.2 makes "4.2 #55")
  // and names the mark with it, unless the student has typed a name of their own.
  const nameFromPage = async (markPage: number, rect: PageRect) => {
    if (!pdf || !shelfDocument) return;
    const { boxes } = await pageTextBoxes(pdf, markPage);
    const number = exerciseNumberIn(boxes, rect);
    const section = sectionAt(contents, markPage, pdf.numPages);
    const found = number ? printedLabel(number, section.index === undefined ? null : sectionNumberAt(contents, section.index)) : null;
    const before = printedRef.current;
    printedRef.current = found;
    setPrintedName(found);
    setMarkLabel((label) => {
      const untouched = label === (before ?? '') || label === nextLabel(shelfDocument, 'exercise');
      return untouched && markKind === 'exercise' ? found ?? nextLabel(shelfDocument, 'exercise') : label;
    });
  };

  // Goes on over the page: keep this box and draw the rest of the exercise on the next page.
  const continueMark = () => {
    if (!pendingMark || page >= pageCount) return;
    setMarkParts((parts) => [...parts, { page, rect: pendingMark }]);
    setPendingMark(null);
    setPage(page + 1);
  };

  // Renames the open exercise from its board: the mark, Your list, and the board's problem text.
  const saveRename = async () => {
    const exercise = openExerciseForBook;
    const name = renaming?.trim();
    setRenaming(null);
    if (!exercise || !name || name === exercise.label) return;
    try {
      const next = await writeDocument(async (current) => {
        const renamed = await renameMark(current, exercise.id, name);
        updateDocument(renamed);
        return renamed;
      });
      const mark = next.exercises.find((item) => item.id === exercise.id);
      if (mark) sessionDispatch({ type: 'RENAME_PROBLEM', id: mark.id, label: mark.label, problemStatement: exerciseStatement(next, mark) });
    } catch {
      setError('The new name could not be saved. Try again.');
    }
  };

  const saveMark = async () => {
    if (!pdf || !pendingMark) return;
    // The first box is the mark's own; boxes drawn after Goes on over the page are the rest of it.
    const [first, ...more] = [...markParts, { page, rect: pendingMark }];
    const { page: markPage, rect } = first;
    setPendingMark(null);
    setMarkParts([]);
    const board = openExerciseForBook;
    if (board && addsToBoard) { await addToBoard(board, markPage, rect, more); return; }
    try {
      const { document: next, exercise } = await writeDocument(async (current) => {
        const marked = await markExercise(pdf, current, markPage, rect, markLabel, markKind, [], markFolder || undefined, undefined, more);
        updateDocument(marked.document);
        return marked;
      });
      await openExercise(exercise, { pdf, document: next });
    } catch {
      setError(`The ${markKind === 'note' ? 'note page' : 'exercise'} could not be saved. Try again.`);
    }
  };

  // Marks an exercise on the open board: it joins the board's problems and is worked on next, its picture
  // below the work; Mark stays on for the next one.
  const addToBoard = async (board: ShelfExercise, markPage: number, rect: PageRect, more: MarkPart[] = []) => {
    if (!pdf) return;
    try {
      const image = await cropParts(pdf, [{ page: markPage, rect }, ...more]);
      const { document: next, exercise: added } = await writeDocument(async (current) => {
        const marked = await markExercise(pdf, current, markPage, rect, markLabel, 'exercise', [], undefined, boardMarkOf(board), more);
        updateDocument(marked.document);
        return marked;
      });
      sessionDispatch({
        type: 'ADD_PROBLEM', first: { id: board.id, label: board.label },
        problem: { id: added.id, label: added.label, problemStatement: exerciseStatement(next, added), problemImage: image, isSolved: false },
      });
      setOpenId(added.id);
      writeUrl(next.id, added.id);
      void canvasHandle.current?.placeProblemImage(image, pictureKey(added));
    } catch {
      setError('The exercise could not be added to the board. Try again.');
    }
  };

  const removeMark = async (exercise: ShelfExercise) => {
    const current = documentRef.current;
    if (!current || isStreaming) return;
    const open = current.exercises.find((item) => item.id === openId);
    const onOpenBoard = open && sameBoard(open, exercise);
    if (onOpenBoard && current.exercises.some((item) => item.id !== exercise.id && sameBoard(item, exercise))) {
      // The board stays with its other exercises and drops this one from its list (its work stays). A save
      // under way lands first, so it can't bring the entry back once the stored board drops it too.
      await saveNow();
      sessionDispatch({ type: 'REMOVE_PROBLEM', id: exercise.id });
      const next = (problems ?? []).find((problem) => problem.id !== exercise.id);
      if (exercise.id === openId && next) { setOpenId(next.id); writeUrl(current.id, next.id); }
    } else if (onOpenBoard) {
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
    } catch { setError(`The ${isNote(exercise) ? 'note page' : 'exercise'} could not be removed. Try again.`); }
  };

  // A page's ink changed: show it now, and save it (one page's writes at a time, in order).
  const changeInk = (inkPage: number, strokes: InkStroke[], undoable = true) => {
    const documentId = documentRef.current?.id;
    if (!documentId) return;
    if (undoable) setInkUndo((current) => ({ ...current, [inkPage]: [...(current[inkPage] ?? []), ink[inkPage] ?? []].slice(-MAX_UNDO) }));
    setInk((current) => ({ ...current, [inkPage]: strokes }));
    const write = () => savePageInk(documentId, inkPage, strokes);
    inkWrites.current = inkWrites.current.then(write, write).catch(() => setError('Your ink could not be saved. Try again.'));
  };

  const undoInk = () => {
    const steps = inkUndo[page];
    if (!steps?.length) return;
    setInkUndo((current) => ({ ...current, [page]: steps.slice(0, -1) }));
    changeInk(page, steps[steps.length - 1], false);
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
  // Mark → This board: an exercise marked beside an open problem board can go on it.
  const canAddToBoard = Boolean(openExerciseForBook && !isNote(openExerciseForBook));
  const addsToBoard = canAddToBoard && markOnBoard && markKind === 'exercise';
  const range = shelfDocument && openExerciseForBook && !isNote(openExerciseForBook) ? readingRange(shelfDocument, openExerciseForBook, sectionStarts) : null;
  book.current = pdf && shelfDocument && range ? { pdf, document: shelfDocument, range } : null;

  // The open board's star, and which of the book's boards are starred (by the mark each is named for; for Your list).
  // A board of several is starred as a whole, under its exercises' names.
  const favoriteSubject = shelfDocument && openExerciseForBook
    ? { title: `${problems && problems.length > 1 ? problems.map((problem) => problem.label).join(', ') : openExerciseForBook.label} · ${shelfDocument.title}, p. ${pageName(labels, openExerciseForBook.page)}`, problem: '' }
    : { title: '', problem: '' };
  const favorite = useFavorite(shelfDocument && openExerciseForBook ? markBoardId(shelfDocument, openExerciseForBook) : null, favoriteSubject);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const bookId = shelfDocument?.id;
  useEffect(() => {
    if (!bookId) return;
    let active = true;
    const prefix = shelfSessionId(bookId, '');
    loadProfile().then((profile) => {
      if (active) setFavoriteIds((profile?.favorites ?? []).filter((item) => item.id.startsWith(prefix)).map((item) => item.id.slice(prefix.length)));
    }, () => undefined);
    return () => { active = false; };
  }, [bookId, favorite.favorite]);

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
    // The reply shows beside the board.
    setTutorOpen(true);
    setError('');
    markConversation.end();
    try {
      if (!canvasHandle.current) throw new Error('The board is still loading. Please try again.');
      await sendHelp(await canvasHandle.current.captureForTutor(), question);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The board image could not be captured. Please try again.');
    }
  };

  // Hint or Check on a problem marked on a note page: its work alone, asked as a problem.
  const askAboutMark = async (question: string, mark: BoardMark, items: string[]) => {
    if (getTutorWaitMs() > 0) return;
    setTutorOpen(true);
    setError('');
    try {
      if (!canvasHandle.current) throw new Error('The board is still loading. Please try again.');
      // Follow-ups stay on this problem until something else is asked.
      markConversation.start(mark);
      await sendHelp(await canvasHandle.current.captureForTutor(items), question, markAbout(mark));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The board image could not be captured. Please try again.');
    }
  };
  const noteBoard = shelfDocument && openExerciseForBook && isNote(openExerciseForBook) ? markBoardId(shelfDocument, openExerciseForBook) : null;
  const markFavorites = useMarkFavorites(noteBoard, openExerciseForBook ? `${openExerciseForBook.label}, ${shelfDocument?.title ?? ''}` : '');

  const getBoardImages = markConversation.followUpImages;

  if (loadError) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 text-center p-6">
        <div className="space-y-3">
          <p className="text-gray-700">{loadError}</p>
          <Link href="/" className="text-gray-900 underline">Back to Home</Link>
        </div>
      </div>
    );
  }
  const trim = shelfDocument?.trimMargins !== false;
  // With trimming on, the page waits for the measurement so it doesn't change shape once shown.
  if (!shelfDocument || !pdf || (trim && printed === undefined)) return <div className="p-6 text-gray-500">Opening PDF…</div>;
  const crop = trim ? printed ?? null : null;

  // Where the book is, and the folders a mark's board can be filed in: the book's and those inside it.
  const library = folderIndex(folders);
  const bookFolder = shelfDocument.folderId && library.folders.has(shelfDocument.folderId) ? shelfDocument.folderId : null;
  const markFolders = bookFolder ? folderTree(library).filter(({ folder }) => isWithin(library, folder.id, bookFolder)) : [];
  const startingFolder = () => {
    const last = shelfDocument.markFolderId;
    return bookFolder && last && library.folders.has(last) && isWithin(library, last, bookFolder) ? last : bookFolder ?? '';
  };

  const exercise = openExerciseForBook;
  const paper = paperFor(chosenPaper, exercise && isNote(exercise) ? 'note' : 'problem');
  // An open board always shows; with none open, the list can make way for the page.
  const pageOnly = listHidden && !exercise;
  const marksOnPage = marksOn(shelfDocument, page);
  // The search's matches on this page are lit until it is cleared.
  const litOnPage = search.results.find((result) => result.page === page)?.matches.flatMap((match) => match.rects) ?? NO_LIT;
  const name = pageName(labels, page);
  const pageText = name === String(page) ? `Page ${page} of ${pageCount}` : `p. ${name} (${page} of ${pageCount})`;
  const readingFullScreen = fullScreen && !exercise;
  // The bookmark the page is in: the last one starting at or before it.
  const hereIndex = contents.reduce((found, entry, index) => (entry.page <= page && (found < 0 || entry.page >= contents[found].page) ? index : found), -1);

  // The page and its controls: beside an open board, or beside the list of exercises.
  const smallButton = 'min-h-11 px-3 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';
  const stopCopyBox = () => { setCopyBox(false); setCopyDraft(null); setCopyState('ready'); };
  // Copy: the box's part of the page, kept for Paste on any board (and on the system clipboard where allowed).
  const copyBoxed = async () => {
    if (!copyDraft) return;
    setCopyState('copying');
    try {
      const png = await cropPage(pdf, copyDraft.page, copyDraft.rect, MAX_BOARD_PICTURE);
      await copyPicture({ png, from: `${shelfDocument.title}, p. ${pageName(labels, copyDraft.page)}`, copiedAt: Date.now() });
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  // Explain: the tutor on the box, as a conversation in the list's place (follow-ups go in its chat box).
  const explainBoxed = () => {
    if (!copyDraft) return;
    setPageAsk({ page: copyDraft.page, rect: copyDraft.rect, question: askQuestion('explain', 'note'), key: Date.now() });
    stopCopyBox();
    setPanelOpen(false);
  };
  const canPasteHere = Boolean(exercise);
  const copyForm = (
    <div onKeyDown={(event) => { if (event.key === 'Escape') setCopyDraft(null); }}
      className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-white border border-gray-900 shadow-md w-max max-w-[22rem]">
      {copyState === 'copied' ? (
        <>
          <p role="status" className="w-full text-sm text-gray-900">Copied. {canPasteHere ? 'Paste it on this board, or on any board with Paste in its tool rail.' : 'Paste it on any board with Paste in its tool rail.'}</p>
          {canPasteHere && (
            <button type="button" onClick={() => { void pasteCopiedPicture(canvasHandle.current); stopCopyBox(); setOpenings((count) => count + 1); }}
              className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Paste on this board</button>
          )}
          <button type="button" onClick={stopCopyBox} className="min-h-11 px-3 text-sm text-gray-900 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">Done</button>
        </>
      ) : (
        <>
          {copyState === 'failed' && <p role="alert" className="w-full text-sm text-red-700">It could not be copied. Try again.</p>}
          {!exercise && (
            <button type="button" autoFocus onClick={explainBoxed} disabled={copyState === 'copying'} title="Ask the tutor to explain the box"
              className="min-h-11 px-3 text-sm font-medium text-indigo-700 border border-indigo-700 bg-white rounded-lg hover:bg-indigo-50 disabled:opacity-60">Explain</button>
          )}
          <button type="button" autoFocus={Boolean(exercise)} onClick={() => void copyBoxed()} disabled={copyState === 'copying'}
            className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-60">{copyState === 'copying' ? 'Copying…' : 'Copy'}</button>
          <button type="button" onClick={() => setCopyDraft(null)} className="min-h-11 px-3 text-sm text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">Cancel</button>
        </>
      )}
    </div>
  );
  // Keeps the conversation about a box as a note page on it, and opens its board.
  const saveAskAsNote = async (chat: ChatMessage[]) => {
    if (!pageAsk) return;
    const { page: askPage, rect } = pageAsk;
    try {
      const { document: next, exercise: note } = await writeDocument(async (current) => {
        const marked = await markExercise(pdf, current, askPage, rect, nextLabel(current, 'note'), 'note', chat.filter((message) => message.content.trim()));
        updateDocument(marked.document);
        return marked;
      });
      setPageAsk(null);
      await openExercise(note, { pdf, document: next });
    } catch {
      setError('The note page could not be saved. Try again.');
    }
  };
  const askPanel = pageAsk && (
    <PageAsk key={pageAsk.key} pdf={pdf} page={pageAsk.page} rect={pageAsk.rect} question={pageAsk.question}
      where={`${shelfDocument.title}, p. ${pageName(labels, pageAsk.page)}`}
      onClose={() => setPageAsk(null)} onSave={saveAskAsNote} />
  );

  // The page's controls: a rail down its left, like an ink board's, away from a writing hand
  // resting at the bottom right (Scott, Go 10.3, 2026-11-07). The tutor's Ask sits at its top.
  const railTool = (on: boolean) => `flex shrink-0 items-center justify-center min-h-11 w-11 rounded-lg border ${on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'} disabled:opacity-40`;
  const pageToolbar = railHidden ? (
    // Folded away: a tab at the page's left edge brings the rail back.
    <button onClick={() => changeRailHidden(false)} data-pen-control aria-label="Show tool rail" title="Show tool rail"
      className="absolute left-0 top-1/3 z-10 flex items-center justify-center w-8 min-h-11 text-gray-700 bg-white border border-l-0 border-gray-400 rounded-r-lg shadow-sm">
      <span aria-hidden="true">»</span>
    </button>
  ) : (
    <div role="group" aria-label="Text controls" className="flex flex-col items-center gap-1 w-12 shrink-0 py-1.5 overflow-y-auto overscroll-contain border-r border-gray-200 bg-white">
      {/* The page swapped in for a board (narrow or full screen): back to it, mirroring the board rail's "p. 47". */}
      {exercise && pageSwapped && (
        <button onClick={() => setOpenings((count) => count + 1)} aria-label="Back to board" title="Back to board"
          className="flex shrink-0 items-center justify-center min-h-11 w-11 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Board</button>
      )}
      <button
        onClick={() => { setMarking((on) => !on); setPendingMark(null); setInkTool(null); stopCopyBox(); }}
        aria-pressed={marking} aria-label={marking ? 'Done marking' : 'Mark'}
        title={marking ? 'Done marking' : 'Mark: box an exercise to work it, or a passage to take notes on'}
        className={railTool(marking)}
      ><MarkIcon /></button>
      <div role="group" aria-label="Write on the page" className="flex flex-col items-center gap-1">
        {INK_TOOLS.map(({ tool, label, icon: ToolIcon }) => (
          <button key={tool} aria-pressed={inkTool === tool} aria-label={label} title={label}
            onClick={() => { setInkTool((current) => (current === tool ? null : tool)); setMarking(false); setPendingMark(null); stopCopyBox(); }}
            className={railTool(inkTool === tool)}><ToolIcon /></button>
        ))}
        <button aria-pressed={copyBox} aria-label="Select" title={exercise ? 'Select part of the page to copy onto a board' : 'Select part of the page to explain or copy onto a board'}
          onClick={() => { if (copyBox) stopCopyBox(); else { setCopyBox(true); setInkTool(null); setMarking(false); setPendingMark(null); } }}
          className={railTool(copyBox)}><SelectBoxIcon /></button>
        {inkTool && <button onClick={undoInk} disabled={!inkUndo[page]?.length} aria-label="Undo" title="Undo" className={railTool(false)}><UndoIcon /></button>}
      </div>
      <div aria-hidden="true" className="w-8 my-1 border-t border-gray-200" />
      <div role="group" aria-label="Page navigation" className="flex flex-col items-center gap-1">
        <button onClick={() => turn(-1)} disabled={page <= 1} aria-label="Previous page" title="Previous page" className={railTool(false)}><ChevronIcon direction="left" /></button>
        <button onClick={() => { setGoTo((current) => (current === null ? '' : null)); setGoToError(''); }} aria-pressed={goTo !== null}
          title={`${pageText}. Go to a page`} aria-label={`${pageText}. Go to a page`}
          className="flex flex-col items-center justify-center min-h-11 w-11 text-xs leading-tight text-gray-800 tabular-nums rounded-lg hover:bg-gray-100">
          {labels && <span className="text-[0.65rem] text-gray-500">p.</span>}
          <span className="max-w-11 truncate font-medium">{name}</span>
          {!labels && <span className="text-[0.65rem] text-gray-500">/{pageCount}</span>}
        </button>
        <button onClick={() => turn(1)} disabled={page >= pageCount} aria-label="Next page" title="Next page" className={railTool(false)}><ChevronIcon direction="right" /></button>
      </div>
      <div aria-hidden="true" className="w-8 my-1 border-t border-gray-200" />
      {/* A board has its own Full screen. Reading full screen keeps its way out and the lists here. */}
      {!exercise && <button onClick={toggleFullScreen} aria-label={fullScreen ? 'Exit full screen' : 'Full screen'} title={fullScreen ? 'Exit full screen' : 'Full screen'} aria-pressed={fullScreen} className={railTool(false)}><FullScreenIcon /></button>}
      {readingFullScreen && (
        <button onClick={() => setPanelOpen((open) => !open)} aria-pressed={panelOpen} aria-label="Lists: your list, contents and search" title="Lists: your list, contents and search"
          className={railTool(panelOpen)}><ListIcon /></button>
      )}
      {pageOnly && !fullScreen && (
        <button onClick={() => changeListHidden(false)} aria-label="Your list" title="Your list: contents and search" className={railTool(false)}><ListIcon /></button>
      )}
      <MoreMenu label="Text menu" title="Text menu" button={<span aria-hidden="true">⋯</span>} buttonClassName={railTool(false)} side
        items={[
          { label: 'Trim margins', role: 'menuitemcheckbox', checked: trim, onSelect: () => void changeTrim(!trim) },
          { label: 'Hide tool rail', onSelect: () => changeRailHidden(true) },
        ]} />
    </div>
  );
  // Go to a page: a form at the top of the page, opened from the page number in the rail.
  const goToForm = goTo !== null && (
    <form onSubmit={(event) => { event.preventDefault(); submitGoTo(); }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setGoTo(null); setGoToError(''); } }}
      className="mb-2 flex flex-wrap items-center gap-1">
      <input autoFocus aria-label="Go to page" value={goTo} onChange={(event) => { setGoTo(event.target.value); setGoToError(''); }}
        placeholder={labels ? 'e.g. 47' : `1–${pageCount}`} inputMode={labels ? 'text' : 'numeric'}
        className="w-24 min-h-11 px-2 text-sm border border-gray-900 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
      <button type="submit" className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Go</button>
      <button type="button" onClick={() => { setGoTo(null); setGoToError(''); }} className={smallButton}>Cancel</button>
      {goToError && <span role="alert" className="text-sm text-red-700">{goToError}</span>}
    </form>
  );
  const pageView = (
    <div ref={pageArea} className="p-3">
      {goToForm}
      {copyBox && <p className="mb-2 text-sm font-medium text-gray-900">{copyDraft?.page === page ? (exercise ? 'Copy it, or drag again to redraw the box.' : 'Explain or copy it, or drag again to redraw the box.') : (exercise ? 'Drag a box around what you want on a board.' : 'Drag a box around what you want explained or on a board.')}</p>}
      {marking && <p className="mb-2 text-sm font-medium text-gray-900">{markParts.length && !pendingMark ? `Drag a box around the rest of ${markLabel || 'the exercise'} on this page.` : pendingMark ? 'Choose Exercise or Note, name it and save, or drag again to redraw the box.' : canAddToBoard && markOnBoard ? 'Drag a box around the next exercise to add it to this board.' : 'Drag a box around an exercise, or around a passage to take notes on.'}</p>}
      <PdfPage
        pdf={pdf} pageNumber={page} marks={marksOnPage} solvedIds={solvedIds} activeId={openId} marking={marking || copyBox}
        pending={copyBox ? (copyDraft?.page === page ? copyDraft.rect : null) : marking ? pendingMark : pageAsk && pageAsk.page === page ? pageAsk.rect : null}
        pendingForm={copyBox ? copyForm : marking && (
          <form onSubmit={(event) => { event.preventDefault(); void saveMark(); }}
            onKeyDown={(event) => { if (event.key === 'Escape') { setPendingMark(null); setMarkParts([]); } }}
            className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-white border border-gray-900 shadow-md w-max max-w-[22rem]">
            <div role="radiogroup" aria-label="Mark as" className="flex w-full gap-1">
              {MARK_KINDS.map(({ kind, label }) => (
                <button key={kind} type="button" role="radio" aria-checked={markKind === kind}
                  onClick={() => {
                    // A name still the default follows the kind ("Exercise 3" becomes "Note 1").
                    if (markLabel === defaultLabel(markKind)) setMarkLabel(defaultLabel(kind));
                    setMarkKind(kind);
                  }}
                  className={`flex-1 min-h-11 px-3 text-sm rounded-lg border border-gray-900 ${markKind === kind ? 'bg-gray-900 text-white font-medium' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{label}</button>
              ))}
            </div>
            {canAddToBoard && markKind === 'exercise' && (
              <div role="radiogroup" aria-label="Work it on" className="flex w-full gap-1">
                {[{ on: true, label: 'This board' }, { on: false, label: 'Own board' }].map(({ on, label }) => (
                  <button key={label} type="button" role="radio" aria-checked={markOnBoard === on} onClick={() => setMarkOnBoard(on)}
                    className={`flex-1 min-h-11 px-3 text-sm rounded-lg border border-gray-900 ${markOnBoard === on ? 'bg-gray-900 text-white font-medium' : 'bg-white text-gray-900 hover:bg-gray-100'}`}>{label}</button>
                ))}
              </div>
            )}
            <label className="text-sm text-gray-900" htmlFor="mark-label">Name</label>
            <input id="mark-label" value={markLabel} onChange={(event) => setMarkLabel(event.target.value)}
              className="w-36 min-h-11 px-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
            {markFolders.length > 1 && !addsToBoard && (
              <>
                <label className="text-sm text-gray-900" htmlFor="mark-folder">Folder</label>
                <select id="mark-folder" value={markFolder} onChange={(event) => setMarkFolder(event.target.value)}
                  className="w-44 min-h-11 px-2 text-sm border border-gray-300 rounded-lg bg-white">
                  {markFolders.map(({ folder, depth }) => (
                    <option key={folder.id} value={folder.id}>{`${'\u00a0\u00a0'.repeat(Math.max(0, depth - (markFolders[0]?.depth ?? 0)))}${folder.name}`}</option>
                  ))}
                </select>
              </>
            )}
            {markParts.length > 0 && <p className="w-full text-sm text-gray-600">Part {markParts.length + 1}: this box joins the one{markParts.length > 1 ? 's' : ''} on p. {markParts.map((part) => pageName(labels, part.page)).join(', ')}.</p>}
            <button type="submit" className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">{addsToBoard ? 'Add to board' : 'Save and open'}</button>
            {page < pageCount && (
              <button type="button" onClick={continueMark} title="Keep this box and add the rest of the exercise from the next page"
                className="min-h-11 px-3 text-sm text-gray-900 border border-gray-900 bg-white rounded-lg hover:bg-gray-50">Goes on over the page</button>
            )}
            <button type="button" onClick={() => { setPendingMark(null); setMarkParts([]); }} className="min-h-11 px-3 text-sm text-gray-600 border border-gray-300 bg-white rounded-lg hover:bg-gray-50">Cancel</button>
          </form>
        )}
        onMark={(rect) => {
          if (copyBox) { setCopyDraft({ page, rect }); setCopyState('ready'); return; }
          if (markParts.length) { setPendingMark(rect); return; }
          if (!pendingMark) { setMarkLabel(nextLabel(shelfDocument, markKind)); setMarkFolder(startingFolder()); }
          setPendingMark(rect);
          void nameFromPage(page, rect);
        }}
        // A continued exercise's box on a later page is drawn from a copy; open the mark itself.
        onOpenMark={(mark) => { const own = shelfDocument.exercises.find((item) => item.id === mark.id); if (own) void openExercise(own); }}
        crop={crop}
        onTurn={turn}
        onTapMiddle={readingFullScreen ? () => { setBarsShown((shown) => !shown); setPanelOpen(false); } : undefined}
        ink={ink[page] ?? NO_INK}
        tool={inkTool}
        onInk={(strokes) => changeInk(page, strokes)}
        lit={litOnPage}
        boox={!exercise || pageSwapped}
      />
    </div>
  );

  // The book's lists: what the student made in it, and its contents from the PDF's bookmarks.
  const listPanel = (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 border-b border-gray-200">
        <div role="tablist" aria-label="Lists" className="flex gap-1">
          {LIST_TABS.map(({ tab, label }) => (
            <button key={tab} role="tab" aria-selected={listTab === tab} onClick={() => setListTab(tab)}
              className={`min-h-11 px-3 text-sm ${listTab === tab ? 'font-semibold text-gray-900 shadow-[inset_0_-3px_0_#111827]' : 'text-gray-600 hover:text-gray-900'}`}>
              {label}
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
        ) : listTab === 'search' ? (
          <BookSearch search={search} pageCount={pageCount} contents={contents} labels={labels} onGoTo={goToEntry} />
        ) : (
          <BookList pdf={pdf} marks={shelfDocument.exercises} solvedIds={solvedIds}
            favoriteIds={shelfDocument.exercises.filter((mark) => favoriteIds.includes(boardMarkOf(mark))).map((mark) => mark.id)} ink={ink} contents={contents} labels={labels}
            onOpen={(mark) => { setPanelOpen(false); void openExercise(mark); }} onGoTo={goToEntry} disabled={isStreaming} />
        )}
      </div>
    </>
  );

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {!fullScreen && (
        <AppBar place="book" locked={isStreaming} beforeLeave={saveNow} trail={(
          // The folders the book is in (its own folder lists every board made from it), then the book.
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-sm text-gray-500">
            {folderPath(library, bookFolder).map((step) => (
              <span key={step.id} className="flex items-center gap-1.5 min-w-0">
                <span aria-hidden="true">›</span>
                <Link href={folderHref(step.id)} className="text-gray-700 underline truncate">{step.name}</Link>
              </span>
            ))}
            {folderPath(library, bookFolder).at(-1)?.name !== shelfDocument.title && (
              <span className="flex items-center gap-1.5 min-w-0"><span aria-hidden="true">›</span><span className="text-gray-900 truncate">{shelfDocument.title}</span></span>
            )}
            <h1 className="sr-only">{shelfDocument.title}</h1>
          </nav>
        )}>
          {exercise && (
            <span className="text-xs text-gray-500" aria-live="polite">
              {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Not saved' : saveStatus === 'saved' ? 'Saved' : ''}
            </span>
          )}
        </AppBar>
      )}

      {error && <div role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{error}</div>}

      {exercise ? (
        <BoardFrame
          fullScreen={fullScreen}
          source={{ label: 'Page', wide: true, toolbar: pageToolbar, content: pageView, swap: { railLabel: `p. ${pageName(labels, exercise.page)}`, key: `${exercise.id}:${openings}`, onFlip: setPageSwapped, onShow: () => setPage(exercise.page) } }}
          title={(
            <div className="flex items-start gap-2">
            <button onClick={() => void closeExercise()} disabled={isStreaming} aria-label="Close board" title="Close board"
              className="flex shrink-0 items-center justify-center min-h-11 w-11 text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"><CloseIcon /></button>
            <div className="min-w-0 flex-1">
              {renaming !== null ? (
                <form onSubmit={(event) => { event.preventDefault(); void saveRename(); }} className="flex flex-wrap items-center gap-2">
                  <label htmlFor="rename-mark" className="sr-only">Name</label>
                  <input id="rename-mark" autoFocus value={renaming} onChange={(event) => setRenaming(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null); }}
                    className="w-48 min-h-11 px-2 text-sm font-semibold border border-gray-900 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900" />
                  <button type="submit" className="min-h-11 px-3 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-700">Rename</button>
                  <button type="button" onClick={() => setRenaming(null)} className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
                </form>
              ) : (
                <h2 className="min-w-0">
                  <button onClick={() => setRenaming(exercise.label)} title="Rename"
                    className="max-w-full font-semibold text-gray-900 truncate text-left rounded hover:underline decoration-dotted underline-offset-4 focus:outline-none focus:ring-2 focus:ring-gray-900">
                    {exercise.label}
                  </button>
                </h2>
              )}
              <p className="flex flex-wrap items-center gap-x-1 text-xs text-gray-600">
                <KindIcon type={isNote(exercise) ? 'note' : 'problem'} />{isNote(exercise) ? 'Notes' : 'Problem'} · p. {pageName(labels, exercise.page)}
              </p>
              {problems && problems.length > 1 && (
                <div role="group" aria-label="Exercises on this board" className="mt-1 flex flex-wrap gap-1">
                  {problems.map((problem) => {
                    const mark = shelfDocument.exercises.find((item) => item.id === problem.id);
                    return (
                      <button key={problem.id} aria-pressed={problem.id === exercise.id} disabled={!mark || isStreaming}
                        onClick={() => { if (mark) void openExercise(mark); }}
                        className={`min-h-11 px-3 flex items-center gap-1.5 text-sm rounded-lg border ${problem.id === exercise.id ? 'border-gray-900 bg-gray-100 font-semibold text-gray-900' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'} disabled:opacity-50`}>
                        {problem.isSolved && <SolvedCheck size={14} />}{problem.label}{problem.isSolved && <span className="sr-only"> (solved)</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            </div>
          )}
          actions={!fullScreen && (
            <MoreMenu label={`More for ${exercise.label}`} disabled={isStreaming}
              items={[
                { label: 'Rename', onSelect: () => setRenaming(exercise.label) },
                // It is put on an empty board by itself; this puts it back, e.g. after Clear.
                ...(problemImage ? [{ label: 'Put on board', onSelect: () => void canvasHandle.current?.placeProblemImage(problemImage, pictureKey(exercise)) }] : []),
                { label: isNote(exercise) ? 'Remove note page' : 'Remove exercise', onSelect: () => void removeMark(exercise) },
              ]} />
          )}
          canvas={<DrawingCanvas handleRef={canvasHandle} toolsHidden={toolsHidden} onShowTools={toggleTools} paper={paper}
            ask={{ sessionType: exercise && isNote(exercise) ? 'note' : 'problem', onAsk: (question) => void askForHelp(question), onAskMark: (question, mark, items) => void askAboutMark(question, mark, items), onMarkSolved: (mark, items) => void quietCheck({ sessionId: currentSessionId, key: mark.id, items, ...markAbout(mark) }), disabled: isStreaming }}
            paged={Boolean(exercise && isNote(exercise))} markFavorites={markFavorites} />}
          toolbar={(
            <BottomToolbar
              onAskForHelp={(question) => void askForHelp(question)}
              onClear={() => canvasHandle.current?.clear()}
              isStreaming={isStreaming}
              isSolved={isSolved}
              onToggleSolved={() => {
                sessionDispatch({ type: 'TOGGLE_SOLVED' });
                // Marked solved: the tutor reads it quietly, for Home only.
                if (!isSolved) void quietCheck({ sessionId: currentSessionId, key: problems && problems.length > 1 && currentProblem ? currentProblem : BOARD_CHECK, problemStatement, problemImage });
              }}
              sessionType={isNote(exercise) ? 'note' : 'problem'}
              paper={{ value: paper, onChange: (next) => sessionDispatch({ type: 'SET_PAPER', paper: next }) }}
              fullScreen={{ on: fullScreen, toggle: toggleFullScreen }}
              tools={{ hidden: toolsHidden, toggle: toggleTools }}
              tutor={{ open: tutorOpen, toggle: () => setTutorOpen((open) => !open) }}
              onSaveAs={(format) => void saveBoardAs(canvasHandle.current, format, `${exercise.label} - ${shelfDocument.title}`)}
              onAddPicture={(file) => void addPictureFromFile(canvasHandle.current, file)}
              onPastePicture={() => void pasteCopiedPicture(canvasHandle.current)}
              favorite={<FavoriteButton favorite={favorite.favorite} failed={favorite.failed} onStar={(reason) => void favorite.star(reason)} onUnstar={() => void favorite.unstar()} />}
              closeBoard={{ onClose: () => void closeExercise(), disabled: isStreaming }}
            />
          )}
          tutor={{ open: tutorOpen, onClose: () => setTutorOpen(false), content: (
            <>
              {/* What the tutor reads from the book with each question: a tutor setting, so it is here. */}
              {!isNote(exercise) && (
                <p className="flex flex-wrap items-center gap-x-1 px-3 py-1.5 text-xs text-gray-700 border-b border-gray-200">
                  <label htmlFor="tutor-reads" className="text-indigo-700">Reads from the book</label>
                  <select
                    id="tutor-reads"
                    value={range?.from ?? 0}
                    onChange={(event) => void changeReadFrom(exercise.id, Number(event.target.value))}
                    title={range?.section ? `Section: ${range.section}` : undefined}
                    className="min-h-8 px-1 py-0.5 text-xs text-gray-700 border border-gray-300 rounded bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
                  >
                    <option value={0}>no pages</option>
                    {Array.from({ length: Math.min(MAX_BOOK_PAGES, exercise.page) }, (_, index) => exercise.page - index).reverse().map((from) => (
                      <option key={from} value={from}>{from === exercise.page ? `p. ${from}` : `pp. ${from}–${exercise.page}`}</option>
                    ))}
                  </select>
                  {range && !bookHasText && <span className="font-medium text-gray-900">· no text in this PDF to read</span>}
                </p>
              )}
              <ChatPanel visible={tutorOpen} getBoardImages={getBoardImages} getBookContext={getBookContext} onAskForHelp={askForHelp} />
            </>
          ) }}
        />
      ) : readingFullScreen ? (
        // Reading full screen: the page and its rail (no bar above it), until a tap in the middle hides the rail.
        <div className="flex-1 min-h-0 flex flex-col bg-white">
          <div className="relative flex-1 min-h-0 flex">
          {barsShown && pageToolbar}
          <div className="flex-1 min-w-0 relative">
            <div className="absolute inset-0 overflow-y-auto">{pageView}</div>
            {askPanel && <div data-pen-control className="absolute inset-x-0 bottom-0 z-30 h-[55%] flex flex-col shadow-lg">{askPanel}</div>}
            {barsShown && panelOpen && !askPanel && (
              <section aria-label="Lists" data-pen-control className="absolute inset-y-0 left-0 z-20 w-[min(22rem,85%)] flex flex-col bg-white border-r border-gray-900 shadow-lg">
                {listPanel}
              </section>
            )}
          </div>
          </div>
        </div>
      ) : (
        // No board open: the page, and the list beside it (which can make way).
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <section className={`flex ${pageOnly ? 'flex-1' : 'basis-[45%]'} lg:basis-auto lg:flex-1 min-w-0 min-h-0 flex-col border-b lg:border-b-0 border-gray-200`}>
            <div className="relative flex-1 min-h-0 flex">
              {pageToolbar}
              <div className="flex-1 min-w-0 overflow-y-auto">{pageView}</div>
            </div>
          </section>
          <section className={`${pageOnly && !askPanel ? 'hidden' : 'flex'} flex-1 lg:flex-none lg:w-1/2 min-h-0 flex-col lg:border-l border-gray-200 bg-white`}>
            {askPanel || listPanel}
          </section>
        </div>
      )}
    </div>
  );
}
