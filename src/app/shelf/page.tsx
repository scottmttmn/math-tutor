'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// The Shelf's PDFs are on Home now, as books; an old link to the Shelf goes there.
export default function ShelfPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/'); }, [router]);
  return null;
}
