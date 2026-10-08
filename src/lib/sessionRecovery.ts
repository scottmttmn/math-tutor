import { loadSession, saveSession } from '@/lib/db';
import type { ChatMessage, Session } from '@/types';

const recoveryKey = (id: string) => `${id}:pendingSave`;

// The thumbnail is a Blob, which JSON can't hold; the next durable save captures a fresh one.
const serialize = (session: Session) => JSON.stringify(session.canvasImageBlob ? { ...session, canvasImageBlob: null } : session);

// A synchronous recovery copy covers reload/close during the IndexedDB debounce.
export function stageSession(session: Session) {
  const existing = localStorage.getItem(recoveryKey(session.id));
  if (existing) {
    try {
      if (JSON.parse(existing).updatedAt > session.updatedAt) return;
    } catch { /* Replace an invalid recovery record. */ }
  }
  localStorage.setItem(recoveryKey(session.id), serialize(session));
}

/** True when a session has unsaved changes kept only in its recovery copy. */
export function hasRecoveryCopy(id: string) {
  return localStorage.getItem(recoveryKey(id)) !== null;
}

export async function loadRecoveredSession(id: string): Promise<Session | undefined> {
  const saved = await loadSession(id);
  const pending = localStorage.getItem(recoveryKey(id));
  if (pending) {
    try {
      const recovery: Session = JSON.parse(pending);
      if (recovery.id === id && Array.isArray(recovery.canvasStrokes) && Array.isArray(recovery.chatHistory)
        && Number.isFinite(recovery.updatedAt) && (!saved || recovery.updatedAt >= saved.updatedAt)) {
        return saved?.canvasImageBlob ? { ...recovery, canvasImageBlob: saved.canvasImageBlob } : recovery;
      }
    } catch { /* Ignore an invalid recovery record; keep the durable session. */ }
  }
  return saved;
}

export async function saveRecoverableSession(session: Session) {
  try { stageSession(session); } catch { /* IndexedDB can still save if local storage is full. */ }
  await saveSession(session);
  try {
    const pending = localStorage.getItem(recoveryKey(session.id));
    // A later edit may have been staged while this transaction was running.
    if (pending === serialize(session)) localStorage.removeItem(recoveryKey(session.id));
  } catch { /* The IndexedDB transaction succeeded. */ }
}

/** A reply saved mid-stream can't resume after a reload; say so instead of showing it as still typing. */
export function settleInterruptedReplies(chatHistory: ChatMessage[]): ChatMessage[] {
  return chatHistory.map((message) => message.role === 'assistant' && (message.pending || !message.content.trim())
    ? { ...message, pending: false, content: `${message.content}\n\nThe tutor response was interrupted. Ask again to continue.` }
    : message);
}
