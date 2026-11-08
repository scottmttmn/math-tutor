'use client';

import { useEffect } from 'react';
import { installErrorLog } from '@/lib/errorLog';

/** Starts the device's error log (Settings → Errors) on every page. */
export default function ErrorRecorder() {
  useEffect(() => installErrorLog(), []);
  return null;
}
