'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Home from '@/components/home/Home';

// Keyed by the folder, so going from one folder to another (or Back) starts afresh.
function FolderRoute() {
  const id = useSearchParams().get('id') ?? '';
  return <Home key={id} folderId={id} />;
}

export default function FolderPage() {
  return (
    <Suspense>
      <FolderRoute />
    </Suspense>
  );
}
