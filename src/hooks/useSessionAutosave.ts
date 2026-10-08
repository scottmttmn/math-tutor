'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasDispatch, useCanvasState } from '@/context/CanvasContext';
import { useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { hasRecoveryCopy, loadRecoveredSession, saveRecoverableSession, settleInterruptedReplies, stageSession } from '@/lib/sessionRecovery';
import type { DrawingCanvasHandle } from '@/components/workspace/DrawingCanvas';
import type { AutosaveStatus, Session, SessionType } from '@/types';

// The session the main page reopens after a reload.
const CURRENT_SESSION_KEY = 'math-tutor:currentSession';
const SAVE_DELAY_MS = 800;

// Everything a save writes except timestamps and the thumbnail, so an unchanged session isn't rewritten.
const contentKey = (session: Session) => JSON.stringify([
  session.problemStatement, session.problemImage, session.chatHistory, session.isSolved, session.sessionType,
  session.canvasDocument?.store ?? null, session.canvasStrokes,
]);

function rememberCurrent(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_SESSION_KEY, id);
    else localStorage.removeItem(CURRENT_SESSION_KEY);
  } catch { /* Reopening the last session is a convenience. */ }
}

/**
 * Saves the main page's session to IndexedDB shortly after each change, flushes it when the page
 * is hidden, and reopens it after a reload. Returns the save status and the ways to switch sessions.
 */
