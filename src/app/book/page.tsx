'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { loadShelfDocument } from '@/lib/db';
import { folderHref } from '@/lib/folders';
import { readerHref } from '@/components/shelf/BookCard';
import AppBar from '@/components/layout/AppBar';

// A book's page became its folder: an old link opens the folder the book is in, or the reader.
function BookRoute() {
  const doc = useSearchParams().get('doc') ?? '';
  const router = useRouter();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let active = true;
    loadShelfDocument(doc).then((book) => {
      if (!active) return;
      if (!book) setMissing(true);
      else router.replace(book.folderId ? folderHref(book.folderId) : readerHref(book.id));
    }, () => { if (active) setMissing(true); });
    return () => { active = false; };
  }, [doc, router]);
  if (!missing) return null;
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <AppBar place="book" />
      <p className="p-12 text-center text-sm text-gray-700">This text isn’t in your library. <Link href="/" className="text-gray-900 underline">Back to Home</Link></p>
    </div>
  );
}

export default function Book() {
  return (
    <Suspense>
      <BookRoute />
    </Suspense>
  );
}
