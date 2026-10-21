import type { BoardPage } from '@/types';

// Where the ink board's view is: `x`, `y` are the board point at the view's top-left corner and
// `z` is screen px per board unit. The page fills the view's width at writing scale ("fit width"),
// with a small gutter; zooming in goes up to MAX_ZOOM times that, never out past the page.

export interface Camera { x: number; y: number; z: number }
export interface ViewSize { w: number; h: number }

/** Screen px between the page's sides (and top) and the view's edge at writing scale. */
export const VIEW_MARGIN = 16;
export const MAX_ZOOM = 4;

/** The zoom at which the page fills the view's width. */
export function fitZoom(page: BoardPage, view: ViewSize): number {
  return Math.max(0.05, (view.w - VIEW_MARGIN * 2) / page.width);
}

/** Writing scale with the board's `top` (in board units) at the top of the view. */
export function fitCamera(page: BoardPage, view: ViewSize, top: number): Camera {
  const z = fitZoom(page, view);
  return clampCamera({ x: page.left - VIEW_MARGIN / z, y: top, z }, page, view);
}

/** The camera kept within the page's sides and top (the page has no bottom) and the zoom range. */
export function clampCamera(camera: Camera, page: BoardPage, view: ViewSize): Camera {
  const fit = fitZoom(page, view);
  const z = Math.min(fit * MAX_ZOOM, Math.max(fit, camera.z));
  const margin = VIEW_MARGIN / z;
  const minX = page.left - margin;
  const maxX = page.left + page.width + margin - view.w / z;
  const x = maxX < minX ? (minX + maxX) / 2 : Math.min(maxX, Math.max(minX, camera.x));
  const y = Math.max(page.top - margin, camera.y);
  return { x, y, z };
}

/** The camera zoomed by `factor` about a point of the view (screen px), which stays where it is. */
export function zoomAbout(camera: Camera, factor: number, at: { x: number; y: number }, page: BoardPage, view: ViewSize): Camera {
  const fit = fitZoom(page, view);
  const z = Math.min(fit * MAX_ZOOM, Math.max(fit, camera.z * factor));
  return clampCamera({ x: camera.x + at.x / camera.z - at.x / z, y: camera.y + at.y / camera.z - at.y / z, z }, page, view);
}

/** Whether the camera is at writing scale. */
export function atFitZoom(camera: Camera, page: BoardPage, view: ViewSize): boolean {
  return Math.abs(camera.z - fitZoom(page, view)) < 1e-6;
}

/** A point of the view (screen px) on the board. */
export function toBoard(camera: Camera, x: number, y: number) {
  return { x: camera.x + x / camera.z, y: camera.y + y / camera.z };
}