export function useSessionAutosave(canvasHandle: RefObject<DrawingCanvasHandle | null>) {
  const state = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { document: canvasDocument, pendingLoad, hasContent } = useCanvasState();
  const canvasDispatch = useCanvasDispatch();
  const [status, setStatus] = useState<AutosaveStatus>('idle');

  const latest = useRef({ ...state, canvasDocument, pendingLoad, hasContent });
  useLayoutEffect(() => { latest.current = { ...state, canvasDocument, pendingLoad, hasContent }; });

  // Id for a new session until its first save; created lazily so render stays pure.
  const draftId = useRef<string | null>(null);
  const createdAt = useRef(0);
  const thumbnail = useRef<Blob | null>(null);
  const savedKey = useRef<string | null>(null);
  // True from a load request until the editor shows it; nothing is saved in between.
  const loading = useRef(true);
  const awaitingEditor = useRef(false);
  // A session restored from its recovery copy still needs its durable save.
  const loadedUnsaved = useRef(false);
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const snapshot = useCallback((): Session | null => {
    const s = latest.current;
    const isEmpty = !s.currentSessionId && !s.problemStatement.trim() && !s.problemImage && s.chatHistory.length === 0 && !s.hasContent;
    if (loading.current || isEmpty) return null;
    if (!s.currentSessionId && !draftId.current) draftId.current = uuidv4();
    if (!createdAt.current) createdAt.current = Date.now();
    // Read the editor directly: the context mirror lags a just-finished stroke.
    const document = canvasHandle.current?.getDocument() ?? s.canvasDocument;
    return {
      id: s.currentSessionId ?? draftId.current!,
      title: s.problemStatement.slice(0, 50) || 'Untitled',
      problemStatement: s.problemStatement,
      problemImage: s.problemImage,
      // Strokes from a pre-tldraw save stay until the editor has converted them.
      canvasStrokes: document ? [] : s.pendingLoad?.strokes ?? [],
      canvasDocument: document,
      canvasImageBlob: thumbnail.current,
      chatHistory: s.chatHistory,
      createdAt: createdAt.current,
      updatedAt: Date.now(),
      isSolved: s.isSolved,
      sessionType: s.sessionType,
    };
  }, [canvasHandle]);

  const persist = useCallback((): Promise<boolean> => {
    const run = async () => {
      const session = snapshot();
      if (!session) return true;
      const key = contentKey(session);
      if (key === savedKey.current) return true;
      setStatus('saving');
      try {
        thumbnail.current = await canvasHandle.current?.captureThumbnail() ?? null;
        await saveRecoverableSession({ ...session, canvasImageBlob: thumbnail.current });
        // The student may have moved to another session while this one was saving.
        const { currentSessionId } = latest.current;
        if (currentSessionId ? currentSessionId === session.id : draftId.current === session.id) {
          savedKey.current = key;
          if (!currentSessionId) {
            sessionDispatch({ type: 'SET_CURRENT_SESSION_ID', id: session.id });
            draftId.current = null;
          }
          rememberCurrent(session.id);
        }
        setStatus('saved');
        return true;
      } catch {
        setStatus('error');
        return false;
      }
    };
    // One save at a time, so an older snapshot never lands after a newer one.
    queue.current = queue.current.then(run, run);
    return queue.current;
  }, [snapshot, canvasHandle, sessionDispatch]);

  const applyLoad = useCallback((session: Session | undefined, type: SessionType = 'problem') => {
    loading.current = true;
    awaitingEditor.current = true;
    savedKey.current = null;
    try { loadedUnsaved.current = Boolean(session && hasRecoveryCopy(session.id)); } catch { loadedUnsaved.current = false; }
    draftId.current = null;
    createdAt.current = session?.createdAt ?? 0;
    thumbnail.current = session?.canvasImageBlob ?? null;
    if (session) {
      sessionDispatch({
        type: 'LOAD_SESSION',
        sessionId: session.id,
        problemStatement: session.problemStatement,
        problemImage: session.problemImage ?? null,
        chatHistory: settleInterruptedReplies(session.chatHistory),
        isSolved: session.isSolved,
        sessionType: session.sessionType,
      });
      canvasDispatch({ type: 'LOAD', document: session.canvasDocument, strokes: session.canvasStrokes });
    } else {
      sessionDispatch({ type: 'NEW_SESSION', sessionType: type });
      canvasDispatch({ type: 'LOAD' });
    }
    rememberCurrent(session?.id ?? null);
    setStatus(session ? 'saved' : 'idle');
  }, [sessionDispatch, canvasDispatch]);

  /** Saves the current session, then opens a saved one. False when the current one couldn't be saved. */
  const openSession = useCallback(async (id: string): Promise<boolean> => {
    if (!await persist()) return false;
    const session = await loadRecoveredSession(id).catch(() => undefined);
    if (!session) return false;
    applyLoad(session);
    return true;
  }, [persist, applyLoad]);

  /** Saves the current session (unless it was just deleted), then starts an empty one. */
  const startNew = useCallback(async (type: SessionType, opts?: { discardCurrent?: boolean }): Promise<boolean> => {
    if (!opts?.discardCurrent && !await persist()) return false;
    applyLoad(undefined, type);
    return true;
  }, [persist, applyLoad]);

  // Reopen the last session after a reload.
  useEffect(() => {
    let active = true;
    let id: string | null = null;
    try { id = localStorage.getItem(CURRENT_SESSION_KEY); } catch { /* Start fresh. */ }
    if (!id) { loading.current = false; return; }
    loadRecoveredSession(id)
      .then((session) => { if (active) applyLoad(session); })
      .catch(() => { if (active) loading.current = false; });
    return () => { active = false; };
  }, [applyLoad]);

  // Once the editor shows a loaded session, take it as saved so opening one doesn't rewrite it.
  useEffect(() => {
    if (!awaitingEditor.current || pendingLoad) return;
    awaitingEditor.current = false;
    loading.current = false;
    const session = snapshot();
    savedKey.current = session && !loadedUnsaved.current ? contentKey(session) : null;
  }, [pendingLoad, snapshot]);

  // Save shortly after the student stops changing anything.
  useEffect(() => {
    const timer = setTimeout(() => { void persist(); }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state.problemStatement, state.problemImage, state.chatHistory, state.isSolved, state.sessionType, canvasDocument, persist]);

  // A reload or closed tab can't wait for IndexedDB; keep a synchronous copy for the next load.
  useEffect(() => {
    const flush = () => {
      const session = snapshot();
      if (!session || contentKey(session) === savedKey.current) return;
      try { stageSession(session); rememberCurrent(session.id); } catch { /* The save below may still finish. */ }
      void persist();
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [snapshot, persist]);

  return { status, saveNow: persist, openSession, startNew };
}
