'use client';

import { useCallback, useState } from 'react';
import { addToShelf } from '@/lib/shelf';
import type { ShelfDocument } from '@/types';

/** Adds PDFs to the library one by one (each in a folder of its own, inside `parentId`), saying which is being read and which could not be. */
export function useAddPdfs() {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const add = useCallback(async (files: File[], parentId: string | null = null): Promise<ShelfDocument[]> => {
    setError('');
    const added: ShelfDocument[] = [];
    const failed: string[] = [];
    for (const file of files) {
      setBusy(`Adding ${file.name}…`);
      try { added.push(await addToShelf(file, parentId)); } catch { failed.push(file.name); }
    }
    setBusy('');
    if (failed.length) setError(`${failed.join(', ')} could not be read as a PDF.`);
    return added;
  }, []);

  return { add, busy, error, clearError: useCallback(() => setError(''), []) };
}
