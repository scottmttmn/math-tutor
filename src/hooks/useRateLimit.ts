'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'lastHelpTimestamp';

export function useRateLimit(intervalMs: number) {
  const [remainingMs, setRemainingMs] = useState(0);

  const calculateRemaining = useCallback(() => {
    const lastUsage = localStorage.getItem(STORAGE_KEY);
    if (!lastUsage) return 0;
    const elapsed = Date.now() - parseInt(lastUsage, 10);
    return Math.max(0, intervalMs - elapsed);
  }, [intervalMs]);

  useEffect(() => {
    setRemainingMs(calculateRemaining());

    const timer = setInterval(() => {
      const remaining = calculateRemaining();
      setRemainingMs(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateRemaining]);

  const recordUsage = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, Date.now().toString());
    setRemainingMs(intervalMs);
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
