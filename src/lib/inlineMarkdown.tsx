import type { ReactNode } from 'react';

/**
 * Renders the small subset of markdown the tutor actually emits: **bold**,
 * *italic* / _italic_, and `code`. Everything else is left as literal text.
 *
 * Delimiters must sit on a word boundary, so math like `2*3*4`, `a_1 + b_2`
 * and `2**3` is never mistaken for emphasis. Unclosed delimiters (common while
 * a response is still streaming) stay literal until their partner arrives.
 */
const MAX_DEPTH = 3;

function buildPattern(): RegExp {
  return new RegExp(
    [
      // `code`
      '`([^`\\n]+)`',
      // **bold**
      '(?<![\\w*])\\*\\*(?=\\S)([^\\n]*?\\S)\\*\\*(?![\\w*])',
      // *italic*
      '(?<![\\w*])\\*(?=\\S)([^*\\n]*?\\S)\\*(?![\\w*])',
      // _italic_
      '(?<![\\w_])_(?=\\S)([^_\\n]*?\\S)_(?![\\w_])',
    ].join('|'),
    'g'
  );
}

export function renderInlineMarkdown(text: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  if (!text) return nodes;

  if (depth >= MAX_DEPTH) {
    nodes.push(text);
    return nodes;
  }

  const pattern = buildPattern();
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const [, code, bold, starItalic, underscoreItalic] = match;

    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (code !== undefined) {
      nodes.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded bg-black/10 font-mono text-[0.9em]"
        >
          {code}
        </code>
      );
    } else if (bold !== undefined) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {renderInlineMarkdown(bold, depth + 1)}
        </strong>
      );
    } else {
      const italic = starItalic ?? underscoreItalic;
      nodes.push(
        <em key={key++} className="italic">
          {renderInlineMarkdown(italic, depth + 1)}
        </em>
      );
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
