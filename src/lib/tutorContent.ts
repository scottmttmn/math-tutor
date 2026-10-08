export interface TutorContentPart {
  kind: 'text' | 'math' | 'code';
  source: string;
  value: string;
  display?: boolean;
}

// Split before Markdown so subscripts and emphasis inside math remain untouched.
export function splitTutorContent(text: string): TutorContentPart[] {
  const parts: TutorContentPart[] = [];
  const opener = /`|\\\[|\\\(|\$\$|\$/g;
  const escaped = (index: number) => {
    let slashes = 0;
    while (index > 0 && text[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(text))) {
    const delimiter = match[0];
    if (escaped(match.index)) continue;
    if (delimiter === '$' && /\s/.test(text[opener.lastIndex] ?? ' ')) continue;
    const close = delimiter === '\\[' ? '\\]' : delimiter === '\\(' ? '\\)' : delimiter;
    let closing = text.indexOf(close, opener.lastIndex);
    while (closing >= 0 && (escaped(closing) || (delimiter === '$' &&
      (/\s/.test(text[closing - 1]) || /\d/.test(text[closing + 1] ?? ''))))) {
      closing = text.indexOf(close, closing + close.length);
    }
    if (closing < 0) continue; // Streaming fragments remain readable literal text.
    if (match.index > end) parts.push({ kind: 'text', source: text.slice(end, match.index), value: text.slice(end, match.index) });
    const source = text.slice(match.index, closing + close.length);
    parts.push({ kind: delimiter === '`' ? 'code' : 'math', source,
      value: text.slice(opener.lastIndex, closing), display: delimiter === '$$' || delimiter === '\\[' });
    end = closing + close.length;
    opener.lastIndex = end;
  }
  if (end < text.length) parts.push({ kind: 'text', source: text.slice(end), value: text.slice(end) });
  return parts;
}
