'use client';

import { useSessionState, useSessionDispatch } from '@/context/SessionContext';

export default function NoteHeader() {
  const { problemStatement } = useSessionState();
  const dispatch = useSessionDispatch();

  return (
    <div className="px-3 py-2 border-b border-gray-100">
      <label className="block text-xs font-medium text-blue-600 mb-1 uppercase tracking-wide">
        Notes
      </label>
      <input
        type="text"
        value={problemStatement}
        onChange={(e) => dispatch({ type: 'SET_PROBLEM', text: e.target.value })}
        placeholder="Topic or concept you're studying..."
        className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      <p className="mt-1 text-xs text-gray-400">
        Draw notes on the canvas below. Select a region and click <strong>Ask About This</strong> to get an explanation.
      </p>
    </div>
  );
}
