'use client';

import { useEffect } from 'react';
import { booxPenAvailable } from '@/lib/booxPen';

/** Enlarge the app's rem-based UI on BOOX without scaling canvas coordinates or saved ink. */
export default function DeviceAppearance() {
  useEffect(() => {
    let live = true;
    void booxPenAvailable().then((onyx) => {
      if (live && onyx) document.documentElement.dataset.booxUi = 'true';
    });
    return () => {
      live = false;
      delete document.documentElement.dataset.booxUi;
    };
  }, []);
  return null;
}
