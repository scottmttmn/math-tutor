'use client';

import { useCanvasState } from '@/context/CanvasContext';
import { deviceToggle } from '@/hooks/useDeviceToggle';

/** Board → Ink board for new boards (experiment), remembered on this device. */
export const useInkBoardMode = deviceToggle('math-tutor:inkBoard');

/** Whether the open board is (or, while empty, will be) an ink board rather than a tldraw one. */
export function useOnInkBoard(): boolean {
  const { editor } = useCanvasState();
  const [inkForNew] = useInkBoardMode();
  return editor === 'ink' || (editor === 'new' && inkForNew);
}
