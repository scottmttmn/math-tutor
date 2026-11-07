'use client';

import { deviceToggle } from '@/hooks/useDeviceToggle';

/**
 * Board → Ink board, remembered on this device and on until turned off: new boards are ink
 * boards and tldraw boards open converted. Off, boards are tldraw's as before (until tldraw goes).
 */
export const useInkBoardMode = deviceToggle('math-tutor:inkBoard', true);

/** Board → Scratch out to erase is on unless turned off on this device. */
export const useScratchOutOff = deviceToggle('math-tutor:scratchOutOff');
