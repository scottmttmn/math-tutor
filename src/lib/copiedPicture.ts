import { getSetting, setSetting } from '@/lib/db';
import type { CopiedPicture } from '@/types';

// Part of a PDF page, or a board's ink, copied to paste on a board. It is kept in IndexedDB, since the
// board may be on another page (the Android app loads /board in full). A picture lasts until it is
// pasted; ink until something else is copied, as on any clipboard.

const KEY = 'copiedPicture';
const EVENT = 'math-tutor:copied-picture';

export async function loadCopiedPicture(): Promise<CopiedPicture | null> {
  return (await getSetting<CopiedPicture>(KEY)) ?? null;
}

/** Keeps a copy (replacing the last), and puts it on the system clipboard too where the browser allows it. */
export async function copyPicture(picture: CopiedPicture): Promise<void> {
  await setSetting(KEY, picture);
  window.dispatchEvent(new Event(EVENT));
  if (!picture.png) return;
  try {
    const blob = await (await fetch(`data:image/png;base64,${picture.png}`)).blob();
    await navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]);
  } catch {
    // The app's own copy is enough: Paste in the board's rail uses it.
  }
}

export async function clearCopiedPicture(): Promise<void> {
  await setSetting(KEY, undefined);
  window.dispatchEvent(new Event(EVENT));
}

/** Calls `listener` whenever a copy is made or used up. */
export function onCopiedPicture(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
