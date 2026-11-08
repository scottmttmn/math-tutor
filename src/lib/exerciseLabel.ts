import type { PageRect } from '@/types';
import type { TextBox } from '@/lib/bookList';

// How far left of a marked box the number may sit (books hang exercise numbers in the margin).
const NUMBER_REACH = 0.08;
// Above the box: a box drawn just under the number's top still counts.
const TOP_SLACK = 0.01;

// "55.", "55)", "12", "2.15" or "Exercise 3", at the start of the first line.
const NUMBER = /^\s*(?:(?:exercise|problem|ex\.)\s*)?(\d{1,3}(?:\.\d{1,3}){0,2})(?:[.):]|\s|$)/i;
// A section bookmark's own number: "4.2 The Mean Value Theorem", "§4.2", "Section 4.2", "Chapter 4".
const SECTION = /^\s*(?:§\s*|section\s+|chapter\s+)?(\d{1,3}(?:\.\d{1,3}){0,2})(?=[\s.:]|$)/i;

/**
 * The book's own number for the exercise in a marked box: the start of its first line of text
 * (the topmost, then leftmost, text in or just left of the box). Null when that line starts
 * with no number, or on a scan with no text.
 */
export function exerciseNumberIn(boxes: TextBox[], rect: PageRect): string | null {
  const inside = boxes.filter((box) => {
    if (!box.text.trim()) return false;
    const middle = box.y + box.height / 2;
    return middle >= rect.y - TOP_SLACK && middle <= rect.y + rect.height
      && box.x + box.width > rect.x - NUMBER_REACH && box.x < rect.x + rect.width;
  });
  if (!inside.length) return null;
  const top = Math.min(...inside.map((box) => box.y + box.height / 2));
  const line = inside.filter((box) => box.y + box.height / 2 - top <= Math.max(box.height / 2, 0.004));
  const first = line.reduce((a, b) => (b.x < a.x ? b : a));
  return NUMBER.exec(first.text)?.[1] ?? null;
}

/** A section bookmark's number ("4.2"), or null when its title starts without one. */
export function sectionNumber(title: string | null): string | null {
  return title ? SECTION.exec(title)?.[1] ?? null : null;
}

/** The name for an exercise numbered `number` in the book: "4.2 #55" within a numbered section, else "Exercise 55". */
export function printedLabel(number: string, section: string | null): string {
  return section && !number.includes('.') ? `${section} #${number}` : `Exercise ${number}`;
}
