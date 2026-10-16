import type { PageRect } from '@/types';
import type { TextBox } from '@/lib/bookList';

// Words of context either side of a match in the results.
export const CONTEXT_CHARS = 40;
// A search stops collecting after this many matches (the results say so).
export const MAX_MATCHES = 300;

/** One place the words were found on a page. */
export interface PageMatch {
  /** Where the words are, in fractions of the page: one rect per run of text they cross. */
  rects: PageRect[];
  /** The line around them, split so the words themselves can be marked. */
  before: string;
  match: string;
  after: string;
}

// Lower case without changing a character's length (so offsets still line up), and one space for any run.
const fold = (ch: string) => {
  if (/\s/.test(ch)) return ' ';
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : ch;
};

/** The query as it is matched: lower case, runs of spaces as one, trimmed. '' matches nothing. */
export function searchTerm(query: string): string {
  return Array.from(query.trim(), (ch) => (ch.length === 1 ? fold(ch) : ch)).join('').replace(/ +/g, ' ');
}

/**
 * Every match of `query` on a page, from its text boxes (`pageTextBoxes`). The boxes are read as one
 * text, a space between them, so words split across runs of text (or lines) are still found; case
 * and spacing are ignored. A match's rects are cut from its boxes in proportion, as `textUnder` reads them.
 */
export function findOnPage(boxes: TextBox[], query: string): PageMatch[] {
  const term = searchTerm(query);
  if (!term) return [];
  // The page's text, folded, and where each character came from (null: a space put between boxes).
  let text = '';
  let shown = '';
  const from: ({ box: number; at: number } | null)[] = [];
  boxes.forEach((box, index) => {
    if (text && !text.endsWith(' ')) { text += ' '; shown += ' '; from.push(null); }
    // By UTF-16 unit, as indexOf counts (math letters such as 𝑥 are two).
    for (let at = 0; at < box.text.length; at += 1) {
      const ch = box.text[at];
      const folded = fold(ch);
      if (folded === ' ' && (!text || text.endsWith(' '))) continue;
      text += folded;
      shown += folded === ' ' ? ' ' : ch;
      from.push({ box: index, at });
    }
  });

  const matches: PageMatch[] = [];
  for (let start = text.indexOf(term); start >= 0; start = text.indexOf(term, start + term.length)) {
    const end = start + term.length;
    // Each box the match crosses, from its first to its last character in that box.
    const spans = new Map<number, { first: number; last: number }>();
    for (let i = start; i < end; i += 1) {
      const source = from[i];
      if (!source) continue;
      const span = spans.get(source.box);
      if (span) span.last = source.at;
      else spans.set(source.box, { first: source.at, last: source.at });
    }
    const rects = [...spans].map(([index, { first, last }]) => {
      const box = boxes[index];
      const length = box.text.length || 1;
      return { x: box.x + (box.width * first) / length, y: box.y, width: (box.width * (last + 1 - first)) / length, height: box.height };
    });
    let lead = Math.max(0, start - CONTEXT_CHARS);
    let tail = Math.min(text.length, end + CONTEXT_CHARS);
    // Whole words at the edges of the context.
    while (lead > 0 && text[lead - 1] !== ' ') lead -= 1;
    while (tail < text.length && text[tail] !== ' ') tail += 1;
    matches.push({
      rects,
      before: `${lead > 0 ? '…' : ''}${shown.slice(lead, start).trimStart()}`,
      match: shown.slice(start, end),
      after: `${shown.slice(end, tail).trimEnd()}${tail < text.length ? '…' : ''}`,
    });
  }
  return matches;
}
