import katex from 'katex';
import { memo } from 'react';
import { renderInlineMarkdown } from '@/lib/inlineMarkdown';
import { splitTutorContent } from '@/lib/tutorContent';

export default memo(function TutorContent({ content, markdown = true }: { content: string; markdown?: boolean }) {
  return <div className="tutor-content whitespace-pre-wrap break-words">
    {splitTutorContent(content).map((part, index) => {
      if (part.kind === 'text') return <span key={index}>{markdown ? renderInlineMarkdown(part.value) : part.value}</span>;
      if (part.kind === 'code') return <code key={index} className="px-1 py-0.5 rounded bg-black/10 font-mono text-[0.9em]">{part.value}</code>;
      try {
        if (part.value.length > 4096) return <span key={index}>{part.source}</span>;
        const html = katex.renderToString(part.value, {
          displayMode: part.display, throwOnError: true, trust: false,
          strict: 'ignore', maxExpand: 100, maxSize: 20,
        });
        return <span key={index} className="whitespace-normal" dangerouslySetInnerHTML={{ __html: html }} />;
      } catch {
        return <span key={index}>{part.source}</span>;
      }
    })}
  </div>;
});
