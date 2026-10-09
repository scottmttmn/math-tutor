'use client';

import { useRef, useState, useCallback, useEffect, useSyncExternalStore } from 'react';
import { CanvasProvider } from '@/context/CanvasContext';
import { SessionProvider, useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';

import { getModelLabel, subscribeModelConfig } from '@/lib/modelConfig';

import type { SessionType } from '@/types';
import TopBar from './TopBar';
import BottomToolbar from './BottomToolbar';
import ProblemStatement from '../workspace/ProblemStatement';
import NoteHeader from '../workspace/NoteHeader';
import DrawingCanvas, { type DrawingCanvasHandle } from '../workspace/DrawingCanvas';
import ChatPanel from '../chat/ChatPanel';
import History from '../sessions/History';
import SettingsModal from './SettingsModal';

function AppContent() {
  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  // The board revision the tutor last saw, so follow-ups only attach a snapshot when it changed.
  const sentRevision = useRef<number | null>(null);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const modelLabel = useSyncExternalStore(subscribeModelConfig, getModelLabel, () => '');
  const [chatOpen, setChatOpen] = useState(false);

  const { currentSessionId, isStreaming, isSolved, sessionType } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { status: saveStatus, saveNow, openSession, startNew } = useSessionAutosave(canvasHandle);

  const handleNew = useCallback((type: SessionType = 'problem') => { void startNew(type); }, [startNew]);
  const handleLoad = useCallback((id: string) => { void openSession(id); }, [openSession]);
  // A deleted session must not be saved again by the next autosave.
  const handleDeleted = useCallback((id: string) => {
    if (id === currentSessionId) void startNew(sessionType, { discardCurrent: true });
  }, [currentSessionId, sessionType, startNew]);

  const handleAskForHelp = useCallback(async () => {
    if (getTutorWaitMs() > 0) return;
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

  // Stable refs so the keyboard listener never needs to be re-registered
  const saveNowRef = useRef(saveNow);
  useEffect(() => { saveNowRef.current = saveNow; }, [saveNow]);

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
        void saveNowRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <TopBar
        onNew={handleNew}
        saveStatus={saveStatus}
        onSave={() => void saveNow()}
        // Save first so the list includes the latest changes.
        onOpenSessions={() => { void saveNow().then(() => setSessionsOpen(true)); }}
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
            onToggleSolved={() => sessionDispatch({ type: 'TOGGLE_SOLVED' })}
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

      <History
        isOpen={sessionsOpen}
        currentSessionId={currentSessionId}
        onClose={() => setSessionsOpen(false)}
        onOpen={handleLoad}
        onDeleted={handleDeleted}
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
