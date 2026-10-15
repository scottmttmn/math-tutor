// A board's TeX write-up: the LaTeX body the tutor route writes from the handwriting
// (WRITE_UP_PROMPT), the downloadable .tex around it, and a light reading of the body for the
// preview. The preview is not LaTeX: it shows headings, paragraphs, lists and math (by KaTeX),
// which is what a write-up is made of; anything else shows as its source.

/** The .tex file: a minimal article around the body, with the board's title. */
export function texDocument(title: string, body: string) {
  const safeTitle = title.split('\n')[0].replace(/[\\{}$&#^_%~]/g, '').trim();
  return [
    '\\documentclass{article}',
    '\\usepackage{amsmath,amssymb}',
    ...(safeTitle ? [`\\title{${safeTitle}}`, '\\date{}'] : []),
    '\\begin{document}',
    ...(safeTitle ? ['\\maketitle'] : []),
    '',
    body.trim(),
    '',
    '\\end{document}',
    '',
  ].join('\n');
}

/** What the model wrote, as a body: without code fences, a preamble or document wrappers it added anyway. */
export function cleanTexReply(text: string) {
  let body = text.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/, '');
  const begin = body.indexOf('\\begin{document}');
  if (begin >= 0) body = body.slice(begin + '\\begin{document}'.length);
  const end = body.indexOf('\\end{document}');
  if (end >= 0) body = body.slice(0, end);
  return body.replace(/^\s*\\maketitle\s*$/m, '').trim();
}

export type TexBlock =
  | { kind: 'heading'; level: 1 | 2; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'math'; tex: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const DISPLAY_ENVS = ['align', 'align*', 'equation', 'equation*', 'gather', 'gather*', 'multline', 'multline*', 'alignat', 'alignat*'];

/** Splits a write-up body into blocks for the preview. */
export function texBlocks(body: string): TexBlock[] {
  const blocks: TexBlock[] = [];
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  let paragraph: string[] = [];
  const endParagraph = () => {
    const text = paragraph.join(' ').trim();
    if (text) blocks.push({ kind: 'paragraph', text });
    paragraph = [];
  };
  // Collects lines from `start` until one contains `close`; returns the text and the next line index.
  const until = (start: number, first: string, close: string): [string, number] => {
    const collected = [first];
    let index = start;
    while (!collected.join('\n').includes(close) && index + 1 < lines.length) collected.push(lines[++index]);
    return [collected.join('\n'), index + 1];
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { endParagraph(); index++; continue; }
    if (trimmed.startsWith('%')) { index++; continue; }

    const heading = /^\\(sub)?section\*?\{(.*)\}\s*$/.exec(trimmed);
    if (heading) { endParagraph(); blocks.push({ kind: 'heading', level: heading[1] ? 2 : 1, text: heading[2] }); index++; continue; }

    const env = /^\\begin\{([a-z]+\*?)\}/.exec(trimmed);
    if (env && DISPLAY_ENVS.includes(env[1])) {
      endParagraph();
      const [text, next] = until(index, line, `\\end{${env[1]}}`);
      const end = text.indexOf(`\\end{${env[1]}}`);
      // KaTeX numbers nothing, so the starred and unstarred forms read the same.
      blocks.push({ kind: 'math', tex: (end >= 0 ? text.slice(0, end + `\\end{${env[1]}}`.length) : text).trim().replace(/\\begin\{(\w+)\}/, '\\begin{$1*}').replace(/\\end\{(\w+)\}$/, '\\end{$1*}').replace(/\*\*\}/g, '*}') });
      index = next;
      continue;
    }
    if (env && (env[1] === 'itemize' || env[1] === 'enumerate')) {
      endParagraph();
      const [text, next] = until(index, line, `\\end{${env[1]}}`);
      const inner = text.slice(text.indexOf('}') + 1, text.lastIndexOf(`\\end{${env[1]}}`) >= 0 ? text.lastIndexOf(`\\end{${env[1]}}`) : undefined);
      const items = inner.split(/\\item\b/).map((item) => item.replace(/\s+/g, ' ').trim()).filter(Boolean);
      blocks.push({ kind: 'list', ordered: env[1] === 'enumerate', items });
      index = next;
      continue;
    }
    if (trimmed.startsWith('\\[')) {
      endParagraph();
      const [text, next] = until(index, line, '\\]');
      blocks.push({ kind: 'math', tex: text.trim().replace(/^\\\[/, '').replace(/\\\][\s\S]*$/, '').trim() });
      index = next;
      continue;
    }
    if (trimmed.startsWith('$$')) {
      endParagraph();
      const [text, next] = until(index, line.trim().slice(2), '$$');
      blocks.push({ kind: 'math', tex: text.replace(/\$\$[\s\S]*$/, '').trim() });
      index = next;
      continue;
    }
    paragraph.push(trimmed);
    index++;
  }
  endParagraph();
  return blocks;
}

export type TexInline = { kind: 'text' | 'math' | 'bold' | 'italic' | 'box'; value: string };

/** Splits one paragraph's text into plain text, inline math and the few text commands a write-up uses. */
export function texInline(text: string): TexInline[] {
  const parts: TexInline[] = [];
  const pattern = /\$([^$]+)\$|\\\((.+?)\\\)|\\textbf\{([^{}]*)\}|\\(?:emph|textit)\{([^{}]*)\}|\\fbox\{([^{}]*)\}|\\text\{([^{}]*)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push({ kind: 'text', value: text.slice(last, match.index) });
    if (match[1] !== undefined || match[2] !== undefined) parts.push({ kind: 'math', value: (match[1] ?? match[2]).trim() });
    else if (match[3] !== undefined) parts.push({ kind: 'bold', value: match[3] });
    else if (match[4] !== undefined) parts.push({ kind: 'italic', value: match[4] });
    else if (match[5] !== undefined) parts.push({ kind: 'box', value: match[5] });
    else parts.push({ kind: 'text', value: match[6] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  // LaTeX's own spacing and quote marks, as they print.
  return parts.map((part) => part.kind === 'math' ? part : { ...part, value: part.value.replace(/~/g, ' ').replace(/``/g, '“').replace(/''/g, '”').replace(/\\([%$&#_{}])/g, '$1').replace(/\\\\/g, '\n') });
}
