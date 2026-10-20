'use client';

import TutorContent from '@/components/chat/TutorContent';
import UsageFooter from '@/components/chat/UsageFooter';
import type { TutorProblem } from '@/types';

interface Props {
  tutorProblem: TutorProblem;
  problem: string;
  /** The problem as it streams in; null when the tutor isn't writing one. */
  draft: string | null;
  error: string | null;
  onRetry: () => void;
  /** Asks for another problem; unset once the board has work, when a new one would leave it behind. */
  onAnother?: () => void;
}

/** A problem the tutor wrote, typeset and not editable (a new board is the way to another one). */
export default function TutorProblemHeader({ tutorProblem, problem, draft, error, onRetry, onAnother }: Props) {
  const writing = draft !== null;
  return (
    <div className="px-3 py-2 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-700">Problem</h2>
        <p className="text-xs text-gray-600 truncate">From the tutor{tutorProblem.topic ? ` · ${tutorProblem.topic}` : ''}</p>
      </div>
      {writing ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="text-sm text-indigo-700">The tutor is writing a problem…</p>
          {draft && <div className="text-base text-gray-900"><TutorContent content={draft} /></div>}
        </div>
      ) : problem ? (
        <div>
          <div data-testid="tutor-problem" className="text-base leading-relaxed text-gray-900"><TutorContent content={problem} /></div>
          {tutorProblem.usage && <UsageFooter usage={tutorProblem.usage} />}
        </div>
      ) : null}
      {error && !writing && (
        <div role="alert" className="flex items-center gap-2 text-sm text-red-700">
          <span className="flex-1">{error}</span>
          <button onClick={onRetry} className="min-h-11 px-3 text-sm text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50">Try again</button>
        </div>
      )}
      {onAnother && problem && !writing && (
        <div className="flex flex-col gap-1">
          <button
            onClick={onAnother}
            className="min-h-11 px-4 text-sm font-semibold text-indigo-700 border border-indigo-700 rounded-lg bg-white hover:bg-indigo-50"
          >
            Different problem
          </button>
          <p className="text-xs text-gray-600">Same request, a new problem. Shown until you write on the board.</p>
        </div>
      )}
    </div>
  );
}
