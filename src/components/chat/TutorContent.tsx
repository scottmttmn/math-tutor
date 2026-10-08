import katex from 'katex';
import { memo, type ReactNode } from 'react';
import { renderInlineMarkdown } from '@/lib/inlineMarkdown';
import { splitTutorContent, type TutorContentPart } from '@/lib/tutorContent';

// Math and code stand in as private-use placeholders while Markdown runs, so emphasis
// like `**Use \(x^2\) here**` can wrap them without touching their contents.
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

function renderAtom(part: TutorContentPart, key: string): ReactNode {
  if (part.kind === 'code') return <code key={key} className="px-1 py-0.5 rounded bg-black/10 font-mono text-[0.9em]">{part.value}</code>;
  try {
    if (part.value.length > 4096) return <span key={key}>{part.source}</span>;
    const html = katex.renderToString(part.value, {
      displayMode: part.display, throwOnError: true, trust: false,
      strict: 'ignore', maxExpand: 100, maxSize: 20,
    });
    return <span key={key} className="whitespace-normal" dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span key={key}>{part.source}</span>;
  }
}

export default memo(function TutorContent({ content, markdown = true }: { content: string; markdown?: boolean }) {
  const parts = splitTutorContent(content);
  if (!markdown) {
    return <div className="tutor-content whitespace-pre-wrap break-words">
      {parts.map((part, index) => part.kind === 'text' ? <span key={index}>{part.value}</span> : renderAtom(part, String(index)))}
    </div>;
  }
  const atoms: TutorContentPart[] = [];
  const text = parts.map((part) => part.kind === 'text' ? part.value : `\uE000${atoms.push(part) - 1}\uE001`).join('');
  const expand = (run: string): ReactNode[] => {
    const nodes: ReactNode[] = [];
    let last = 0;
    for (const match of run.matchAll(PLACEHOLDER)) {
      if (match.index > last) nodes.push(run.slice(last, match.index));
      const index = Number(match[1]);
      nodes.push(atoms[index] ? renderAtom(atoms[index], `atom-${index}`) : match[0]);
      last = match.index + match[0].length;
    }
    if (last < run.length) nodes.push(run.slice(last));
    return nodes;
  };
  return <div className="tutor-content whitespace-pre-wrap break-words">{renderInlineMarkdown(text, 0, expand)}</div>;
});
