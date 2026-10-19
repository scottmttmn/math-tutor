'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

const KEY = 'math-tutor:notebookMode';
const listeners = new Set<() => void>();
let current = false;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(value: boolean) {
  current = value;
  listeners.forEach((listener) => listener());
}

const snapshot = () => current;

/** A reversible experiment, remembered on this device for free and Shelf boards. */
export function useNotebookMode() {
  const notebook = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => {
    const refresh = () => {
      try { publish(localStorage.getItem(KEY) === '1'); } catch { /* keep this visit's choice */ }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  const toggleNotebook = useCallback(() => {
    const next = !current;
    try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* works for this visit */ }
    publish(next);
  }, []);
  return { notebook, toggleNotebook };
}
