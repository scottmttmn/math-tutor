'use client';

import { useEffect, useRef } from 'react';

/** Shows an image Blob (a thumbnail or cover saved in IndexedDB). */
export default function BlobImage({ blob, className }: { blob: Blob; className?: string }) {
  const image = useRef<HTMLImageElement>(null);
  // The object URL lives exactly as long as this element shows this blob.
  useEffect(() => {
    if (!image.current) return;
    const url = URL.createObjectURL(blob);
    image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimizable asset
  return <img ref={image} alt="" className={className} />;
}
