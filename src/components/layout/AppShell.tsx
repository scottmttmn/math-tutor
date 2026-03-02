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

import TopBar from './TopBar';
import BottomToolbar from './BottomToolbar';
import ProblemStatement from '../workspace/ProblemStatement';
import DrawingCanvas, { type DrawingCanvasHandle } from '../workspace/DrawingCanvas';
import ChatPanel from '../chat/ChatPanel';
import SessionList from '../sessions/SessionList';

function AppContent() {
  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const { strokes, selection } = useCanvasState();
  const canvasDispatch = useCanvasDispatch();
  const { currentSessionId, problemStatement, chatHistory, isStreaming } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { recordUsage } = useRateLimit(RATE_LIMIT_MS);

  const handleNew = useCallback(() => {
    canvasDispatch({ type: 'CLEAR' });
    sessionDispatch({ type: 'NEW_SESSION' });
  }, [canvasDispatch, sessionDispatch]);

  const handleSave = useCallback(async () => {
    const id = currentSessionId || uuidv4();
    const canvas = canvasHandle.current?.getCanvas();
    const blob = canvas ? await canvasToBlob(canvas) : null;

    await dbSaveSession({
      id,
      title: problemStatement.slice(0, 50) || 'Untitled',
      problemStatement,
      canvasStrokes: strokes,
      canvasImageBlob: blob,
      chatHistory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    sessionDispatch({ type: 'SET_CURRENT_SESSION_ID', id });
  }, [currentSessionId, problemStatement, strokes, chatHistory, sessionDispatch]);

  const handleLoad = useCallback(async (id: string) => {
    const session = await dbLoadSession(id);
    if (!session) return;

    sessionDispatch({
      type: 'LOAD_SESSION',
      sessionId: session.id,
      problemStatement: session.problemStatement,
      chatHistory: session.chatHistory,
    });
    canvasDispatch({ type: 'LOAD_STROKES', strokes: session.canvasStrokes });
  }, [sessionDispatch, canvasDispatch]);

  const handleAskForHelp = useCallback(async () => {
    let image = '';
    if (selection && canvasHandle.current) {
      image = canvasHandle.current.captureRegion(selection);
    } else if (canvasHandle.current) {
      image = canvasHandle.current.captureFullCanvas();
    }

    if (!image) return;

    const success = await sendHelp(image);
    if (success) {
      recordUsage();
    }
  }, [selection, sendHelp, recordUsage]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        canvasDispatch({ type: 'UNDO' });
      } else if (mod && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        canvasDispatch({ type: 'REDO' });
      } else if (mod && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [canvasDispatch, handleSave]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <TopBar
        onNew={handleNew}
        onSave={handleSave}
        onOpenSessions={() => setSessionsOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: workspace */}
        <div className="flex-[3] flex flex-col min-w-0">
          <ProblemStatement />
          <DrawingCanvas ref={canvasHandle} />
          <BottomToolbar onAskForHelp={handleAskForHelp} isStreaming={isStreaming} />
        </div>

        {/* Right panel: chat */}
        <div className="flex-[2] min-w-[300px]">
          <ChatPanel />
        </div>
      </div>

      <SessionList
        isOpen={sessionsOpen}
        onClose={() => setSessionsOpen(false)}
        onLoad={handleLoad}
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
