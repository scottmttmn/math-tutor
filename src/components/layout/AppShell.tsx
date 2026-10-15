'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { CanvasProvider } from '@/context/CanvasContext';
import { SessionProvider, useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';
import { useBoardFullScreen } from '@/hooks/useBoardFullScreen';
import { useToolsHidden } from '@/hooks/useToolsHidden';
import { useWriteUp } from '@/hooks/useWriteUp';

import type { SessionType } from '@/types';
import TopBar from './TopBar';
import BottomToolbar from './BottomToolbar';
import ProblemStatement from '../workspace/ProblemStatement';
import NoteHeader from '../workspace/NoteHeader';
import CheckInHeader from '../workspace/CheckInHeader';
import { checkInStarted, checkInTitle } from '@/lib/checkIn';
import DrawingCanvas, { type DrawingCanvasHandle } from '../workspace/DrawingCanvas';
import ChatPanel from '../chat/ChatPanel';
import BoardFrame from './BoardFrame';
import WriteUpPanel from '../workspace/WriteUpPanel';
import { KindIcon } from '@/components/common/Icons';
import { saveBoardAs } from '@/lib/exportBoard';

function AppContent() {
  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  // The board revision the tutor last saw, so follow-ups only attach a snapshot when it changed.
  const sentRevision = useRef<number | null>(null);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [writeUpOpen, setWriteUpOpen] = useState(false);
  const { fullScreen, toggle: toggleFullScreen, leave: leaveFullScreen } = useBoardFullScreen();
  const { toolsHidden, toggleTools } = useToolsHidden();

  const { isStreaming, isSolved, sessionType, problemStatement, checkIn, chatHistory } = useSessionState();
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { status: saveStatus, saveNow, startNew } = useSessionAutosave(canvasHandle);
  const writeUp = useWriteUp();
  const boardTitle = checkIn ? checkInTitle(checkIn) : problemStatement || (sessionType === 'note' ? 'Notes' : 'Problem');

  // A new board opens with its tutor closed, so the problem or topic is in view.
  const { cancel: cancelWriteUp } = writeUp;
  const handleNew = useCallback((type: SessionType = 'problem') => {
    setTutorOpen(false);
    setWriteUpOpen(false);
    cancelWriteUp();
    void startNew(type);
  }, [startNew, cancelWriteUp]);

  // New from another page arrives as /board?new=problem|note; start it once, then drop it from the URL.
  useEffect(() => {
    const type = new URLSearchParams(window.location.search).get('new');
    if (type !== 'problem' && type !== 'note') return;
    window.history.replaceState(null, '', '/board');
    void startNew(type);
  }, [startNew]);

  const handleAskForHelp = useCallback(async () => {
    if (getTutorWaitMs() > 0) return;
    // Read the editor directly: the context mirror lags a just-finished stroke.
    const handle = canvasHandle.current;
    sentRevision.current = handle?.getRevision() ?? null;
    const image = await handle?.captureImage() ?? '';
    // The reply shows in the chat beside the board.
    leaveFullScreen();
    setTutorOpen(true);
    // A check-in starts with the tutor's first problem; after that, Ask tutor hands in an answer.
    const question = checkIn ? (checkInStarted(chatHistory) ? 'Here is my answer.' : 'Start the check-in.') : undefined;
    await sendHelp(image, question);
  }, [sendHelp, leaveFullScreen, checkIn, chatHistory]);

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
      {!fullScreen && <TopBar
        onNew={handleNew}
        saveStatus={saveStatus}
        onSave={saveNow}
        isStreaming={isStreaming}
      />}

      <BoardFrame
        fullScreen={fullScreen}
        source={checkIn
          ? { label: 'Check-in', content: <CheckInHeader checkIn={checkIn} started={checkInStarted(chatHistory)} /> }
          : sessionType === 'note'
          ? { label: 'Topic', content: <NoteHeader /> }
          : {
              label: 'Problem',
              content: (
                <ProblemStatement
                  onCaptureProblemImage={handleSetProblemImage}
                  onPutOnBoard={(image) => void canvasHandle.current?.placeProblemImage(image)}
                />
              ),
            }}
        title={(
          <>
            <p className="flex items-center gap-1 text-xs text-gray-600"><KindIcon type={sessionType} />{checkIn ? 'Check-in' : sessionType === 'note' ? 'Notes' : 'Problem'}</p>
            <h1 className="font-semibold text-gray-900 truncate">{checkIn ? checkInTitle(checkIn) : problemStatement.split('\n')[0].trim() || (sessionType === 'note' ? 'New notes' : 'New problem')}</h1>
          </>
        )}
        canvas={<DrawingCanvas handleRef={canvasHandle} toolsHidden={toolsHidden} />}
        toolbar={(
          <BottomToolbar
            onAskForHelp={handleAskForHelp}
            onClear={() => canvasHandle.current?.clear()}
            isStreaming={isStreaming}
            isSolved={isSolved}
            onToggleSolved={() => sessionDispatch({ type: 'TOGGLE_SOLVED' })}
            sessionType={sessionType}
            fullScreen={{ on: fullScreen, toggle: toggleFullScreen }}
            tools={{ hidden: toolsHidden, toggle: toggleTools }}
            tutor={{ open: tutorOpen, toggle: () => setTutorOpen((open) => !open) }}
            onSaveAs={(format) => void saveBoardAs(canvasHandle.current, format, boardTitle)}
            onWriteUp={() => setWriteUpOpen(true)}
          />
        )}
        tutor={{ open: tutorOpen, onClose: () => setTutorOpen(false), content: <ChatPanel getCanvasImage={getFollowUpImage} /> }}
      />

      {writeUpOpen && (
        <WriteUpPanel
          onClose={() => setWriteUpOpen(false)}
          title={boardTitle}
          writeUp={writeUp.writeUp}
          draft={writeUp.draft}
          error={writeUp.error}
          tutorBusy={writeUp.tutorBusy}
          onEdit={writeUp.edit}
          onConvert={() => void canvasHandle.current?.captureImage().then(writeUp.convert)}
        />
      )}
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
