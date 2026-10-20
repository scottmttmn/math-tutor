import { checkInCandidates } from '@/lib/checkIn';
import { RATINGS } from '@/lib/learnerProfile';
import type { LearnerProfile } from '@/types';

/** How many topics and favorites the Problem from tutor form offers. */
export const MAX_TOPIC_CHOICES = 6;
export const MAX_FAVORITE_CHOICES = 3;

export interface TopicChoice {
  name: string;
  /** Why it is offered: the student's rating, or the tutor's read ("tutor: Learning"). */
  label: string;
}

/**
 * Topics worth a problem, from the tutor memory: the ones a check-in would offer (rated Rusty or
 * Learning, the student's own unrated ones, those the tutor isn't sure of), each with why.
 */
export function topicChoices(profile: LearnerProfile | null | undefined): TopicChoice[] {
  if (!profile) return [];
  const level = (rating: string) => RATINGS.find((option) => option.rating === rating)?.label ?? rating;
  return checkInCandidates(profile).slice(0, MAX_TOPIC_CHOICES).map(({ name, rating, tutor }) => ({
    name,
    label: tutor ? `tutor: ${level(tutor.level)}` : rating ? level(rating) : '',
  }));
}

/** The newest favorites' titles, for "Like a favorite". */
export const favoriteChoices = (profile: LearnerProfile | null | undefined): string[] =>
  [...new Set((profile?.favorites ?? []).map((favorite) => favorite.title.trim()).filter(Boolean))].slice(0, MAX_FAVORITE_CHOICES);

/**
 * The tutor's reply split into the board's title and its problem. The reply should open with
 * "Title: …"; one that doesn't is all problem. Code fences a model adds anyway are dropped.
 */
export function parseMadeProblem(reply: string): { title: string; problem: string } {
  const text = reply.replace(/^\s*```[a-z]*\s*\n?|\n?```\s*$/gi, '').trim();
  const match = /^\**title\**\s*:\s*\**(.+?)\**\s*(?:\n|$)/i.exec(text);
  if (!match) return { title: '', problem: text };
  return { title: match[1].trim().slice(0, 80), problem: text.slice(match[0].length).trim() };
}
