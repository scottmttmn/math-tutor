'use client';

import { useCanvasState, useCanvasDispatch } from '@/context/CanvasContext';
import { useRateLimit } from '@/hooks/useRateLimit';
import { COLOR_PRESETS, THICKNESS_MIN, THICKNESS_MAX, RATE_LIMIT_MS } from '@/lib/constants';
import type { DrawingTool } from '@/types';

interface Props {
  onAskForHelp: () => void;
  isStreaming: boolean;
}

export default function BottomToolbar({ onAskForHelp, isStreaming }: Props) {
  const { toolSettings, strokes, undoneStrokes, selection } = useCanvasState();
  const dispatch = useCanvasDispatch();
  const { isLimited, formatRemaining } = useRateLimit(RATE_LIMIT_MS);

  const setTool = (tool: DrawingTool) => dispatch({ type: 'SET_TOOL', tool });

  const currentThickness =
    toolSettings.activeTool === 'eraser'
      ? toolSettings.eraserThickness
      : toolSettings.penThickness;

  const helpDisabled = isLimited || isStreaming;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-gray-200 bg-white flex-wrap">
      {/* Drawing tools */}
      <div className="flex items-center gap-1">
        <ToolButton
          active={toolSettings.activeTool === 'pen'}
          onClick={() => setTool('pen')}
          title="Pen"
        >
          <PenIcon />
        </ToolButton>
        <ToolButton
          active={toolSettings.activeTool === 'eraser'}
          onClick={() => setTool('eraser')}
          title="Eraser"
        >
          <EraserIcon />
        </ToolButton>
        <ToolButton
          active={toolSettings.activeTool === 'select'}
          onClick={() => setTool('select')}
          title="Select Region"
        >
          <SelectIcon />
        </ToolButton>
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Colors */}
      <div className="flex items-center gap-1">
        {COLOR_PRESETS.map((color) => (
          <button
            key={color}
            onClick={() => dispatch({ type: 'SET_COLOR', color })}
            className={`w-5 h-5 rounded-full border-2 transition-transform ${
              toolSettings.penColor === color ? 'border-blue-500 scale-110' : 'border-gray-300'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Thickness */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">Size</span>
        <input
          type="range"
          min={THICKNESS_MIN}
          max={THICKNESS_MAX}
          value={currentThickness}
          onChange={(e) => dispatch({ type: 'SET_THICKNESS', thickness: Number(e.target.value) })}
          className="w-20 h-1 accent-blue-500"
        />
      </div>

      <div className="w-px h-6 bg-gray-200" />

      {/* Undo / Redo / Clear */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => dispatch({ type: 'UNDO' })}
          disabled={strokes.length === 0}
          className="px-2 py-1 text-xs text-gray-600 rounded hover:bg-gray-100 disabled:opacity-30"
          title="Undo (Ctrl+Z)"
        >
          Undo
        </button>
        <button
          onClick={() => dispatch({ type: 'REDO' })}
          disabled={undoneStrokes.length === 0}
          className="px-2 py-1 text-xs text-gray-600 rounded hover:bg-gray-100 disabled:opacity-30"
          title="Redo (Ctrl+Shift+Z)"
        >
          Redo
        </button>
        <button
          onClick={() => dispatch({ type: 'CLEAR' })}
          disabled={strokes.length === 0}
          className="px-2 py-1 text-xs text-gray-600 rounded hover:bg-gray-100 disabled:opacity-30"
        >
          Clear
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Selection indicator */}
      {selection && (
        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
          Region selected
        </span>
      )}

      {/* Ask for Help */}
      <button
        onClick={onAskForHelp}
        disabled={helpDisabled}
        className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
          helpDisabled
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-green-500 text-white hover:bg-green-600'
        }`}
      >
        {isLimited ? `Wait ${formatRemaining()}` : 'Ask for Help'}
      </button>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded-lg transition-colors ${
        active ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {children}
    </button>
  );
}

function PenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 14H6.5l-4-4 7.5-7.5 6 6-4 4z" />
      <path d="M6.5 14L2.5 10" />
    </svg>
  );
}

function SelectIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 2">
      <rect x="2" y="2" width="12" height="12" rx="1" />
    </svg>
  );
}
