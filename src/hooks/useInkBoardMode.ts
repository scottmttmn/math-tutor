'use client';

import { useCanvasState } from '@/context/CanvasContext';
import { useInkBoardMode } from '@/hooks/useInkBoardChoice';

export { useInkBoardMode, useScratchOutOff } from '@/hooks/useInkBoardChoice';

/** Whether the open board is (or, while empty, will be) an ink board rather than a tldraw one. */
export function useOnInkBoard(): boolean {
  const { editor } = useCanvasState();
  const [inkForNew] = useInkBoardMode();
  return editor === 'ink' || (editor === 'new' && inkForNew);
}
