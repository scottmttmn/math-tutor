'use client';

import { useEffect, useState } from 'react';
import { booxPenAvailable } from '@/lib/booxPen';

/** Whether Onyx's pen SDK is here (the Android app on a BOOX); false until known. */
export function useBooxPenAvailable() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let live = true;
    void booxPenAvailable().then((onyx) => { if (live) setAvailable(onyx); });
    return () => { live = false; };
  }, []);
  return available;
}
