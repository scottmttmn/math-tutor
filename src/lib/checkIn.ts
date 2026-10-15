import { v4 as uuidv4 } from 'uuid';
import { saveSession } from '@/lib/db';
import { setBoardToOpen } from '@/lib/currentBoard';
import type { ChatMessage, CheckIn, LearnerProfile, ProfileTopic, Session } from '@/types';

/** A check-in covers a few topics, so it stays short. */
export const MAX_CHECK_IN_TOPICS = 4;

export const checkInTitle = (checkIn: CheckIn) => `Skill check-in: ${checkIn.topics.join(', ')}`.slice(0, 80);

/**
 * Topics worth checking: the ones the student called Rusty or Learning, the student's own unrated
 * ones, and those the tutor isn't sure about yet. Solid and Never seen are skipped, as is a level
 * the student set themselves, unless the tutor's own read disagrees with low confidence.
 */
export function checkInCandidates(profile: LearnerProfile): ProfileTopic[] {
  // A topic of the student's own can share a catalog topic's name; the tutor can only tell them apart by name.
  const seen = new Set<string>();
  return profile.topics.filter(({ name, rating, tutor }) => {
    const key = name.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    if (tutor?.edited) return false;
    if (tutor && tutor.confidence !== 'high') return true;
    if (tutor) return false;
    return rating === 'rusty' || rating === 'learning' || rating === null;
  });
}

/**
 * True once the tutor has given the first problem: a reply that is more than an error. Until then
 * Ask tutor asks for the first problem again rather than handing in an answer.
 */
export const checkInStarted = (chatHistory: ChatMessage[]) =>
  chatHistory.some((message) => message.role === 'assistant' && message.content.trim() && !message.content.trim().startsWith('Error:'));

/** Saves a new check-in board on these topics and sets it as the board /board opens. Returns its id. */
export async function startCheckIn(topics: string[], now = Date.now()): Promise<string> {
  const unique = topics.filter((topic, index) => topics.findIndex((other) => other.trim().toLowerCase() === topic.trim().toLowerCase()) === index);
  const checkIn: CheckIn = { topics: unique.slice(0, MAX_CHECK_IN_TOPICS) };
  const session: Session = {
    id: uuidv4(), title: checkInTitle(checkIn), problemStatement: '', problemImage: null, canvasStrokes: [], canvasDocument: null,
    canvasImageBlob: null, chatHistory: [], createdAt: now, updatedAt: now, isSolved: false, sessionType: 'problem', checkIn,
  };
  await saveSession(session);
  setBoardToOpen(session.id);
  return session.id;
}
