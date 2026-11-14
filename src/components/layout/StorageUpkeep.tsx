'use client';

import { useEffect } from 'react';
import { movePicturesApart } from '@/lib/db';

// Shortly after the app starts, so the page's own loading comes first.
const START_AFTER_MS = 3000;

/** Housekeeping of saved work that runs once per start, on every page (root layout). */
export default function StorageUpkeep() {
  useEffect(() => {
    const timer = setTimeout(() => { void movePicturesApart(); }, START_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
