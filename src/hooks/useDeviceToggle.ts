'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

/**
 * An on/off choice remembered on this device under `key` in localStorage, shared by every
 * component using it, `defaultOn` until chosen. Storage is read after mount, so the server render and
 * first paint show the default.
 */
export function deviceToggle(key: string, defaultOn = false) {
  const listeners = new Set<() => void>();
  let current = defaultOn;

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  const publish = (value: boolean) => {
    current = value;
    listeners.forEach((listener) => listener());
  };
  const snapshot = () => current;

  return function useDeviceToggle(): [boolean, () => void] {
    const on = useSyncExternalStore(subscribe, snapshot, () => defaultOn);
    useEffect(() => {
      const refresh = () => {
        try { const stored = localStorage.getItem(key); publish(stored === null ? defaultOn : stored === '1'); } catch { /* keep this visit's choice */ }
      };
      refresh();
      window.addEventListener('storage', refresh);
      return () => window.removeEventListener('storage', refresh);
    }, []);
    const toggle = useCallback(() => {
      const next = !current;
      try { localStorage.setItem(key, next ? '1' : '0'); } catch { /* works for this visit */ }
      publish(next);
    }, []);
    return [on, toggle];
  };
}
