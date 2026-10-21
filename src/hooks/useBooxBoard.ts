'use client';

import { useEffect } from 'react';
import { useValue, type Editor } from 'tldraw';
import { useBooxPenAvailable } from '@/hooks/useBooxPen';
import { BooxPen } from '@/lib/booxPen';

const SETTLE_MS = 180;

/** Editing tools keep fast panel updates; the pen keeps native ink and finger pan/zoom. */
export function useBooxBoard(editor: Editor | null) {
  const available = useBooxPenAvailable();
  const drawing = useValue('BOOX board tool', () => editor?.getCurrentToolId() === 'draw', [editor]);

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
      if (!drawing || !onCanvas(event.target)) return;
      // Native handwriting keeps its own immediate rendering; fingers can still pan that board.
      if (event.pointerType !== 'touch') return;
      contacts.add(event.pointerId);
      begin();
    };
    const up = (event: PointerEvent) => {
      if (!contacts.delete(event.pointerId)) return;
      settle();
    };
    const wheel = (event: WheelEvent) => {
      if (!drawing || !onCanvas(event.target)) return;
      begin();
      settle();
    };
    const cancel = () => { contacts.clear(); end(); };
    const visible = () => {
      const box = root.getBoundingClientRect();
      return !document.hidden && box.width > 0 && box.height > 0;
    };
    const focus = () => {
      if (!visible()) { cancel(); return; }
      // Native onPause releases the panel even if the WebView missed its blur event.
      if (!drawing) { active = false; begin(); }
    };
    const hidden = () => { if (document.hidden) cancel(); else focus(); };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('wheel', wheel, { capture: true, passive: true });
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', hidden);
    // A camera may continue moving after the last contact; keep fast mode until it settles.
    const stop = editor.store.listen(({ changes }) => {
      if (drawing && active && Object.values(changes.updated).some(([, record]) => record.typeName === 'camera')) settle();
    });
    const resize = new ResizeObserver(() => {
      if (!visible()) cancel();
      else if (!drawing && !active) begin();
    });
    resize.observe(root);
    if (!drawing && visible()) begin();
    return () => {
      cancel();
      stop();
      resize.disconnect();
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('wheel', wheel, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [editor, available, drawing]);
}
