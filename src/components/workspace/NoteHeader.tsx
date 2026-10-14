'use client';

import { useSessionState, useSessionDispatch } from '@/context/SessionContext';

export default function NoteHeader() {
  const { problemStatement } = useSessionState();
  const dispatch = useSessionDispatch();

  return (
    <div className="px-3 py-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">
        Topic
      </label>
      <input
        type="text"
        value={problemStatement}
        onChange={(e) => dispatch({ type: 'SET_PROBLEM', text: e.target.value })}
        placeholder="Topic or concept you're studying..."
        className="w-full min-h-11 px-3 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
      />
      <p className="mt-1 text-xs text-gray-500">
        Write your notes on the board. Select a region and press <strong className="text-indigo-700">Ask tutor</strong> for an explanation.
      </p>
    </div>
  );
}
