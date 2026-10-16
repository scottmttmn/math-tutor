import type { SessionType, TutorIntent } from '@/types';

/** One line of the Ask tutor menu: a request sent with the board, or `own` to type or say a question. */
export interface AskChoice {
  intent: TutorIntent | 'own';
  label: string;
}

/** What Ask tutor offers: problems get a hint, a check or feedback; notes get an explanation or a check. */
export function askChoices(sessionType: SessionType): AskChoice[] {
  return sessionType === 'note'
    ? [
        { intent: 'explain', label: 'Explain this' },
        { intent: 'check', label: 'Check my notes' },
        { intent: 'own', label: 'Ask…' },
      ]
    : [
        { intent: 'hint', label: 'Hint' },
        { intent: 'check', label: 'Check my work' },
        { intent: 'feedback', label: 'Feedback' },
        { intent: 'own', label: 'Ask…' },
      ];
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
