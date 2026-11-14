import { loadSession, saveSession } from '@/lib/db';
import type { BoardInk, ChatMessage, Session } from '@/types';

const recoveryKey = (id: string) => `${id}:pendingSave`;

// When each copy staged in this run was made, so a save can tell whether a newer one is waiting
// without reading it back (a board's copy can be megabytes).
const stagedAt = new Map<string, number>();

/**
 * The session as its recovery copy holds it. The thumbnail is a Blob, which JSON can't hold; the
 * next durable save captures a fresh one. Pictures the last durable save already holds (`saved`)
 * go without their data and are taken from that save when the copy is read: a board's pictures are
 * most of its size, and local storage is small and kept in memory.
 */
function serialize(session: Session, saved?: BoardInk | null) {
  const kept = new Map(saved?.images.map((image) => [image.id, image.src]));
  const ink = session.ink && session.ink.images.some((image) => kept.get(image.id) === image.src)
    ? { ...session.ink, images: session.ink.images.map((image) => (kept.get(image.id) === image.src ? { ...image, src: '' } : image)) }
    : session.ink;
  return JSON.stringify({ ...session, canvasImageBlob: null, ...(session.ink ? { ink } : {}) });
}

/** A recovery copy's pictures filled in from the durable save; one that save doesn't hold is left out. */
function withSavedPictures(recovery: Session, saved: Session | undefined): Session {
  if (!recovery.ink?.images?.some((image) => !image.src)) return recovery;
  const kept = new Map(saved?.ink?.images.map((image) => [image.id, image.src]));
  const images = recovery.ink.images.flatMap((image) => {
    if (image.src) return [image];
    const src = kept.get(image.id);
    return src ? [{ ...image, src }] : [];
  });
  return { ...recovery, ink: { ...recovery.ink, images } };
}

/**
 * A synchronous recovery copy covers a reload or close before IndexedDB has the latest work.
 * `saved` is the drawing as last saved durably, whose pictures the copy can leave out.
 */
export function stageSession(session: Session, saved?: BoardInk | null) {
  const key = recoveryKey(session.id);
  const known = stagedAt.get(session.id);
  if (known !== undefined) {
    if (known > session.updatedAt) return;
  } else {
    const existing = localStorage.getItem(key);
    if (existing) {
      try {
        if (JSON.parse(existing).updatedAt > session.updatedAt) return;
      } catch { /* Replace an invalid recovery record. */ }
    }
  }
  localStorage.setItem(key, serialize(session, saved));
  stagedAt.set(session.id, session.updatedAt);
}

/** True when a session has unsaved changes kept only in its recovery copy. */
export function hasRecoveryCopy(id: string) {
  return localStorage.getItem(recoveryKey(id)) !== null;
}

/** Drops a session's recovery copy, so a deleted session can't come back from it. */
export function discardRecoveryCopy(id: string) {
  stagedAt.delete(id);
  try { localStorage.removeItem(recoveryKey(id)); } catch { /* Nothing to discard. */ }
}

export async function loadRecoveredSession(id: string): Promise<Session | undefined> {
  const saved = await loadSession(id);
  const pending = localStorage.getItem(recoveryKey(id));
  if (pending) {
    try {
      const recovery: Session = JSON.parse(pending);
      if (recovery.id === id && Array.isArray(recovery.canvasStrokes) && Array.isArray(recovery.chatHistory)
        && Number.isFinite(recovery.updatedAt) && (!saved || recovery.updatedAt >= saved.updatedAt)) {
        const whole = withSavedPictures(recovery, saved);
        return saved?.canvasImageBlob ? { ...whole, canvasImageBlob: saved.canvasImageBlob } : whole;
      }
    } catch { /* Ignore an invalid recovery record; keep the durable session. */ }
  }
  return saved;
}

/**
 * Saves durably. The save itself is the protection, so no copy is staged first (staging every
 * save copied the whole board, pictures included, several times over); a save that fails leaves a
 * recovery copy instead. `saved` is the drawing as last saved durably (see stageSession).
 */
export async function saveRecoverableSession(session: Session, saved?: BoardInk | null) {
  try {
    await saveSession(session);
  } catch (error) {
    try { stageSession(session, saved); } catch { /* Local storage is full too; the caller reports the failed save. */ }
    throw error;
  }
  try {
    // A copy from an earlier run is older than this save; one staged in this run may be newer (an
    // edit staged while the transaction was running).
    const staged = stagedAt.get(session.id);
    if (staged === undefined || staged <= session.updatedAt) {
      localStorage.removeItem(recoveryKey(session.id));
      stagedAt.delete(session.id);
    }
  } catch { /* The IndexedDB transaction succeeded. */ }
}

/** A reply saved mid-stream can't resume after a reload; say so instead of showing it as still typing. */
export function settleInterruptedReplies(chatHistory: ChatMessage[]): ChatMessage[] {
  return chatHistory.map((message) => message.role === 'assistant' && (message.pending || !message.content.trim())
    ? { ...message, pending: false, content: `${message.content}\n\nThe tutor response was interrupted. Ask again to continue.` }
    : message);
}
