'use client';

import Link from 'next/link';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import content from '@/content/complex-geometry.json';
import { useCanvasDispatch, useCanvasState } from '@/context/CanvasContext';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useRateLimit } from '@/hooks/useRateLimit';
import { RATE_LIMIT_MS } from '@/lib/constants';
import { listSessions } from '@/lib/db';
import { loadWorkbookSession, saveWorkbookSession, stageWorkbookSession } from '@/lib/workbookStorage';
import type { Session, WorkbookContext } from '@/types';
import DrawingCanvas, { type DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import BottomToolbar from '@/components/layout/BottomToolbar';
import ChatMessage from '@/components/chat/ChatMessage';

const READING_ID = `workbook:${content.id}:reading`;
const exerciseKey = (id: string) => `workbook:${content.id}:exercise:${id}`;
const ACTIVE_EXERCISE_KEY = `workbook:${content.id}:activeExercise`;
const READING_SCROLL_KEY = `workbook:${content.id}:readingScroll`;
const recommendedPart: Record<string, string> = {
  x1_3_1: '(a)',
  x1_3_2: '(a)',
  x1_3_6: '(a)',
};

const contentClasses = 'text-[15px] leading-7 text-gray-800 [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:mb-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h3]:font-semibold [&_h3]:mt-4 [&_.para]:my-3 [&_p]:my-3 [&_figure]:my-6 [&_figure]:text-center [&_figcaption]:text-xs [&_figcaption]:text-gray-500 [&_img]:mx-auto [&_img]:max-w-full [&_img]:max-h-72 [&_a]:text-blue-700 [&_a]:underline [&_.definition]:rounded-lg [&_.definition]:bg-blue-50 [&_.definition]:p-4 [&_.theorem]:rounded-lg [&_.theorem]:bg-amber-50 [&_.theorem]:p-4 [&_.displaymath]:overflow-x-auto [&_.displaymath]:py-2 [&_.exercise]:my-2 [&_.task]:ml-5';

function WorkbookContent() {
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const switching = useRef(false);
  const [createdAt, setCreatedAt] = useState(0);
  const [selectedPassage, setSelectedPassage] = useState('');
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState('');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const readingScrollRef = useRef<HTMLDivElement>(null);
  const readingScrollTop = useRef(0);
  const readingTargetRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const latestSnapshot = useRef<Session | null>(null);
  const { strokes, selection } = useCanvasState();
  const canvasDispatch = useCanvasDispatch();
  const { chatHistory, problemStatement, isSolved, isStreaming } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { isLimited, formatRemaining, recordUsage } = useRateLimit(RATE_LIMIT_MS);

  const exercise = content.exercises.find((item) => item.id === exerciseId) ?? null;
  const workbookContext: WorkbookContext = useMemo(() => exercise
    ? { kind: 'exercise', sectionId: content.id, exerciseId: exercise.id }
    : { kind: 'reading', sectionId: content.id, selectedPassage },
  [exercise, selectedPassage]);
  const { sendHelp, sendFollowUp } = useTutorChat(workbookContext);

  const restore = useCallback((nextExerciseId: string | null, saved: Awaited<ReturnType<typeof loadWorkbookSession>>) => {
    const nextExercise = content.exercises.find((item) => item.id === nextExerciseId);
    const id = nextExerciseId ? exerciseKey(nextExerciseId) : READING_ID;
    sessionDispatch({
      type: 'LOAD_SESSION',
      sessionId: id,
      problemStatement: nextExercise?.text ?? content.title,
      problemImage: null,
      chatHistory: (saved?.chatHistory ?? []).map((message) => message.role === 'assistant' && (message.pending || !message.content.trim())
        ? { ...message, pending: false, content: `${message.content}\n\nThe tutor response was interrupted. Ask again to continue.` }
        : message),
      isSolved: saved?.isSolved ?? false,
      sessionType: nextExerciseId ? 'problem' : 'note',
    });
    canvasDispatch({ type: 'LOAD_STROKES', strokes: saved?.canvasStrokes ?? [] });
    setCreatedAt(saved?.createdAt ?? Date.now());
    setExerciseId(nextExerciseId);
    setSelectedPassage('');
    setReady(true);
  }, [canvasDispatch, sessionDispatch]);

  useEffect(() => {
    let active = true;
    async function loadProgress() {
      try {
        const lastExerciseId = localStorage.getItem(ACTIVE_EXERCISE_KEY);
        const initialExerciseId = content.exercises.some((item) => item.id === lastExerciseId) ? lastExerciseId : null;
        readingScrollTop.current = Number(localStorage.getItem(READING_SCROLL_KEY)) || 0;
        const [saved, sessions] = await Promise.all([
          loadWorkbookSession(initialExerciseId ? exerciseKey(initialExerciseId) : READING_ID), listSessions(),
        ]);
        if (!active) return;
        const completed = sessions.filter((item) => item.isSolved && item.id.startsWith(`workbook:${content.id}:exercise:`)).map((item) => item.id.split(':').at(-1) ?? '');
        if (initialExerciseId && saved) {
          const index = completed.indexOf(initialExerciseId);
          if (saved.isSolved && index < 0) completed.push(initialExerciseId);
          if (!saved.isSolved && index >= 0) completed.splice(index, 1);
        }
        setCompletedIds(completed);
        setSaveError('');
        restore(initialExerciseId, saved);
      } catch {
        if (active) setSaveError('Could not load workbook progress. Retry to restore your saved work.');
      }
    }
    void loadProgress();
    return () => { active = false; };
  }, [restore, loadAttempt]);

  const currentSnapshot = useMemo<Session | null>(() => ready ? ({
    id: exerciseId ? exerciseKey(exerciseId) : READING_ID,
    title: exercise ? `Complex Analysis 1.3 · Exercise ${exercise.number}` : 'Complex Analysis 1.3 · Reading',
    problemStatement, problemImage: null, canvasStrokes: exerciseId ? strokes : [], canvasImageBlob: null,
    chatHistory, createdAt, updatedAt: Date.now(), isSolved, sessionType: exerciseId ? 'problem' : 'note',
  }) : null, [ready, exerciseId, exercise, problemStatement, strokes, chatHistory, createdAt, isSolved]);

  const persistCurrent = useCallback(async (): Promise<boolean> => {
    if (!currentSnapshot) return true;
    try {
      await saveWorkbookSession(currentSnapshot);
      setSaveError('');
      return true;
    } catch {
      setSaveError('Progress could not be saved. Please try again before leaving.');
      return false;
    }
  }, [currentSnapshot]);

  useLayoutEffect(() => {
    if (!currentSnapshot) return;
    latestSnapshot.current = currentSnapshot;
    try { stageWorkbookSession(currentSnapshot); }
    catch { /* The IndexedDB save below reports any durable storage failure. */ }
  }, [currentSnapshot]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const timer = setTimeout(() => { void persistCurrent(); }, 600);
    return () => clearTimeout(timer);
  }, [currentSnapshot, persistCurrent]);

  useEffect(() => {
    const flush = () => {
      if (latestSnapshot.current) void saveWorkbookSession(latestSnapshot.current).catch(() => {
        setSaveError('Progress could not be saved. Please try again before leaving.');
      });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      flush();
    };
  }, []);

  useEffect(() => {
    const element = chatScrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chatHistory]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('input, textarea, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault(); void persistCurrent();
      } else if (exerciseId && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); canvasDispatch({ type: event.shiftKey ? 'REDO' : 'UNDO' });
      } else if (exerciseId && selection && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault(); canvasDispatch({ type: 'ERASE_SELECTION', rect: selection });
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [exerciseId, selection, canvasDispatch, persistCurrent]);

  useEffect(() => {
    if (ready && !exerciseId && readingScrollRef.current) {
      const target = readingTargetRef.current ? document.getElementById(readingTargetRef.current) : null;
      if (target) target.scrollIntoView({ block: 'start' });
      else readingScrollRef.current.scrollTop = readingScrollTop.current;
      readingTargetRef.current = null;
    }
  }, [ready, exerciseId]);

  const openView = useCallback(async (nextExerciseId: string | null, readingAnchor?: string) => {
    if (!ready || switching.current || isStreaming || nextExerciseId === exerciseId) return;
    switching.current = true;
    setReady(false);
    const savedCurrent = await persistCurrent();
    if (!savedCurrent) { switching.current = false; setReady(true); return; }
    try {
      const saved = await loadWorkbookSession(nextExerciseId ? exerciseKey(nextExerciseId) : READING_ID);
      readingTargetRef.current = readingAnchor ?? null;
      if (nextExerciseId) localStorage.setItem(ACTIVE_EXERCISE_KEY, nextExerciseId);
      else localStorage.removeItem(ACTIVE_EXERCISE_KEY);
      restore(nextExerciseId, saved);
      setDraft('');
    } catch {
      setSaveError('Could not open that exercise.');
      setReady(true);
    } finally { switching.current = false; }
  }, [ready, isStreaming, exerciseId, persistCurrent, restore]);

  const sendQuestion = async (event: React.FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || isStreaming) return;
    setDraft('');
    if (chatHistory.length === 0) await sendHelp('', question);
    else await sendFollowUp(question);
  };

  const reviewWhiteboard = async () => {
    if (!exercise || isLimited || isStreaming) return;
    const image = strokes.length > 0 && canvasRef.current
      ? selection ? canvasRef.current.captureRegion(selection) : canvasRef.current.captureFullCanvas()
      : '';
    const success = await sendHelp(image, 'Please look at my current work and give me a hint about the next step.');
    if (success) recordUsage();
  };

  const toggleComplete = () => {
    if (!exercise) return;
    sessionDispatch({ type: 'TOGGLE_SOLVED' });
    setCompletedIds((current) => isSolved ? current.filter((id) => id !== exercise.id) : [...current, exercise.id]);
  };

  const selectPassage = () => {
    const selected = window.getSelection();
    const reader = readingScrollRef.current;
    if (!reader || !selected || !reader.contains(selected.anchorNode) || !reader.contains(selected.focusNode)) return;
    const passage = selected.toString().trim();
    if (passage) setSelectedPassage(passage.slice(0, 1200));
  };

  return (
    <div className={`${exercise ? 'min-h-screen lg:h-screen' : 'h-screen'} flex flex-col bg-gray-50`}>
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Link href="/" onClick={(event) => { if (isStreaming) event.preventDefault(); }} aria-disabled={isStreaming} className="text-blue-700 hover:underline">Math Tutor</Link>
            <span>›</span><span>Workbook</span><span>›</span><span>Complex Analysis</span>
          </div>
          <h1 className="font-semibold text-gray-900 truncate">{exercise ? `Exercise ${exercise.number.replace('.', '')}` : '1.3 · The Geometry of Complex Numbers'}</h1>
        </div>
        {exercise && <button onClick={() => void openView(null)} disabled={!ready || isStreaming} className="shrink-0 px-3 py-1.5 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50">Back to reading</button>}
      </header>

      {saveError && <div role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 border-b border-red-100">{saveError}</div>}

      {!ready ? <div className="p-6 text-gray-500">{saveError ? <button className="text-blue-700 underline" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Retry loading progress</button> : 'Loading workbook…'}</div> : (
        <div className={`flex-1 flex flex-col lg:flex-row ${exercise ? 'lg:min-h-0' : 'min-h-0'}`}>
          <main className={`flex-1 min-w-0 flex flex-col ${exercise ? 'min-h-[650px] lg:min-h-0' : 'min-h-0'}`}>
            {exercise ? (
              <>
                <div className="overflow-y-auto max-h-48 bg-white border-b border-gray-200 px-6 py-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Exercise {exercise.number}</div>
                  <SourceCredit exerciseId={exercise.id} />
                  <div className={contentClasses} onClick={(event) => {
                    const link = (event.target as Element).closest('a[href^="#"]');
                    if (!link) return;
                    const anchor = link.getAttribute('href')?.slice(1);
                    if (anchor) { event.preventDefault(); void openView(null, anchor); }
                  }} dangerouslySetInnerHTML={{ __html: exercise.html }} />
                </div>
                <div className="order-2 lg:order-none h-[60vh] min-h-[400px] flex-none lg:h-auto lg:min-h-0 lg:flex-1 overflow-y-auto pt-3">
                  <DrawingCanvas ref={canvasRef} />
                </div>
                <div className="order-1 lg:order-none">
                  <BottomToolbar onAskForHelp={() => void reviewWhiteboard()} isStreaming={isStreaming} isSolved={isSolved} onToggleSolved={toggleComplete} sessionType="problem" completionLabel="attempt" />
                </div>
              </>
            ) : (
              <div ref={readingScrollRef} className="overflow-y-auto px-6 py-5" onMouseUp={selectPassage} onScroll={(event) => { readingScrollTop.current = event.currentTarget.scrollTop; localStorage.setItem(READING_SCROLL_KEY, String(readingScrollTop.current)); }}>
                <div className="max-w-3xl mx-auto">
                  <SourceCredit />
                  <p className="text-sm text-gray-600 mb-4">Select a passage to ask about it, or ask a question at any time.</p>
                  <div className={contentClasses} dangerouslySetInnerHTML={{ __html: content.readingHtml }} />
                  <section className="mt-10 mb-8 border-t border-gray-200 pt-6">
                    <h2 className="text-xl font-semibold text-gray-900">Exercises</h2>
                    <p className="text-sm text-gray-600 mt-1 mb-4">Recommended problems give you a path through the section. Every problem has its own whiteboard.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {content.exercises.map((item) => (
                        <button key={item.id} onClick={() => void openView(item.id)} disabled={isStreaming} className="text-left p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50">
                          <span className="font-medium text-gray-900">Exercise {item.number}</span>
                          {content.recommendedIds.includes(item.id) && <span className="ml-2 text-xs text-blue-700">Recommended{recommendedPart[item.id] ? `: ${recommendedPart[item.id]}` : ''}</span>}
                          {completedIds.includes(item.id) && <span className="ml-2 text-xs text-green-700">Complete</span>}
                          <span className="block text-xs text-gray-500 truncate mt-1">{item.text}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </div>
            )}
          </main>

          <aside className={`${exercise ? 'h-[320px]' : 'h-[38vh]'} lg:h-auto lg:w-[380px] lg:border-l border-t lg:border-t-0 border-gray-200 bg-white flex flex-col shrink-0`}>
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">{exercise ? 'Problem tutor' : 'Reading tutor'}</h2>
              <p className="text-xs text-gray-500">{exercise ? 'Ask about your approach or submit your whiteboard for a hint. The tutor will not give a complete solution.' : 'Ask about the text as you read. Reading questions have no wait.'}</p>
            </div>
            <div ref={chatScrollRef} aria-live="polite" aria-busy={isStreaming} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {chatHistory.length === 0 ? <p className="text-sm text-gray-400 text-center mt-6">{exercise ? 'Your conversation for this exercise starts here.' : 'What would you like to understand better?'}</p> : chatHistory.map((message) => <ChatMessage key={message.id} message={message} />)}
            </div>
            {selectedPassage && !exercise && <div className="mx-3 mb-2 px-3 py-2 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-800 flex gap-2"><span className="line-clamp-2 flex-1">Selected: {selectedPassage}</span><button onClick={() => setSelectedPassage('')} aria-label="Clear selected passage">×</button></div>}
            <form onSubmit={sendQuestion} className="p-3 border-t border-gray-200 flex gap-2">
              <input aria-label={exercise ? `Question about exercise ${exercise.number}` : 'Question about the reading'} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={isStreaming} placeholder={exercise ? 'Ask about this problem…' : 'Ask about the reading…'} className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" disabled={!draft.trim() || isStreaming} className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg disabled:opacity-40">Ask</button>
            </form>
            {exercise && isLimited && <p className="px-3 pb-2 text-xs text-gray-500">Whiteboard review available in {formatRemaining()}. Text questions are available now.</p>}
          </aside>
        </div>
      )}
    </div>
  );
}

function SourceCredit({ exerciseId }: { exerciseId?: string }) {
  return <p className="mt-2 mb-4 text-xs text-gray-500">Adapted from <a className="underline" href={exerciseId ? `${content.sourceUrl}#${exerciseId}` : content.sourceUrl} target="_blank" rel="noopener noreferrer">{content.bookTitle}, §1.3</a> by {content.authors}, licensed under <a className="underline" href={content.licenseUrl} target="_blank" rel="noopener noreferrer">CC BY 4.0</a>. Exercise solutions omitted; two mathematical typos and an identity reference corrected; workbook layout and tutor added.</p>;
}

export default function Workbook() {
  return <WorkbookContent />;
}
