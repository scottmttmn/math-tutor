'use client';

import dynamic from 'next/dynamic';

// tldraw touches window/document on import, so it can't be server-rendered.
// `ssr: false` requires a client component parent, hence 'use client' above.
const TldrawSpike = dynamic(() => import('@/components/workspace/TldrawSpike'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm text-gray-500">Loading canvas…</div>,
});

export default function CanvasNextPage() {
  return <TldrawSpike />;
}
