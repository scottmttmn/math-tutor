'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import BookPage from '@/components/book/BookPage';

// Keyed by the book, so going from one book's page to another's (Add a PDF, Back) starts afresh.
function BookRoute() {
  const doc = useSearchParams().get('doc') ?? '';
  return <BookPage key={doc} doc={doc} />;
}

export default function Book() {
  return (
    <Suspense>
      <BookRoute />
    </Suspense>
  );
}
