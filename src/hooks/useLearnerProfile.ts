'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProfile, saveProfile } from '@/lib/db';
import { emptyProfile } from '@/lib/learnerProfile';
import type { AutosaveStatus, LearnerProfile } from '@/types';

// Typing in About you saves once the student pauses.
const SAVE_DELAY_MS = 500;

/** The tutor memory, loaded from IndexedDB and saved shortly after each change. */
export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [loadFailed, setLoadFailed] = useState(false);
  const pending = useRef<LearnerProfile | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    loadProfile()
      .then((stored) => { if (active) setProfile(stored ?? emptyProfile()); })
      .catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, []);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setStatus('saving');
    try {
      await saveProfile(next);
      setStatus(pending.current ? 'saving' : 'saved');
    } catch {
      // Keep it pending so leaving the page tries again.
      pending.current ??= next;
      setStatus('error');
    }
  }, []);

  // Leaving or hiding the page writes what is waiting.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      void flush();
    };
  }, [flush]);

  /** Applies a change and saves it after a short pause. */
  const update = useCallback((change: (current: LearnerProfile) => LearnerProfile) => {
    setProfile((current) => {
      if (!current) return current;
      const next = change(current);
      if (next === current) return current;
      pending.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
      return next;
    });
  }, [flush]);

  return { profile, update, status, loadFailed, saveNow: flush };
}
