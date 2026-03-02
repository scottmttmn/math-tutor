'use client';

import { useSessionState, useSessionDispatch } from '@/context/SessionContext';

export default function ProblemStatement() {
  const { problemStatement } = useSessionState();
  const dispatch = useSessionDispatch();

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
    </div>
  );
}
