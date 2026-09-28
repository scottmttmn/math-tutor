'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'lastHelpTimestamp';

export function useRateLimit(intervalMs: number) {
  const [remainingMs, setRemainingMs] = useState(0);

  const calculateRemaining = useCallback(() => {
    const lastUsage = localStorage.getItem(STORAGE_KEY);
    if (!lastUsage) return 0;
    const timestamp = Number(lastUsage);
    if (!Number.isFinite(timestamp)) return 0;
    const elapsed = Date.now() - timestamp;
    return Math.max(0, intervalMs - elapsed);
  }, [intervalMs]);

  useEffect(() => {
    const update = () => setRemainingMs(calculateRemaining());
    window.addEventListener('mathTutor:helpUsage', update);
    window.addEventListener('storage', update);
    const initialTimer = setTimeout(() => setRemainingMs(calculateRemaining()), 0);

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingMs(remaining);
    }, 1000);

    return () => {
      window.removeEventListener('mathTutor:helpUsage', update);
      window.removeEventListener('storage', update);
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [calculateRemaining]);

  const recordUsage = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setRemainingMs(intervalMs);
    window.dispatchEvent(new Event('mathTutor:helpUsage'));
  }, [intervalMs]);

  const isLimited = remainingMs > 0;

  const formatRemaining = useCallback(() => {
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, [remainingMs]);

  return { isLimited, remainingMs, recordUsage, formatRemaining };
}
