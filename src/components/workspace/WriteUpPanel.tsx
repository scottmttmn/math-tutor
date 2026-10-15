'use client';

import katex from 'katex';
import { memo, useEffect, useMemo, useState } from 'react';
import { downloadBlob } from '@/lib/backup';
import { exportFileName } from '@/lib/exportBoard';
import { texBlocks, texDocument, texInline, type TexInline } from '@/lib/texWriteUp';
import type { WriteUp } from '@/types';

interface Props {
  onClose: () => void;
  /** The board's title, for the document and the file name. */
  title: string;
  writeUp: WriteUp | null;
  /** The LaTeX as it streams in, while a write-up is being made. */
  draft: string | null;
  error: string | null;
  /** Makes a new write-up from the board (its selection, if any). */
  onConvert: () => void;
  onEdit: (tex: string) => void;
  /** True while the tutor answers a question, which a write-up has to wait for. */
  tutorBusy: boolean;
}

function renderMath(tex: string, display: boolean) {
  try {
    if (tex.length > 4096) throw new Error('too long');
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: 'ignore', maxExpand: 100, maxSize: 20 });
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <code className="font-mono text-[0.9em] text-gray-700">{display ? `\\[${tex}\\]` : `$${tex}$`}</code>;
  }
}

function Inline({ text }: { text: string }) {
  return <>{texInline(text).map((part: TexInline, index) => {
    if (part.kind === 'math') return <span key={index}>{renderMath(part.value, false)}</span>;
    if (part.kind === 'bold') return <strong key={index}>{part.value}</strong>;
    if (part.kind === 'italic') return <em key={index}>{part.value}</em>;
    if (part.kind === 'box') return <span key={index} className="inline-block px-2 py-1 border border-gray-900">{part.value}</span>;
    return <span key={index} className="whitespace-pre-wrap">{part.value}</span>;
  })}</>;
}

/** What the write-up looks like: headings, paragraphs, lists and math. */
const Preview = memo(function Preview({ tex }: { tex: string }) {
  const blocks = useMemo(() => texBlocks(tex), [tex]);
  if (!blocks.length) return <p className="text-sm text-gray-500">Nothing to show yet.</p>;
  return (
    <div className="space-y-3 text-gray-900 font-serif leading-relaxed" data-testid="write-up-preview">
      {blocks.map((block, index) => {
        if (block.kind === 'heading') return block.level === 1
          ? <h3 key={index} className="text-lg font-bold"><Inline text={block.text} /></h3>
          : <h4 key={index} className="font-bold"><Inline text={block.text} /></h4>;
        if (block.kind === 'math') return <div key={index} className="overflow-x-auto py-1">{renderMath(block.tex, true)}</div>;
        if (block.kind === 'list') {
          const List = block.ordered ? 'ol' : 'ul';
          return <List key={index} className={`pl-6 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
            {block.items.map((item, itemIndex) => <li key={itemIndex}><Inline text={item} /></li>)}
          </List>;
        }
        return <p key={index}><Inline text={block.text} /></p>;
      })}
    </div>
  );
});

/**
 * The board's TeX write-up: the tutor reads the handwriting and writes it as LaTeX, which the
 * student corrects here beside a preview and downloads as a .tex file.
 */
export default function WriteUpPanel({ onClose, title, writeUp, draft, error, onConvert, onEdit, tutorBusy }: Props) {
  const converting = draft !== null;
  const tex = converting ? draft : writeUp?.tex ?? '';
  // The preview follows the editor after a short pause, so typing stays quick on a tablet.
  const [previewTex, setPreviewTex] = useState(tex);
  useEffect(() => {
    const timer = setTimeout(() => setPreviewTex(tex), converting ? 0 : 250);
    return () => clearTimeout(timer);
  }, [tex, converting]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const plain = 'min-h-11 px-3 text-sm text-gray-800 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-40';
  const solid = 'min-h-11 px-4 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-700 disabled:opacity-40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div role="dialog" aria-label="TeX write-up" className="bg-white rounded-xl shadow-xl w-full max-w-6xl mx-4 h-[90vh] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 flex-wrap">
          <h2 className="font-semibold text-gray-900 mr-auto">TeX write-up</h2>
          {writeUp && !converting && (
            <button onClick={onConvert} disabled={tutorBusy} className={plain} title="Write up the board again; this replaces the write-up below">
              Write up again
            </button>
          )}
          <button
            onClick={() => downloadBlob(new Blob([texDocument(title, writeUp?.tex ?? '')], { type: 'application/x-tex' }), exportFileName(title, 'tex'))}
            disabled={!writeUp?.tex.trim() || converting}
            className={writeUp ? solid : plain}
          >
            Download .tex
          </button>
          <button onClick={onClose} className={plain}>Close</button>
        </div>

        {!writeUp && !converting ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="max-w-md text-gray-700">
              The tutor reads your handwriting and writes it as LaTeX, without solving anything.
              Select part of the board first to write up only that part.
            </p>
            <button onClick={onConvert} disabled={tutorBusy} className={solid}>Write up the board</button>
            {tutorBusy && <p className="text-sm text-gray-600">Waiting for the tutor to finish its reply.</p>}
            {error && <p role="alert" className="text-sm text-red-700">Error: {error}</p>}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {(converting || error) && (
              <p role={error ? 'alert' : 'status'} className={`px-4 py-2 text-sm border-b border-gray-200 ${error ? 'text-red-700' : 'text-gray-700'}`}>
                {error ? `Error: ${error}` : 'Writing up the board…'}
              </p>
            )}
            <div className="flex-1 min-h-0 grid grid-rows-2 md:grid-rows-1 md:grid-cols-2">
              <label className="flex flex-col min-h-0 border-b md:border-b-0 md:border-r border-gray-200">
                <span className="px-4 pt-3 text-xs text-gray-600">LaTeX</span>
                <textarea
                  value={tex}
                  onChange={(event) => onEdit(event.target.value)}
                  readOnly={converting}
                  spellCheck={false}
                  className="flex-1 min-h-0 m-2 p-2 font-mono text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
              </label>
              <div className="flex flex-col min-h-0">
                <span className="px-4 pt-3 text-xs text-gray-600">Preview</span>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2"><Preview tex={previewTex} /></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
