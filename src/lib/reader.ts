import type { PageRect } from '@/types';

// Margins trimmed from a page leave at least this much of it on each side: a page with little on
// it (a chapter opening, a short handout) shouldn't shrink to a strip. A textbook's outer margin is
// about 14% of its width.
const MAX_TRIM = 0.18;
// Space kept around the printed area, so ink at its edge isn't flush with the screen.
const TRIM_PADDING = 0.015;
// Trimming less than this in total isn't worth a different page shape.
const MIN_TRIM = 0.04;

/**
 * The part of the book's pages worth showing: the union of the printed areas of a few of its
 * pages (as fractions of the page), padded, never trimming more than MAX_TRIM from a side. One box
 * for the whole book, so pages don't jump in size as they turn. Null when there is nothing to trim.
 */
export function bookCrop(printed: (PageRect | null)[]): PageRect | null {
  const boxes = printed.filter((box): box is PageRect => box !== null);
  if (!boxes.length) return null;
  const left = Math.min(MAX_TRIM, Math.max(0, Math.min(...boxes.map((box) => box.x)) - TRIM_PADDING));
  const top = Math.min(MAX_TRIM, Math.max(0, Math.min(...boxes.map((box) => box.y)) - TRIM_PADDING));
  const right = Math.max(1 - MAX_TRIM, Math.min(1, Math.max(...boxes.map((box) => box.x + box.width)) + TRIM_PADDING));
  const bottom = Math.max(1 - MAX_TRIM, Math.min(1, Math.max(...boxes.map((box) => box.y + box.height)) + TRIM_PADDING));
  if (left + (1 - right) + top + (1 - bottom) < MIN_TRIM) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The printed area of an image (RGBA pixels): the box around everything darker than near-white. */
export function printedArea(pixels: Uint8ClampedArray, width: number, height: number): PageRect | null {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // Transparent counts as paper; light greys (scan noise, faint rules) too.
      if (pixels[i + 3] < 128 || pixels[i] + pixels[i + 1] + pixels[i + 2] > 3 * 225) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX / width, y: minY / height, width: (maxX + 1 - minX) / width, height: (maxY + 1 - minY) / height };
}

/** Which pages to measure for the crop: up to `count` spread through the book, past its cover. */
export function samplePages(pageCount: number, count = 8): number[] {
  const first = pageCount > 3 ? 2 : 1;
  const span = pageCount - first + 1;
  if (span <= count) return Array.from({ length: span }, (_, index) => first + index);
  return Array.from({ length: count }, (_, index) => first + Math.round((index * (span - 1)) / (count - 1)));
}

/** A rect in page fractions, as fractions of the shown (cropped) part of the page. */
export function toShown(rect: PageRect, crop: PageRect | null): PageRect {
  if (!crop) return rect;
  return { x: (rect.x - crop.x) / crop.width, y: (rect.y - crop.y) / crop.height, width: rect.width / crop.width, height: rect.height / crop.height };
}

/** A point on the shown part of the page, in fractions of the whole page. */
export function toPage(point: { x: number; y: number }, crop: PageRect | null): { x: number; y: number } {
  if (!crop) return point;
  return { x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height };
}

/** What the page is called: its printed number when the PDF records one, else its place in the file. */
export function pageName(labels: string[] | null, page: number): string {
  return labels?.[page - 1]?.trim() || String(page);
}

/**
 * The page someone typed: a printed page number ("47", "xii") when the PDF records them, else (or
 * when none matches) the page's place in the file. Null when there is no such page.
 */
export function findPage(typed: string, labels: string[] | null, pageCount: number): number | null {
  const wanted = typed.trim().replace(/^p(age|\.)?\s*/i, '').toLowerCase();
  if (!wanted) return null;
  const labelled = labels?.findIndex((label) => label.trim().toLowerCase() === wanted) ?? -1;
  if (labelled >= 0) return labelled + 1;
  if (!/^\d+$/.test(wanted)) return null;
  const page = Number(wanted);
  return page >= 1 && page <= pageCount ? page : null;
}
