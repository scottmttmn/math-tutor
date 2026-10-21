'use client';

import { useEffect } from 'react';
import type { Editor } from 'tldraw';
import { useBooxPenAvailable } from '@/hooks/useBooxPen';
import { BooxPen } from '@/lib/booxPen';

const SETTLE_MS = 180;

/** Immediate camera moves and transient fast panel updates while the board is manipulated. */
export function useBooxBoard(editor: Editor | null) {
  const available = useBooxPenAvailable();

  useEffect(() => {
    if (!editor || !available) return;
    editor.user.updateUserPreferences({ animationSpeed: 0 });
    const root = editor.getContainer();
    const contacts = new Set<number>();
    let active = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCanvas = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.tl-canvas'));
    const begin = () => {
      clearTimeout(timer);
      if (active) return;
      active = true;
      void BooxPen.interaction({ active: true }).catch(() => undefined);
    };
    const end = () => {
      clearTimeout(timer);
      if (!active) return;
      active = false;
      void BooxPen.interaction({ active: false }).catch(() => undefined);
    };
    const settle = () => {
      clearTimeout(timer);
      if (contacts.size === 0) timer = setTimeout(end, SETTLE_MS);
    };
    const down = (event: PointerEvent) => {
      if (!onCanvas(event.target)) return;
      // Native handwriting keeps its own immediate rendering; fingers can still pan that board.
      if (event.pointerType !== 'touch' && editor.getCurrentToolId() === 'draw') return;
      contacts.add(event.pointerId);
      begin();
    };
    const up = (event: PointerEvent) => {
      if (!contacts.delete(event.pointerId)) return;
      settle();
    };
    const hover = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons !== 0 || editor.getCurrentToolId() === 'draw' || !onCanvas(event.target)) return;
      begin();
      settle();
    };
    const wheel = (event: WheelEvent) => {
      if (!onCanvas(event.target)) return;
      begin();
      settle();
    };
    const cancel = () => { contacts.clear(); end(); };
    const hidden = () => { if (document.hidden) cancel(); };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('pointermove', hover, true);
    root.addEventListener('wheel', wheel, { capture: true, passive: true });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    // A camera may continue moving after the last contact; repaint only after it settles.
    const stop = editor.store.listen(({ changes }) => {
      if (active && Object.values(changes.updated).some(([, record]) => record.typeName === 'camera')) settle();
    });
    return () => {
      cancel();
      stop();
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('pointermove', hover, true);
      root.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [editor, available]);
}
