'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Full screen for a board: the page hides everything but the board and asks the browser for full
 * screen too (hiding its own bars on a tablet). Leaving the browser's full screen (Esc) leaves both.
 */
export function useBoardFullScreen() {
  const [fullScreen, setFullScreen] = useState(false);

  const leave = useCallback(() => {
    setFullScreen(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const enter = useCallback(() => {
    setFullScreen(true);
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);

  const toggle = useCallback(() => { if (fullScreen) leave(); else enter(); }, [fullScreen, enter, leave]);

  useEffect(() => {
    const onChange = () => { if (!document.fullscreenElement) setFullScreen(false); };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // Leaving the page must not leave the browser in full screen.
  useEffect(() => () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  return { fullScreen, toggle, leave };
}
