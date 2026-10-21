'use client';

import { deviceToggle } from '@/hooks/useDeviceToggle';

/** Board → Ink board for new boards (experiment), remembered on this device. */
export const useInkBoardMode = deviceToggle('math-tutor:inkBoard');
