'use client';

import { useState } from 'react';
import { useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useCanvasState } from '@/context/CanvasContext';

interface Props {
  onCaptureProblemImage: () => Promise<void> | void;
}

export default function ProblemStatement({ onCaptureProblemImage }: Props) {
  const { problemStatement, problemImage } = useSessionState();
  const dispatch = useSessionDispatch();
  const { hasContent } = useCanvasState();
  // A problem brought in from a file (Shelf → Single problem) needs to be readable, not just a thumbnail.
  const [enlarged, setEnlarged] = useState(false);

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
      <div className={`mt-1 flex gap-2 ${enlarged && problemImage ? 'items-start' : 'items-center'}`}>
        {problemImage ? (
          <>
            <button onClick={() => setEnlarged((on) => !on)} title={enlarged ? 'Make the problem figure small' : 'Show the problem figure larger'} className={enlarged ? 'min-w-0' : 'shrink-0'}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`data:image/png;base64,${problemImage}`}
                alt="Problem figure"
                className={`${enlarged ? 'max-h-72 max-w-full' : 'h-10 w-16'} object-contain rounded border border-gray-300 bg-white`}
              />
            </button>
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
            onClick={() => void onCaptureProblemImage()}
            disabled={!hasContent}
            className="text-xs px-2 py-1 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title={!hasContent ? 'Draw on the canvas first' : 'Capture current canvas as the problem figure'}
          >
            Capture as Problem
          </button>
        )}
      </div>
    </div>
  );
}
