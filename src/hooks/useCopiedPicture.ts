'use client';

import { useEffect, useState } from 'react';
import { loadCopiedPicture, onCopiedPicture } from '@/lib/copiedPicture';
import type { CopiedPicture } from '@/types';

/** The part of a PDF page waiting to be pasted on a board, or null. */
export function useCopiedPicture(): CopiedPicture | null {
  const [copied, setCopied] = useState<CopiedPicture | null>(null);
  useEffect(() => {
    let live = true;
    const read = () => { loadCopiedPicture().then((picture) => { if (live) setCopied(picture); }).catch(() => {}); };
    read();
    const stop = onCopiedPicture(read);
    return () => { live = false; stop(); };
  }, []);
  return copied;
}
