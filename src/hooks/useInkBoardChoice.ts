'use client';

import { deviceToggle } from '@/hooks/useDeviceToggle';

/** Board → Scratch out to erase is on unless turned off on this device. */
export const useScratchOutOff = deviceToggle('math-tutor:scratchOutOff');
