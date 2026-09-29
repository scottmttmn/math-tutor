'use client';

import { useState, useEffect, useCallback } from 'react';
import { RATE_LIMIT_MS } from '@/lib/constants';

const STORAGE_KEY = 'lastHelpTimestamp';
let lastUsageInMemory = 0;

export function getTutorWaitMs(intervalMs = RATE_LIMIT_MS): number {
  let timestamp = lastUsageInMemory;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) timestamp = Math.max(timestamp, stored);
  } catch { /* The server still enforces the limit when storage is unavailable. */ }
  return timestamp ? Math.max(0, Math.min(intervalMs, intervalMs - (Date.now() - timestamp))) : 0;
}

export function recordTutorUsage(): void {
  lastUsageInMemory = Date.now();
  try { localStorage.setItem(STORAGE_KEY, lastUsageInMemory.toString()); } catch {}
  window.dispatchEvent(new Event('mathTutor:helpUsage'));
}

export function tryStartTutorRequest(): boolean {
  if (getTutorWaitMs() > 0) return false;
  recordTutorUsage();
  return true;
}

export function useRateLimit(intervalMs: number) {
  const [remainingMs, setRemainingMs] = useState(0);

  const calculateRemaining = useCallback(() => {
    return getTutorWaitMs(intervalMs);
  }, [intervalMs]);

  useEffect(() => {
    const update = () => setRemainingMs(calculateRemaining());
    window.addEventListener('mathTutor:helpUsage', update);
    window.addEventListener('storage', update);
    const initialTimer = setTimeout(() => setRemainingMs(calculateRemaining()), 0);

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingMs(remaining);
    }, 250);

    return () => {
      window.removeEventListener('mathTutor:helpUsage', update);
      window.removeEventListener('storage', update);
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [calculateRemaining]);

  const isLimited = remainingMs > 0;
  return { isLimited, remainingMs };
}
