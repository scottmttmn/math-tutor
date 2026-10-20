'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { CanvasProvider, useCanvasState } from '@/context/CanvasContext';
import { SessionProvider, useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { paperFor } from '@/lib/paper';
import { useTutorChat } from '@/hooks/useTutorChat';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { useSessionAutosave } from '@/hooks/useSessionAutosave';
import { useBoardFullScreen } from '@/hooks/useBoardFullScreen';
import { useToolsHidden } from '@/hooks/useToolsHidden';
import { useWriteUp } from '@/hooks/useWriteUp';
import { useTutorProblem } from '@/hooks/useTutorProblem';

import type { SessionType, TutorBoardImages, TutorProblem } from '@/types';
import TopBar from './TopBar';
import BottomToolbar from './BottomToolbar';
import FavoriteButton from './FavoriteButton';
import { useFavorite } from '@/hooks/useFavorite';
import ProblemStatement from '../workspace/ProblemStatement';
import NoteHeader from '../workspace/NoteHeader';
import CheckInHeader from '../workspace/CheckInHeader';
import TutorProblemHeader from '../workspace/TutorProblemHeader';
import { checkInStarted, checkInTitle } from '@/lib/checkIn';
import DrawingCanvas, { type DrawingCanvasHandle } from '../workspace/DrawingCanvas';
import ChatPanel from '../chat/ChatPanel';
import BoardFrame from './BoardFrame';
import WriteUpPanel from '../workspace/WriteUpPanel';
import { KindIcon } from '@/components/common/Icons';
import { saveBoardAs } from '@/lib/exportBoard';

function AppContent() {
  const canvasHandle = useRef<DrawingCanvasHandle>(null);
  const [captureError, setCaptureError] = useState('');
  const [tutorOpen, setTutorOpen] = useState(false);
  const [writeUpOpen, setWriteUpOpen] = useState(false);
  const { fullScreen, toggle: toggleFullScreen, leave: leaveFullScreen } = useBoardFullScreen();
  const { toolsHidden, toggleTools } = useToolsHidden();

  const { isStreaming, isSolved, sessionType, problemStatement, problemImage, checkIn, chatHistory, paper: chosenPaper, currentSessionId } = useSessionState();
  const paper = paperFor(chosenPaper, sessionType);
  const sessionDispatch = useSessionDispatch();
  const { sendHelp } = useTutorChat();
  const { status: saveStatus, saveNow, startNew } = useSessionAutosave(canvasHandle);
  const writeUp = useWriteUp();
  const made = useTutorProblem();
  const { hasContent } = useCanvasState();
  const { tutorProblem } = made;
  // A problem the tutor wrote is LaTeX; its board goes by the tutor's plain title.
  const problemTitle = tutorProblem?.title || problemStatement.split('\n')[0].trim();
  const boardTitle = checkIn ? checkInTitle(checkIn) : (tutorProblem?.title || problemStatement) || (sessionType === 'note' ? 'Notes' : 'Problem');
  // A board is starred once it is saved (has an id); the tutor reads its statement, or that it was a picture.
  const favorite = useFavorite(currentSessionId, {
    title: checkIn ? checkInTitle(checkIn) : problemTitle || 'Untitled problem',
    problem: problemStatement.trim() ? problemStatement : problemImage ? 'A problem given as a picture' : 'Written on the board',
  });

  // A new board opens with its tutor closed, so the problem or topic is in view.
  const { cancel: cancelWriteUp } = writeUp;
  const handleNew = useCallback((type: SessionType = 'problem', request?: TutorProblem) => {
    setCaptureError('');
    setTutorOpen(false);
    setWriteUpOpen(false);
    cancelWriteUp();
    void startNew(type, request ? { tutorProblem: request } : undefined);
  }, [startNew, cancelWriteUp]);

  // New from another page arrives as /board?new=problem|note, or new=tutor with what the problem
  // should be (topic, like, ask), and &folder=<id> from a folder's page; start it once, then drop it from the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get('new');
    if (type !== 'problem' && type !== 'note' && type !== 'tutor') return;
    window.history.replaceState(null, '', '/board');
    const request: TutorProblem | undefined = type === 'tutor' ? {
      topic: params.get('topic') ?? '',
      ...(params.get('like') ? { like: params.get('like')! } : {}),
      ...(params.get('ask') ? { ask: params.get('ask')! } : {}),
    } : undefined;
    void startNew(type === 'note' ? 'note' : 'problem', { folderId: params.get('folder') ?? undefined, tutorProblem: request });
  }, [startNew]);

  const handleAskForHelp = useCallback(async (picked?: string) => {
    if (getTutorWaitMs() > 0) return;
    // Read the editor directly: the context mirror lags a just-finished stroke.
    // The reply shows in the chat beside the board.
    leaveFullScreen();
    setTutorOpen(true);
    // A check-in starts with the tutor's first problem; after that, Ask tutor hands in an answer.
    const question = checkIn ? (checkInStarted(chatHistory) ? 'Here is my answer.' : 'Start the check-in.') : picked;
    setCaptureError('');
    try {
      if (!canvasHandle.current) throw new Error('The board is still loading. Please try again.');
      await sendHelp(await canvasHandle.current.captureForTutor(), question);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'The board image could not be captured. Please try again.');
    }
  }, [sendHelp, leaveFullScreen, checkIn, chatHistory]);

  const getBoardImages = useCallback(async (): Promise<TutorBoardImages> => {
    if (!canvasHandle.current) throw new Error('The board is still loading. Please try again.');
    return canvasHandle.current.captureForTutor();
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

      {captureError && <p role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50">{captureError}</p>}

      <BoardFrame
        fullScreen={fullScreen}
        source={checkIn
          ? { label: 'Check-in', content: <CheckInHeader checkIn={checkIn} started={checkInStarted(chatHistory)} onShowProblem={tutorOpen ? undefined : () => setTutorOpen(true)} /> }
          : sessionType === 'note'
          ? { label: 'Topic', content: <NoteHeader /> }
          : tutorProblem
          ? {
              label: 'Problem',
              content: (
                <TutorProblemHeader
                  tutorProblem={tutorProblem}
                  problem={problemStatement}
                  draft={made.draft}
                  error={made.error}
                  onRetry={() => void made.retry()}
                  // Only while nothing on the board or in the chat is about the problem shown.
                  onAnother={hasContent || chatHistory.length > 0 || isStreaming ? undefined : made.another}
                />
              ),
            }
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
            <h1 className="font-semibold text-gray-900 truncate">{checkIn ? checkInTitle(checkIn) : problemTitle || (sessionType === 'note' ? 'New notes' : 'New problem')}</h1>
          </>
        )}
        canvas={<DrawingCanvas handleRef={canvasHandle} toolsHidden={toolsHidden} onShowTools={toggleTools} paper={paper} />}
        toolbar={(
          <BottomToolbar
            onAskForHelp={(question) => void handleAskForHelp(question)}
            checkInLabel={checkIn ? (checkInStarted(chatHistory) ? 'Hand in answer' : 'Start check-in') : undefined}
            onClear={() => canvasHandle.current?.clear()}
            onFitWidth={() => canvasHandle.current?.fitWidth()}
            isStreaming={isStreaming}
            isSolved={isSolved}
            onToggleSolved={() => sessionDispatch({ type: 'TOGGLE_SOLVED' })}
            sessionType={sessionType}
            paper={{ value: paper, onChange: (next) => sessionDispatch({ type: 'SET_PAPER', paper: next }) }}
            fullScreen={{ on: fullScreen, toggle: toggleFullScreen }}
            tools={{ hidden: toolsHidden, toggle: toggleTools }}
            tutor={{ open: tutorOpen, toggle: () => setTutorOpen((open) => !open) }}
            onSaveAs={(format) => void saveBoardAs(canvasHandle.current, format, boardTitle)}
            onWriteUp={() => setWriteUpOpen(true)}
            favorite={checkIn ? undefined : (
              <FavoriteButton favorite={favorite.favorite} disabled={!currentSessionId} failed={favorite.failed}
                onStar={(reason) => void favorite.star(reason)} onUnstar={() => void favorite.unstar()} />
            )}
          />
        )}
        tutor={{ open: tutorOpen, onClose: () => setTutorOpen(false), content: <ChatPanel visible={tutorOpen && !fullScreen} getBoardImages={getBoardImages} onAskForHelp={handleAskForHelp} /> }}
      />

      {writeUpOpen && (
        <WriteUpPanel
          // Closing stops a write-up in progress, so it can't hold up the tutor unseen.
          onClose={() => { writeUp.cancel(); setWriteUpOpen(false); }}
          title={boardTitle}
          writeUp={writeUp.writeUp}
          draft={writeUp.draft}
          error={writeUp.error}
          tutorBusy={writeUp.tutorBusy}
          onEdit={writeUp.edit}
          onConvert={() => void writeUp.convert(async () => await canvasHandle.current?.captureImage() ?? '')}
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
