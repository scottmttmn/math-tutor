'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadProfile, loadSession, updateProfile } from '@/lib/db';
import { emptyProfile, findFavorite, removeFavorite, setFavorite } from '@/lib/learnerProfile';
import type { FavoriteProblem, LearnerProfile } from '@/types';

/** What a board says about itself when it is starred. */
export interface FavoriteSubject {
  title: string;
  problem: string;
}

/**
 * Whether the open board is a favorite, and starring it. Favorites live in the tutor memory, changed
 * in one transaction each time so a reply's notes saved meanwhile are kept.
 */
export function useFavorite(sessionId: string | null, subject: FavoriteSubject) {
  // Kept with the board it belongs to, so a switched board never shows the last one's star.
  const [loaded, setLoaded] = useState<{ id: string; favorite: FavoriteProblem | null } | null>(null);
  const favorite = loaded && loaded.id === sessionId ? loaded.favorite : null;
  const [failed, setFailed] = useState(false);
  // One write at a time, so a reason typed right after starring isn't overwritten by the star.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const currentId = useRef(sessionId);
  useEffect(() => { currentId.current = sessionId; }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    loadProfile()
      .then((profile) => { if (active) setLoaded({ id: sessionId, favorite: findFavorite(profile, sessionId) ?? null }); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [sessionId]);

  const change = useCallback((apply: (profile: LearnerProfile, id: string, customTitle: string) => LearnerProfile) => {
    if (!sessionId) return Promise.resolve();
    setFailed(false);
    queue.current = queue.current.then(async () => {
      try {
        // A name given on Home isn't in the board's state, so read it from the saved board.
        const customTitle = (await loadSession(sessionId).catch(() => undefined))?.customTitle ?? '';
        const next = await updateProfile((saved) => apply(saved ?? emptyProfile(), sessionId, customTitle));
        setLoaded({ id: sessionId, favorite: findFavorite(next, sessionId) ?? null });
      } catch {
        if (currentId.current === sessionId) setFailed(true);
      }
    });
    return queue.current;
  }, [sessionId]);

  const { title, problem } = subject;
  /** Stars the board, or keeps its star with a new reason. */
  const star = useCallback((reason: string) => change((profile, id, customTitle) => setFavorite(profile, { id, title: customTitle || title, problem, reason })), [change, title, problem]);
  const unstar = useCallback(() => change((profile, id) => removeFavorite(profile, id)), [change]);

  return { favorite, star, unstar, failed };
}
