'use client';

import { useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useCanvasState } from '@/context/CanvasContext';

interface Props {
  onCaptureProblemImage: () => void;
}

export default function ProblemStatement({ onCaptureProblemImage }: Props) {
  const { problemStatement, problemImage } = useSessionState();
  const dispatch = useSessionDispatch();
  const { strokes } = useCanvasState();

  return (
    <div className="px-3 py-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Problem
      </label>
      <textarea
        value={problemStatement}
        onChange={(e) => dispatch({ type: 'SET_PROBLEM', text: e.target.value })}
        placeholder="Type the math problem you're working on..."
        className="w-full h-20 px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <div className="mt-1 flex items-center gap-2">
        {problemImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${problemImage}`}
              alt="Problem figure"
              className="h-10 w-16 object-contain rounded border border-gray-300 bg-white"
            />
            <span className="text-xs text-green-700 font-medium">Problem captured</span>
            <button
              onClick={() => dispatch({ type: 'SET_PROBLEM_IMAGE', image: null })}
              className="text-xs text-gray-400 hover:text-red-500 ml-auto"
              title="Clear problem figure"
            >
              ✕ Clear
            </button>
          </>
        ) : (
          <button
            onClick={onCaptureProblemImage}
            disabled={strokes.length === 0}
            className="text-xs px-2 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={strokes.length === 0 ? 'Draw on the canvas first' : 'Capture current canvas as the problem figure'}
          >
            Capture as Problem
          </button>
        )}
      </div>
    </div>
  );
}
