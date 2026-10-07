'use client';

import { useRef, useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CanvasProvider, useCanvasState, useCanvasDispatch } from '@/context/CanvasContext';
import { SessionProvider, useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { saveSession as dbSaveSession, loadSession as dbLoadSession } from '@/lib/db';

import { getModelLabel, subscribeModelConfig } from '@/lib/modelConfig';

import type { SessionType } from '@/types';
import TopBar from './TopBar';
import BottomToolbar from './BottomToolbar';
import ProblemStatement from '../workspace/ProblemStatement';
import NoteHeader from '../workspace/NoteHeader';
import DrawingCanvas, { type DrawingCanvasHandle } from '../workspace/DrawingCanvas';
import ChatPanel from '../chat/ChatPanel';
import SessionList from '../sessions/SessionList';
import SettingsModal from './SettingsModal';

function AppContent() {
  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  // The board revision the tutor last saw, so follow-ups only attach a snapshot when it changed.
  const sentRevision = useRef<number | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelLabel = useSyncExternalStore(subscribeModelConfig, getModelLabel, () => '');
  const [chatOpen, setChatOpen] = useState(false);

  const { document: canvasDocument, pendingLoad } = useCanvasState();
  const canvasDispatch = useCanvasDispatch();
  const { currentSessionId, problemStatement, problemImage, chatHistory, isStreaming, isSolved, sessionType } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();

  const handleNew = useCallback((type: SessionType = 'problem') => {
    canvasDispatch({ type: 'LOAD' });
    sessionDispatch({ type: 'NEW_SESSION', sessionType: type });
  }, [canvasDispatch, sessionDispatch]);

  const handleSave = useCallback(async (opts?: { isSolvedOverride?: boolean }) => {
    const id = currentSessionId || uuidv4();
    const blob = await canvasHandle.current?.captureThumbnail() ?? null;
    const document = canvasHandle.current?.getDocument() ?? canvasDocument;

    await dbSaveSession({
      id,
      title: problemStatement.slice(0, 50) || 'Untitled',
      problemStatement,
      problemImage: problemImage ?? null,
      // Strokes from a pre-tldraw save stay until the editor has converted them.
      canvasStrokes: document ? [] : pendingLoad?.strokes ?? [],
      canvasDocument: document,
      canvasImageBlob: blob,
      chatHistory,
      isSolved: opts?.isSolvedOverride !== undefined ? opts.isSolvedOverride : isSolved,
      sessionType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    sessionDispatch({ type: 'SET_CURRENT_SESSION_ID', id });
  }, [currentSessionId, problemStatement, problemImage, canvasDocument, pendingLoad, chatHistory, isSolved, sessionType, sessionDispatch]);

  const handleLoad = useCallback(async (id: string) => {
    const session = await dbLoadSession(id);
    if (!session) return;

    sessionDispatch({
      type: 'LOAD_SESSION',
      sessionId: session.id,
      problemStatement: session.problemStatement,
      problemImage: session.problemImage ?? null,
      chatHistory: session.chatHistory,
      isSolved: session.isSolved,
      sessionType: session.sessionType,
    });
    canvasDispatch({ type: 'LOAD', document: session.canvasDocument, strokes: session.canvasStrokes });
  }, [sessionDispatch, canvasDispatch]);

  const handleAskForHelp = useCallback(async () => {
    // Read the editor directly: the context mirror lags a just-finished stroke.
    const handle = canvasHandle.current;
    sentRevision.current = handle?.getRevision() ?? null;
    const image = await handle?.captureImage() ?? '';
    setChatOpen(true);
    await sendHelp(image);
  }, [sendHelp]);

  const getFollowUpImage = useCallback(async (): Promise<string> => {
    const handle = canvasHandle.current;
    if (!handle || handle.getRevision() === sentRevision.current) return '';
    sentRevision.current = handle.getRevision();
    return handle.captureImage();
  }, []);

  const handleSetProblemImage = useCallback(async () => {
    const image = await canvasHandle.current?.captureImage();
    if (image) sessionDispatch({ type: 'SET_PROBLEM_IMAGE', image });
  }, [sessionDispatch]);

  const handleToggleSolved = useCallback(async () => {
    const newSolved = !isSolved;
    sessionDispatch({ type: 'TOGGLE_SOLVED' });
    await handleSave({ isSolvedOverride: newSolved });
  }, [isSolved, sessionDispatch, handleSave]);

  // Stable refs so the keyboard listener never needs to be re-registered
  const handleSaveRef = useRef(handleSave);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);

  // Keyboard shortcuts — registered once; refs always have the latest values
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs or contenteditable elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Undo, redo and delete are tldraw's own shortcuts.
      if (mod && key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <TopBar
        onNew={handleNew}
        onSave={handleSave}
        onOpenSessions={() => setSessionsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        modelLabel={modelLabel}
        chatOpen={chatOpen}
        onToggleChat={() => setChatOpen((o) => !o)}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: workspace */}
        <div className="flex-[3] flex flex-col min-w-0">
          {sessionType === 'note'
            ? <NoteHeader />
            : <ProblemStatement onCaptureProblemImage={handleSetProblemImage} />}
          <div className="flex-1 relative min-h-0">
            <DrawingCanvas handleRef={canvasHandle} />
          </div>
          <BottomToolbar
            onAskForHelp={handleAskForHelp}
            onClear={() => canvasHandle.current?.clear()}
            isStreaming={isStreaming}
            isSolved={isSolved}
            onToggleSolved={handleToggleSolved}
            sessionType={sessionType}
          />
        </div>

        {/* Right panel: chat (collapsible) */}
        {chatOpen && (
          <div className="flex-[2] min-w-[300px] border-l border-gray-200">
            <ChatPanel getCanvasImage={getFollowUpImage} />
          </div>
        )}
      </div>

      <SessionList
        isOpen={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onLoad={handleLoad}
      />

      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
      />
    </div>
  );
}

export default function AppShell() {
  return (
    <CanvasProvider>
      <SessionProvider>
        <AppContent />
      </SessionProvider>
    </CanvasProvider>
  );
}
