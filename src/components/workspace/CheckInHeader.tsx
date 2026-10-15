'use client';

import type { CheckIn } from '@/types';

/** The source of a check-in board: its topics and how it works. The problems themselves come from the tutor. */
export default function CheckInHeader({ checkIn, started }: { checkIn: CheckIn; started: boolean }) {
  return (
    <div className="px-3 py-2 text-sm text-gray-700">
      <p className="font-medium text-gray-900">Skill check-in</p>
      <ul className="mt-1 list-disc pl-5">
        {checkIn.topics.map((topic) => <li key={topic}>{topic}</li>)}
      </ul>
      <p className="mt-2 text-gray-600">
        {started
          ? <>Write your answer on the board and press <strong className="text-indigo-700">Ask tutor</strong> to hand it in. Say so in the chat if you haven&apos;t met a topic, or want to stop.</>
          : <>Press <strong className="text-indigo-700">Ask tutor</strong> for the first problem. Answer each one by hand; the tutor checks it, picks the next, and notes what it learns in your tutor memory.</>}
      </p>
    </div>
  );
}
