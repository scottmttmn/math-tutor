'use client';

/**
 * SPIKE — not part of the app. Reachable only at /canvas-next.
 *
 * Purpose: answer two questions before committing to a tldraw migration.
 *   1. Is the ink better than the hand-rolled canvas for handwritten math?
 *   2. Does exporting only the selected shapes give the tutor a tighter, more
 *      readable image than `captureFullCanvas()`, which serializes the whole
 *      3000px-tall canvas?
 *
 * It deliberately touches nothing shared: no CanvasContext, no SessionContext,
 * no IndexedDB. The SSE parsing below duplicates `useTutorChat` because that
 * hook is bound to SessionContext — fine for a throwaway, not a pattern to copy.
 */

import { useCallback, useRef, useState } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { getModelConfig } from '@/lib/modelConfig';
import type { TutorStreamEvent } from '@/types';

interface SpikeMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ExportStats {
  width: number;
  height: number;
  kb: number;
  shapeCount: number;
  scope: 'selection' | 'whole page';
}

export default function TldrawSpike() {
  const editorRef = useRef<Editor | null>(null);
  const [problemStatement, setProblemStatement] = useState('');
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<SpikeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [stats, setStats] = useState<ExportStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const appendToLast = useCallback((chunk: string) => {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = {
        ...next[next.length - 1],
        content: next[next.length - 1].content + chunk,
      };
      return next;
    });
  }, []);

  const askForHelp = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || isStreaming) return;

    setError(null);

    // The whole point of the spike: prefer the selection, fall back to the page.
    // tldraw trims to content bounds, so even "whole page" is tight — unlike
    // captureFullCanvas(), which always ships the full 3000px sheet.
    const selected = editor.getSelectedShapeIds();
    const scope: ExportStats['scope'] = selected.length > 0 ? 'selection' : 'whole page';
    const ids = selected.length > 0 ? selected : Array.from(editor.getCurrentPageShapeIds());

    if (ids.length === 0) {
      setError('Draw something first.');
      return;
    }

    let canvasImage: string;
    let width: number;
    let height: number;
    try {
      const result = await editor.toImageDataUrl(ids, {
        format: 'png',
        background: true,
        padding: 16,
        pixelRatio: 2,
      });
      canvasImage = result.url.split(',')[1] ?? '';
      width = result.width;
      height = result.height;
    } catch (e) {
      setError(`Export failed: ${e instanceof Error ? e.message : 'unknown error'}`);
      return;
    }

    if (!canvasImage) {
      setError('Export produced an empty image.');
      return;
    }

    setStats({
      width: Math.round(width),
      height: Math.round(height),
      kb: Math.round((canvasImage.length * 0.75) / 1024),
      shapeCount: ids.length,
      scope,
    });

    const userContent = question.trim() || 'I need help with this part of my work.';
    const history = messages;

    setMessages((prev) => [
      ...prev,
      { role: 'user', content: userContent },
      { role: 'assistant', content: '' },
    ]);
    setIsStreaming(true);
    setQuestion('');

    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problemStatement,
          chatHistory: history.map((m, i) => ({
            id: `spike-${i}`,
            role: m.role,
            content: m.content,
            timestamp: Date.now(),
          })),
          canvasImage,
          modelConfig: getModelConfig(),
          userQuestion: userContent,
          sessionType: 'problem',
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        appendToLast(`Error: ${text || response.statusText}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        appendToLast('Error: No response stream');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          try {
            const event: TutorStreamEvent = JSON.parse(jsonStr);
            if (event.type === 'text_delta' && event.content) {
              appendToLast(event.content);
            } else if (event.type === 'error') {
              appendToLast(`\n\nError: ${event.error}`);
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (e) {
      appendToLast(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsStreaming(false);
    }
  }, [appendToLast, isStreaming, messages, problemStatement, question]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
        <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
          tldraw spike
        </span>
        <input
          type="text"
          value={problemStatement}
          onChange={(e) => setProblemStatement(e.target.value)}
          placeholder="Problem statement (optional)"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
        />
      </header>

      <div className="flex min-h-0 flex-1">
        {/* tldraw needs a positioned parent with real dimensions */}
        <div className="relative min-w-0 flex-1">
          <Tldraw
            onMount={(editor) => {
              editorRef.current = editor;
            }}
          />
        </div>

        <aside className="flex w-96 flex-col border-l border-gray-200">
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && (
              <p className="text-sm text-gray-500">
                Draw some working, optionally select part of it, then ask for help. Selecting a
                region is the case worth testing — the export is trimmed to those shapes.
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`mb-3 rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                  m.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-gray-100 text-gray-800'
                }`}
              >
                {m.content || (isStreaming && i === messages.length - 1 ? '…' : '')}
              </div>
            ))}
          </div>

          {stats && (
            <div className="border-t border-gray-200 px-3 py-2 text-xs text-gray-600">
              Last export: {stats.scope}, {stats.shapeCount} shape
              {stats.shapeCount === 1 ? '' : 's'} → {stats.width}×{stats.height}px, ~{stats.kb} KB
            </div>
          )}

          {error && (
            <div className="border-t border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="border-t border-gray-200 p-3">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isStreaming) askForHelp();
              }}
              placeholder="Ask a question (optional)"
              className="mb-2 w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={askForHelp}
              disabled={isStreaming}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {isStreaming ? 'Thinking…' : 'Ask for Help'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
