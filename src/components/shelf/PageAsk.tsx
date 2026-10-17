'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SessionProvider, useSessionDispatch, useSessionState } from '@/context/SessionContext';
import { useTutorChat } from '@/hooks/useTutorChat';
import { getTutorWaitMs } from '@/hooks/useRateLimit';
import { cropPage } from '@/lib/pdf';
import ChatMessage from '@/components/chat/ChatMessage';
import ChatInput from '@/components/chat/ChatInput';
import { TutorIcon } from '@/components/common/Icons';
import type { ChatMessage as Message, PageRect } from '@/types';

interface Props {
  pdf: PDFDocumentProxy;
  /** What the box is in, for the tutor: the book's title and the page's printed number. */
  where: string;
  page: number;
  rect: PageRect;
  question: string;
  onClose: () => void;
  /** Keeps the conversation as a note page on the boxed region. */
  onSave: (chat: Message[]) => Promise<void>;
}

/**
 * Asking about part of a page: a conversation of its own (its own session state, never saved) about
 * the boxed region, which the tutor gets as the figure and explains directly, as on a note page.
 * It goes when closed, unless saved as a note page.
 */
export default function PageAsk(props: Props) {
  return (
    <SessionProvider>
      <Conversation {...props} />
    </SessionProvider>
  );
}

function Conversation({ pdf, where, page, rect, question, onClose, onSave }: Props) {
  const dispatch = useSessionDispatch();
  const { chatHistory, isStreaming, problemImage } = useSessionState();
  const { sendHelp } = useTutorChat();
  const send = useRef(sendHelp);
  useEffect(() => { send.current = sendHelp; }, [sendHelp]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  // Crop the box, then ask, waiting out the tutor's five-second spacing if a request just went.
  useEffect(() => {
    let active = true;
    void cropPage(pdf, page, rect).then((image) => {
      if (!active) return;
      dispatch({ type: 'LOAD_SESSION', sessionId: 'page-ask', problemStatement: where, chatHistory: [], problemImage: image, sessionType: 'note' });
    }, () => { if (active) setError('That part of the page could not be read. Close and try again.'); });
    return () => { active = false; };
  }, [pdf, page, rect, where, dispatch]);

  useEffect(() => {
    if (!problemImage || asked.current) return;
    const timer = setTimeout(() => {
      asked.current = true;
      void send.current({ canvasImage: '' }, question).then((sent) => { if (!sent) setError('The tutor is busy. Ask again below in a moment.'); });
    }, getTutorWaitMs());
    return () => clearTimeout(timer);
  }, [problemImage, question]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [chatHistory]);

  const save = async () => {
    setSaving(true);
    try { await onSave(chatHistory); } finally { setSaving(false); }
  };

  return (
    <section aria-label="Tutor" className="flex flex-col h-full min-h-0 bg-white border-t-2 lg:border-t-0 lg:border-l-2 border-indigo-700">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200">
        <h2 className="flex-1 flex items-center gap-1.5 font-semibold text-indigo-700"><TutorIcon />Tutor · about your box</h2>
        <button onClick={onClose} aria-label="Close tutor" className="min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg hover:bg-gray-50">Close</button>
      </div>
      <div ref={scrollRef} aria-busy={isStreaming} className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        {chatHistory.map((message) => <ChatMessage key={message.id} message={message} />)}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {!chatHistory.length && !error && <p className="text-sm text-gray-500">Reading the box…</p>}
      </div>
      <div className="flex items-center gap-2 px-3 pt-2">
        <p className="flex-1 text-xs text-gray-600">This goes when you close it, unless you save it.</p>
        <button onClick={() => void save()} disabled={isStreaming || saving || !chatHistory.length}
          className="min-h-11 px-3 text-sm border border-gray-900 rounded-lg hover:bg-gray-100 disabled:opacity-50">Save as note page</button>
      </div>
      <ChatInput />
    </section>
  );
}
