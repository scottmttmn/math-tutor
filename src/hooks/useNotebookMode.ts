'use client';

import { deviceToggle } from '@/hooks/useDeviceToggle';

const useNotebookToggle = deviceToggle('math-tutor:notebookMode');

/** A reversible experiment, remembered on this device for free and Shelf boards. */
export function useNotebookMode() {
  const [notebook, toggleNotebook] = useNotebookToggle();
  return { notebook, toggleNotebook };
}
