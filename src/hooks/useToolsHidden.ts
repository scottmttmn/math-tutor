'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Remembered on this device for every board.
const TOOLS_HIDDEN_KEY = 'math-tutor:toolsHidden';
const listeners = new Set<() => void>();

function readHidden(): boolean {
  try { return localStorage.getItem(TOOLS_HIDDEN_KEY) === '1'; } catch { return false; }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Hides tldraw's toolbars and style panel so writing gets the whole board; the pen stays in hand. */
export function useToolsHidden() {
  // The server render shows the tools; the stored choice applies once in the browser.
  const toolsHidden = useSyncExternalStore(subscribe, readHidden, () => false);

  const toggleTools = useCallback(() => {
    try { localStorage.setItem(TOOLS_HIDDEN_KEY, readHidden() ? '0' : '1'); } catch { /* storage blocked */ }
    listeners.forEach((listener) => listener());
  }, []);

  return { toolsHidden, toggleTools };
}
