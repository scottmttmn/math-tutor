import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BooxPenBox, BooxPenPlugin, BooxPenPoint, PenTestStats } from '@/types';

// Onyx's pen SDK on BOOX tablets (android/…/BooxPenPlugin.java). Nothing here touches the native
// side outside the Android app, and there the plugin refuses everything but status() off BOOX.
export const BooxPen = registerPlugin<BooxPenPlugin>('BooxPen');

let onyx: Promise<boolean> | undefined;

/** Whether this is the Android app on a BOOX tablet. Asked once per visit. */
export function booxPenAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return Promise.resolve(false);
  onyx ??= BooxPen.status().then((status) => status.onyx, () => false);
  return onyx;
}

/** The plugin's flat [x, y, pressure, ms, …] as points; a trailing partial sample is dropped. */
export function strokePoints(flat: number[]): BooxPenPoint[] {
  const points: BooxPenPoint[] = [];
  for (let i = 0; i + 3 < flat.length; i += 4) {
    points.push({ x: flat[i], y: flat[i + 1], pressure: flat[i + 2], ms: flat[i + 3] });
  }
  return points;
}

/** The stroke's path with points added so that none are more than `step` CSS px apart. */
export function sweep(points: BooxPenPoint[], step: number): BooxPenPoint[] {
  const result = points.slice(0, 1);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let n = 1; n <= steps; n++) {
      const t = n / steps;
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, pressure: a.pressure + (b.pressure - a.pressure) * t, ms: a.ms + (b.ms - a.ms) * t });
    }
  }
  return result;
}

/** The pen test's numbers for one SDK stroke. The SDK doesn't say when the page got each sample. */
export function strokeStats(points: BooxPenPoint[]): PenTestStats | null {
  if (points.length < 2) return null;
  const seconds = (points[points.length - 1].ms - points[0].ms) / 1000;
  if (seconds <= 0) return null;
  let worstGap = 0;
  for (let i = 1; i < points.length; i++) worstGap = Math.max(worstGap, points[i].ms - points[i - 1].ms);
  return { samplesPerSecond: Math.round(points.length / seconds), worstGapMs: Math.round(worstGap) };
}

/** An element's box as the plugin takes it, or null when it has no size (hidden). */
export function boxOf(rect: { left: number; top: number; width: number; height: number }): BooxPenBox | null {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** Whether two boxes overlap, so a control outside the region needn't be excluded from it. */
export function overlaps(a: BooxPenBox, b: BooxPenBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
