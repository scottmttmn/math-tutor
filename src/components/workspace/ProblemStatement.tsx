'use client';

import { useRef, useState } from 'react';
import { useSessionState, useSessionDispatch } from '@/context/SessionContext';
import { useCanvasState } from '@/context/CanvasContext';
import { problemImageFromFile } from '@/lib/shelf';

interface Props {
  onCaptureProblemImage: () => Promise<void> | void;
  /** Places the problem figure on the board, to write on and around it. */
  onPutOnBoard: (image: string) => void;
}

export default function ProblemStatement({ onCaptureProblemImage, onPutOnBoard }: Props) {
  const { problemStatement, problemImage } = useSessionState();
  const dispatch = useSessionDispatch();
  const { hasContent } = useCanvasState();
  // A problem brought in from a picture needs to be readable, not just a thumbnail.
  const [enlarged, setEnlarged] = useState(false);
  const pictureInput = useRef<HTMLInputElement>(null);
  const [pictureError, setPictureError] = useState('');

  // A photo or screenshot of the problem, or a PDF's first page, becomes its figure.
  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    setPictureError('');
    try { dispatch({ type: 'SET_PROBLEM_IMAGE', image: await problemImageFromFile(file) }); } catch {
      setPictureError(`${file.name} could not be opened. Use a picture or a PDF.`);
    }
  };

  return (
    <div className="px-3 py-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Problem
      </label>
      <textarea
        value={problemStatement}
        onChange={(e) => dispatch({ type: 'SET_PROBLEM', text: e.target.value })}
        placeholder="Type the math problem you're working on..."
        className="w-full h-20 lg:h-40 px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
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
            <span className="text-xs text-gray-700">Problem figure</span>
            <button
              onClick={() => onPutOnBoard(problemImage)}
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50"
              title="Put the problem figure on the board to write on and around it"
            >
              Put on board
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_PROBLEM_IMAGE', image: null })}
              className="ml-auto min-h-11 px-2 text-sm text-gray-600 hover:text-gray-900"
              title="Clear problem figure"
            >
              ✕ Clear
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => pictureInput.current?.click()}
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50"
              title="Use a photo, a screenshot or a PDF of the problem as its figure"
            >
              Add picture
            </button>
            <input ref={pictureInput} type="file" accept="image/*,application/pdf,.pdf" hidden aria-label="Problem picture"
              onChange={(event) => { void addPicture(event.target.files?.[0]); event.target.value = ''; }} />
            <button
              onClick={() => void onCaptureProblemImage()}
              disabled={!hasContent}
              className="min-h-11 px-3 text-sm border border-gray-300 rounded-lg text-gray-800 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              title={!hasContent ? 'Draw on the canvas first' : 'Capture current canvas as the problem figure'}
            >
              Capture as Problem
            </button>
          </>
        )}
      </div>
      {pictureError && <p role="alert" className="mt-1 text-xs text-red-700">{pictureError}</p>}
    </div>
  );
}
