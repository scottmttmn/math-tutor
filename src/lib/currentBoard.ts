// The free board /board opens: the one last worked on, or one picked on Home or made on the Shelf.
export const CURRENT_SESSION_KEY = 'math-tutor:currentSession';

/** Sets (or, with null, clears) the session /board opens next. */
export function setBoardToOpen(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_SESSION_KEY, id);
    else localStorage.removeItem(CURRENT_SESSION_KEY);
  } catch { /* Reopening the last session is a convenience. */ }
}

/** The session /board opens next, if any. */
export function boardToOpen(): string | null {
  try { return localStorage.getItem(CURRENT_SESSION_KEY); } catch { return null; }
}
