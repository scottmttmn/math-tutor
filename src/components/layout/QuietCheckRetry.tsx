'use client';

import { useEffect } from 'react';
import { readUnreadSolved } from '@/hooks/useQuietCheck';

/**
 * A while after the app starts, and whenever it comes back online, the tutor quietly reads the solved
 * problems not checked yet (marked solved offline, or before quiet checks), each once it has been idle a while.
 */
const START_DELAY_MS = 30_000;

export default function QuietCheckRetry() {
  useEffect(() => {
    const retry = () => { void readUnreadSolved(undefined, { waitForQuiet: true }).catch(() => undefined); };
    const timer = window.setTimeout(retry, START_DELAY_MS);
    window.addEventListener('online', retry);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', retry);
    };
  }, []);
  return null;
}
