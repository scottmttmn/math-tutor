'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CanvasProvider, useCanvasState, useCanvasDispatch } from '@/context/CanvasContext';
import { SessionProvider, useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { useRateLimit } from '@/hooks/useRateLimit';
import { saveSession as dbSaveSession, loadSession as dbLoadSession } from '@/lib/db';
import { canvasToBlob } from '@/lib/canvasUtils';
import { RATE_LIMIT_MS } from '@/lib/constants';

import { getModelConfig } from '@/lib/modelConfig';

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
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modelLabel, setModelLabel] = useState('');
  useEffect(() => { setModelLabel(getModelConfig().model); }, []);
  const [chatOpen, setChatOpen] = useState(false);

  const { strokes, selection } = useCanvasState();
  const canvasDispatch = useCanvasDispatch();
  const { currentSessionId, problemStatement, problemImage, chatHistory, isStreaming, isSolved, sessionType } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { recordUsage } = useRateLimit(RATE_LIMIT_MS);

  const handleNew = useCallback((type: SessionType = 'problem') => {
    canvasDispatch({ type: 'CLEAR' });
    sessionDispatch({ type: 'NEW_SESSION', sessionType: type });
  }, [canvasDispatch, sessionDispatch]);

  const handleSave = useCallback(async (opts?: { isSolvedOverride?: boolean }) => {
    const id = currentSessionId || uuidv4();
    const canvas = canvasHandle.current?.getCanvas();
    const blob = canvas ? await canvasToBlob(canvas) : null;

    await dbSaveSession({
      id,
      title: problemStatement.slice(0, 50) || 'Untitled',
      problemStatement,
      problemImage: problemImage ?? null,
      canvasStrokes: strokes,
      canvasImageBlob: blob,
      chatHistory,
      isSolved: opts?.isSolvedOverride !== undefined ? opts.isSolvedOverride : isSolved,
      sessionType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    sessionDispatch({ type: 'SET_CURRENT_SESSION_ID', id });
  }, [currentSessionId, problemStatement, problemImage, strokes, chatHistory, isSolved, sessionType, sessionDispatch]);

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
    canvasDispatch({ type: 'LOAD_STROKES', strokes: session.canvasStrokes });
  }, [sessionDispatch, canvasDispatch]);

  const handleAskForHelp = useCallback(async () => {
    let image = '';
    if (strokes.length > 0) {
      if (selection && canvasHandle.current) {
        image = canvasHandle.current.captureRegion(selection);
      } else if (canvasHandle.current) {
        image = canvasHandle.current.captureFullCanvas();
      }
    }
    setChatOpen(true);
    const success = await sendHelp(image);
    if (success) recordUsage();
  }, [selection, strokes.length, sendHelp, recordUsage]);

  const handleSetProblemImage = useCallback(() => {
    if (!canvasHandle.current) return;
    const image = canvasHandle.current.captureFullCanvas();
    sessionDispatch({ type: 'SET_PROBLEM_IMAGE', image });
  }, [sessionDispatch]);

  const handleToggleSolved = useCallback(async () => {
    const newSolved = !isSolved;
    sessionDispatch({ type: 'TOGGLE_SOLVED' });
    await handleSave({ isSolvedOverride: newSolved });
  }, [isSolved, sessionDispatch, handleSave]);

  // Stable refs so the keyboard listener never needs to be re-registered
  const handleSaveRef = useRef(handleSave);
  const selectionRef = useRef(selection);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
  useEffect(() => { selectionRef.current = selection; }, [selection]);

  // Keyboard shortcuts — registered once; refs always have the latest values
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire shortcuts when typing in inputs or contenteditable elements
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        canvasDispatch({ type: 'UNDO' });
      } else if (mod && key === 'z' && e.shiftKey) {
        e.preventDefault();
        canvasDispatch({ type: 'REDO' });
      } else if (mod && key === 's') {
        e.preventDefault();
        handleSaveRef.current();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectionRef.current) {
        e.preventDefault();
        canvasDispatch({ type: 'ERASE_SELECTION', rect: selectionRef.current });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canvasDispatch]); // canvasDispatch is stable (from useReducer) — listener registered once

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
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <DrawingCanvas ref={canvasHandle} />
          </div>
          <BottomToolbar
            onAskForHelp={handleAskForHelp}
            isStreaming={isStreaming}
            isSolved={isSolved}
            onToggleSolved={handleToggleSolved}
            sessionType={sessionType}
          />
        </div>

        {/* Right panel: chat (collapsible) */}
        {chatOpen && (
          <div className="flex-[2] min-w-[300px] border-l border-gray-200">
            <ChatPanel />
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
          setModelLabel(getModelConfig().model);
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
