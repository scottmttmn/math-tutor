import type { SessionType, TutorIntent } from '@/types';

/** A choice in the tutor drawer, sent with the board. */
export interface AskChoice {
  intent: TutorIntent;
  label: string;
}

/** What Ask tutor offers: problems get a hint, a check or feedback; notes get an explanation or a check. */
export function askChoices(sessionType: SessionType): AskChoice[] {
  return sessionType === 'note'
    ? [
        { intent: 'explain', label: 'Explain this' },
        { intent: 'check', label: 'Check my notes' },
      ]
    : [
        { intent: 'hint', label: 'Hint' },
        { intent: 'check', label: 'Check my work' },
        { intent: 'feedback', label: 'Feedback' },
      ];
}

/** The short choices in the menu under a lasso selection (Scott, 2026-11-08): a hint or a check; on notes, an explanation. */
export function selectionChoices(sessionType: SessionType): AskChoice[] {
  return sessionType === 'note'
    ? [{ intent: 'explain', label: 'Explain' }]
    : [{ intent: 'hint', label: 'Hint' }, { intent: 'check', label: 'Check' }];
}

/** The question a choice sends, which is also what the chat shows as the student's message. */
export function askQuestion(intent: TutorIntent, sessionType: SessionType): string {
  if (sessionType === 'note') {
    return intent === 'check' ? 'Please check my notes for mistakes.' : 'Can you explain this?';
  }
  switch (intent) {
    case 'check': return 'Is my work right? Please check it.';
    case 'feedback': return "I'd like feedback on my work.";
    case 'explain': return 'Can you explain this?';
    default: return 'Can you give me a hint?';
  }
}

/**
 * The problem text the tutor gets for a problem marked in notes: its name, and that the problem itself
 * may only be in the work (often from a print book the tutor can't see).
 */
export function markedProblem(title: string): string {
  return `A problem the student marked in their notebook as "${title}". Its statement may not be written out: work out what the problem is from the work, and if you can't tell, say so plainly instead of guessing.`;
}
