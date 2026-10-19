'use client';

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'math-tutor:notebookMode';
const listeners = new Set<() => void>();
let fallback = false;

function read(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return fallback; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

/** A reversible experiment, remembered on this device for free and Shelf boards. */
export function useNotebookMode() {
  const notebook = useSyncExternalStore(subscribe, read, () => false);
  const toggleNotebook = useCallback(() => {
    fallback = !read();
    try { localStorage.setItem(KEY, fallback ? '1' : '0'); } catch { /* works for this visit */ }
    listeners.forEach((listener) => listener());
  }, []);
  return { notebook, toggleNotebook };
}
