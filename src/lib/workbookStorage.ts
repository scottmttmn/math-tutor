import { loadSession, saveSession } from '@/lib/db';
import type { Session } from '@/types';

const recoveryKey = (id: string) => `${id}:pendingSave`;

// A synchronous recovery copy covers reload/close during the IndexedDB debounce.
export function stageWorkbookSession(session: Session) {
  const existing = localStorage.getItem(recoveryKey(session.id));
  if (existing) {
    try {
      if (JSON.parse(existing).updatedAt > session.updatedAt) return;
    } catch { /* Replace an invalid recovery record. */ }
  }
  localStorage.setItem(recoveryKey(session.id), JSON.stringify(session));
}

export async function loadWorkbookSession(id: string): Promise<Session | undefined> {
  const saved = await loadSession(id);
  const pending = localStorage.getItem(recoveryKey(id));
  if (pending) {
    try {
      const recovery: Session = JSON.parse(pending);
      if (recovery.id === id && Array.isArray(recovery.canvasStrokes) && Array.isArray(recovery.chatHistory)
        && Number.isFinite(recovery.updatedAt) && (!saved || recovery.updatedAt >= saved.updatedAt)) {
        return recovery;
      }
    } catch { /* Ignore an invalid recovery record; keep the durable session. */ }
  }
  return saved;
}

export async function saveWorkbookSession(session: Session) {
  try { stageWorkbookSession(session); } catch { /* IndexedDB can still save if local storage is full. */ }
  await saveSession(session);
  try {
    const pending = localStorage.getItem(recoveryKey(session.id));
    // A later edit may have been staged while this transaction was running.
    if (pending === JSON.stringify(session)) localStorage.removeItem(recoveryKey(session.id));
  } catch { /* The IndexedDB transaction succeeded. */ }
}
