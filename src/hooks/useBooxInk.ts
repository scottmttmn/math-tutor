'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useBooxPenAvailable } from '@/hooks/useBooxPen';
import { BooxPen, boxOf, overlaps } from '@/lib/booxPen';
import type { BooxPenBox } from '@/types';

// After the board's picture changes (a stroke, an undo, a scroll), the screen is let through this long after.
const REFRESH_DELAY_MS = 300;
// Finger and wheel gestures keep the panel's fast mode until they have rested this long.
const SETTLE_MS = 180;
// The board's own controls over the canvas, which the pen must still be able to tap.
const CONTROLS = '[role="toolbar"] > *, [data-testid="show-tools"]';
// Anything that, while open, sits over the board and takes the pen: menus, dialogs, popovers.
const OVERLAYS = '[role="menu"], [role="dialog"], [role="listbox"]';

export interface BooxInkOptions {
  /** The board's element: the region is its box less the controls over it. */
  container: RefObject<HTMLElement | null>;
  /** Whether the SDK takes the pen (the Pen or Highlight tool). The eraser is the page's, with fast screen updates. */
  sdk: boolean;
  /** The live preview's width (CSS px at the current zoom), color, and a marker's flat tip for the highlighter. */
  preview: { width: number; color: string; marker: boolean };
  /** A finished stroke from the SDK, flat [x, y, pressure, ms, …] in CSS px of the window. */
  onStroke: (flat: number[]) => void;
  /** The pen's eraser end passed along this path (same form). */
  onErase: (flat: number[]) => void;
}

export interface BooxInk {
  /** Whether the SDK has the pen now, so the page must not draw pen events itself. */
  owns: () => boolean;
  /** The board was redrawn; the screen is let through once the pen rests. */
  painted: () => void;
  /** A finger or wheel gesture began (true) or its last contact ended (false). */
  gesture: (active: boolean) => void;
}

/**
 * The ink board on a BOOX tablet (the Android app): Onyx's pen SDK draws the pen on the e-ink
 * controller and hands each finished stroke (or eraser pass) to the board, finger gestures and
 * the other tools use the panel's fast mode, and the screen is refreshed after the board changes.
 * Everywhere else it does nothing. If the SDK never starts the pen stays the page's.
 */
export function useBooxInk({ container, sdk, preview, onStroke, onErase }: BooxInkOptions): BooxInk {
  const available = useBooxPenAvailable();
  const state = useRef({ started: false, running: false, paused: false, failed: false });
  const handlers = useRef({ onStroke, onErase });
  useEffect(() => { handlers.current = { onStroke, onErase }; }, [onStroke, onErase]);
  const previewRef = useRef(preview);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fast = useRef({ wanted: false, gesture: false, on: false, timer: undefined as ReturnType<typeof setTimeout> | undefined });

  const setFast = useCallback(() => {
    const { wanted, gesture } = fast.current;
    const on = available && (wanted || gesture);
    if (on === fast.current.on) return;
    fast.current.on = on;
    void BooxPen.interaction({ active: on }).catch(() => undefined);
  }, [available]);

  // The pen and highlighter are the SDK's; the eraser is the page's, drawn in fast mode.
  useEffect(() => {
    if (!available) return;
    fast.current.wanted = !sdk;
    setFast();
  }, [available, sdk, setFast]);

  // Leaving the board, or the page being hidden, releases fast mode.
  useEffect(() => {
    if (!available) return;
    const hidden = () => {
      if (document.hidden) { fast.current.gesture = false; fast.current.wanted = false; setFast(); }
    };
    document.addEventListener('visibilitychange', hidden);
    const current = fast.current;
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      clearTimeout(current.timer);
      current.gesture = false;
      current.wanted = false;
      setFast();
    };
  }, [available, setFast]);

  // The SDK owns the pen while the Pen or Highlight tool is chosen and nothing covers the board.
  useEffect(() => {
    const element = container.current;
    if (!available || !sdk || !element) return;
    const status = { started: false, running: false, paused: false, failed: false };
    state.current = status;
    let stopped = false;
    let lastRegion = '';
    const removers: (() => void)[] = [];

    const measure = (): { region: BooxPenBox; exclude: BooxPenBox[] } | null => {
      const region = boxOf(element.getBoundingClientRect());
      if (!region) return null;
      const exclude = [...element.querySelectorAll(CONTROLS), ...document.querySelectorAll('[data-testid="show-tools"]')]
        .map((control) => boxOf(control.getBoundingClientRect()))
        .filter((box): box is BooxPenBox => Boolean(box && overlaps(box, region)));
      return { region, exclude };
    };

    const sync = () => {
      if (stopped || status.failed) return;
      const area = measure();
      const covered = Boolean(area) && [...document.querySelectorAll(OVERLAYS)].some((overlay) => {
        const box = boxOf(overlay.getBoundingClientRect());
        return box && area && overlaps(box, area.region);
      });
      if (!area || covered) {
        if (status.started && !status.paused) { status.paused = true; void BooxPen.pause().catch(() => undefined); }
        return;
      }
      const key = JSON.stringify(area);
      if (!status.started) {
        status.started = true;
        lastRegion = key;
        void BooxPen.start({ ...area, ...previewRef.current }).then(
          () => {
            if (stopped) return;
            status.running = true;
            // Set again once the SDK is up: a width given only at start didn't hold on the Go 10.3.
            void BooxPen.setWidth(previewRef.current).catch(() => undefined);
          },
          () => { status.started = false; status.failed = true; },
        );
        return;
      }
      if (key !== lastRegion) {
        lastRegion = key;
        void BooxPen.setRegion(area).catch(() => undefined);
      }
      if (status.paused) { status.paused = false; void BooxPen.resume().catch(() => undefined); }
    };

    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    sync();
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const changes = new MutationObserver(schedule);
    changes.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    removers.push(() => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    });

    const listen = (event: 'stroke' | 'erase') => {
      const added = BooxPen.addListener(event, ({ points }) => {
        if (stopped) return;
        if (event === 'stroke') handlers.current.onStroke(points);
        else handlers.current.onErase(points);
      });
      removers.push(() => { void added.then((listener) => listener.remove()); });
    };
    listen('stroke');
    listen('erase');

    return () => {
      stopped = true;
      status.running = false;
      removers.forEach((remove) => remove());
      if (status.started) void BooxPen.stop().catch(() => undefined);
    };
  }, [available, sdk, container]);

  // The preview follows the tool, size, color and zoom without restarting the pen.
  const { width, color, marker } = preview;
  useEffect(() => {
    const { current } = previewRef;
    const changed = current.width !== width || current.color !== color || current.marker !== marker;
    previewRef.current = { width, color, marker };
    if (!changed || !state.current.running) return;
    void BooxPen.setWidth({ width, color, marker }).catch(() => undefined);
  }, [width, color, marker]);

  useEffect(() => () => clearTimeout(refreshTimer.current), []);

  const owns = useCallback(() => state.current.running && !state.current.paused, []);

  const painted = useCallback(() => {
    if (!available) return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      if (state.current.started && !state.current.paused) void BooxPen.refresh().catch(() => undefined);
    }, REFRESH_DELAY_MS);
  }, [available]);

  const gesture = useCallback((active: boolean) => {
    if (!available) return;
    clearTimeout(fast.current.timer);
    if (active) {
      fast.current.gesture = true;
      setFast();
      return;
    }
    fast.current.timer = setTimeout(() => { fast.current.gesture = false; setFast(); }, SETTLE_MS);
  }, [available, setFast]);

  return { owns, painted, gesture };
}
