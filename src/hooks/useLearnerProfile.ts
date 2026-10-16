'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProfile, updateProfile } from '@/lib/db';
import { emptyProfile } from '@/lib/learnerProfile';
import type { AutosaveStatus, LearnerProfile } from '@/types';

// Typing in About you saves once the student pauses.
const SAVE_DELAY_MS = 500;

/** The tutor memory, loaded from IndexedDB and saved shortly after each change. */
export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [loadFailed, setLoadFailed] = useState(false);
  // Changes not yet saved, replayed onto the stored memory so a note or favorite saved meanwhile is kept.
  const pending = useRef<((current: LearnerProfile) => LearnerProfile)[]>([]);
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
    const changes = pending.current;
    if (!changes.length) return;
    pending.current = [];
    setStatus('saving');
    try {
      const saved = await updateProfile((stored) => changes.reduce((current, change) => change(current), stored ?? emptyProfile()));
      // Show what is stored, with anything typed since on top.
      setProfile(pending.current.reduce((current, change) => change(current), saved));
      setStatus(pending.current.length ? 'saving' : 'saved');
    } catch {
      // Keep them pending so leaving the page tries again.
      pending.current = [...changes, ...pending.current];
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
    // Kept outside the state updater, which React may run twice.
    pending.current.push(change);
    setProfile((current) => (current ? change(current) : current));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
  }, [flush]);

  return { profile, update, status, loadFailed, saveNow: flush };
}
