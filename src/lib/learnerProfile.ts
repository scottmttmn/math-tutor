import type { FavoriteProblem, LearnerProfile, ProfileTopic, TopicRating, TutorConfidence, TutorNote } from '@/types';

// Topics a self-motivated learner might rate, roughly from school math to university courses.
// Ratings are stored by id, so ids must not change; names and areas can.
export const TOPIC_AREAS: { area: string; topics: string[] }[] = [
  { area: 'Foundations', topics: ['Fractions and decimals', 'Ratios and percent', 'Exponents and roots', 'Negative numbers', 'Order of operations'] },
  { area: 'Algebra', topics: ['Linear equations', 'Inequalities', 'Systems of equations', 'Factoring', 'Quadratics', 'Polynomials', 'Rational expressions', 'Exponentials and logarithms', 'Functions and graphs', 'Sequences and series'] },
  { area: 'Geometry', topics: ['Angles and triangles', 'Similarity and congruence', 'Circles', 'Area and volume', 'Coordinate geometry', 'Geometric proofs'] },
  { area: 'Trigonometry', topics: ['Right-triangle trigonometry', 'The unit circle', 'Trig identities', 'Trig equations', 'Polar coordinates'] },
  { area: 'Calculus', topics: ['Limits', 'Derivatives', 'Applications of derivatives', 'Integrals', 'Integration techniques', 'Applications of integrals', 'Infinite series', 'Multivariable calculus', 'Vector calculus'] },
  { area: 'Linear algebra', topics: ['Vectors', 'Matrices', 'Linear systems', 'Determinants', 'Vector spaces', 'Linear maps', 'Eigenvalues and eigenvectors'] },
  { area: 'Differential equations', topics: ['First-order equations', 'Linear equations with constant coefficients', 'Systems of differential equations', 'Laplace transforms', 'Partial differential equations'] },
  { area: 'Probability and statistics', topics: ['Counting', 'Probability', 'Random variables', 'Distributions', 'Statistics'] },
  { area: 'Proofs and discrete math', topics: ['Logic and quantifiers', 'Proof techniques', 'Induction', 'Sets and functions', 'Graph theory', 'Number theory'] },
  { area: 'Higher math', topics: ['Real analysis', 'Complex analysis', 'Abstract algebra', 'Topology'] },
];

/** The area for topics the student adds themselves. */
export const OWN_AREA = 'Your topics';

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Catalog ids are readable slugs; the student's own keep the whole name (lowercased), so "C++" and "C#" stay apart. */
export const topicId = (area: string, name: string) =>
  `${slug(area)}/${area === OWN_AREA ? encodeURIComponent(name.trim().toLowerCase()) : slug(name)}`;

export const RATINGS: { rating: TopicRating; label: string; meaning: string }[] = [
  { rating: 'solid', label: 'Solid', meaning: 'I know this well' },
  { rating: 'rusty', label: 'Rusty', meaning: 'I knew it once' },
  { rating: 'learning', label: 'Learning', meaning: 'Working on it now' },
  { rating: 'never', label: 'Never seen', meaning: 'Haven’t met it yet' },
];

export const MAX_ABOUT_ME = 1500;
const MAX_TOPIC_NAME = 80;

export const emptyProfile = (): LearnerProfile => ({ aboutMe: '', topics: [], shareWithTutor: true, updatedAt: 0 });

/** True when the student hasn't told the tutor anything yet. */
export const isProfileEmpty = (profile: LearnerProfile) =>
  !profile.aboutMe.trim() && !profile.topics.some((topic) => topic.rating || topic.tutor)
  && !profile.favorites?.length && !profile.notebook?.text.trim();

/** The profile with one catalog topic rated, or unrated (null), which drops it. */
export function rateTopic(profile: LearnerProfile, area: string, name: string, rating: TopicRating | null, now = Date.now()): LearnerProfile {
  const id = topicId(area, name);
  const others = profile.topics.filter((topic) => topic.id !== id);
  const existing = profile.topics.find((topic) => topic.id === id);
  // A topic the student added stays when unrated; a catalog topic only exists while rated or noted by the tutor.
  const keep = rating || existing?.area === OWN_AREA || existing?.tutor;
  const topics = keep ? [...others, { ...existing, id, name: existing?.name ?? name, area: existing?.area ?? area, rating }] : others;
  return { ...profile, topics: sortTopics(topics), updatedAt: now };
}

/** The profile with a topic of the student's own added (unrated); unchanged when it is already there. */
export function addOwnTopic(profile: LearnerProfile, name: string, now = Date.now()): LearnerProfile {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_NAME);
  if (!clean) return profile;
  const id = topicId(OWN_AREA, clean);
  if (profile.topics.some((topic) => topic.id === id)) return profile;
  return { ...profile, topics: sortTopics([...profile.topics, { id, name: clean, area: OWN_AREA, rating: null }]), updatedAt: now };
}

export const CONFIDENCES: { confidence: TutorConfidence; label: string }[] = [
  { confidence: 'low', label: 'a first impression' },
  { confidence: 'medium', label: 'fairly sure' },
  { confidence: 'high', label: 'sure' },
];
const MAX_NOTE = 200;
const MAX_NOTES_SENT = 25;
// The tutor can't fill the memory with topics: past this many, it only updates ones already there.
const MAX_TOPICS = 150;

const nameKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** One topic the tutor wrote about at the end of a reply. */
export interface TopicObservation { topic: string; level: TopicRating; confidence: TutorConfidence; note: string }

/**
 * The profile with the tutor's latest read of a topic. It lands on a catalog topic or one already in
 * the profile with that name, else on a new topic of the student's own; it replaces an earlier note.
 */
export function noteTopic(profile: LearnerProfile, observation: TopicObservation, now = Date.now()): LearnerProfile {
  const name = observation.topic.replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC_NAME);
  if (!name) return profile;
  const key = nameKey(name);
  const catalog = TOPIC_AREAS.find((item) => item.topics.some((topic) => nameKey(topic) === key));
  const catalogName = catalog?.topics.find((topic) => nameKey(topic) === key);
  const existing = profile.topics.find((topic) => nameKey(topic.name) === key);
  if (!existing && profile.topics.length >= MAX_TOPICS) return profile;
  const area = existing?.area ?? catalog?.area ?? OWN_AREA;
  const topicName = existing?.name ?? catalogName ?? name;
  const tutor: TutorNote = { level: observation.level, confidence: observation.confidence, note: observation.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE), updatedAt: now };
  const topic: ProfileTopic = { id: existing?.id ?? topicId(area, topicName), name: topicName, area, rating: existing?.rating ?? null, tutor };
  return { ...profile, topics: sortTopics([...profile.topics.filter((item) => item !== existing), topic]), updatedAt: now };
}

/** The student corrects the tutor's level; the note stays, marked as theirs. */
export function setTutorLevel(profile: LearnerProfile, id: string, level: TopicRating, now = Date.now()): LearnerProfile {
  return {
    ...profile,
    topics: profile.topics.map((topic) => topic.id === id && topic.tutor ? { ...topic, tutor: { ...topic.tutor, level, edited: true, updatedAt: now } } : topic),
    updatedAt: now,
  };
}

/** Drops the tutor's note; a catalog topic the student never rated goes with it. */
export function forgetTutorNote(profile: LearnerProfile, id: string, now = Date.now()): LearnerProfile {
  const topics = profile.topics.flatMap((topic) => {
    if (topic.id !== id) return [topic];
    if (!topic.rating && topic.area !== OWN_AREA) return [];
    const rest = { ...topic };
    delete rest.tutor;
    return [rest];
  });
  return { ...profile, topics, updatedAt: now };
}

const LEVELS = new Set<string>(RATINGS.map((option) => option.rating));
const CONFIDENCE_SET = new Set<string>(CONFIDENCES.map((option) => option.confidence));
// The blocks a reply can end with: topic notes, and the tutor's notebook rewritten whole.
const NOTES_BLOCK = 'memory';
const NOTEBOOK_BLOCK = 'notebook';
const OPENERS = [NOTES_BLOCK, NOTEBOOK_BLOCK].map((name) => `<${name}>`);

/** Takes one block out of a reply: what is left, and its body (null when absent; open when the reply stops inside it). */
function takeBlock(raw: string, name: string): { rest: string; body: string | null; closed: boolean } {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const start = raw.indexOf(open);
  if (start < 0) return { rest: raw, body: null, closed: false };
  const end = raw.indexOf(close, start);
  const body = raw.slice(start + open.length, end < 0 ? undefined : end);
  return { rest: raw.slice(0, start) + (end < 0 ? '' : raw.slice(end + close.length)), body, closed: end >= 0 };
}

/**
 * Splits a tutor reply into what the student reads and what it ended with for the memory: a <memory>
 * block of lines "Topic | level | confidence | note" (malformed lines are ignored), and a <notebook>
 * block with the whole notebook rewritten (kept only once closed, so a cut-off reply never shortens it).
 */
export function splitTutorNotes(raw: string): { visible: string; notes: TopicObservation[]; notebook: string | null } {
  const memory = takeBlock(raw, NOTES_BLOCK);
  const book = takeBlock(memory.rest, NOTEBOOK_BLOCK);
  const notes = (memory.body ?? '').split('\n').flatMap((line): TopicObservation[] => {
    const [topic, level, confidence, ...note] = line.replace(/^\s*[-*]\s*/, '').split('|').map((part) => part.trim());
    const levelKey = level?.toLowerCase().replace(/^never seen$/, 'never');
    if (!topic || !LEVELS.has(levelKey) || !CONFIDENCE_SET.has(confidence?.toLowerCase())) return [];
    return [{ topic, level: levelKey as TopicRating, confidence: confidence.toLowerCase() as TutorConfidence, note: note.join('|').trim() }];
  });
  const notebook = book.closed ? book.body?.trim() || null : null;
  return { visible: withoutPartialTag(book.rest), notes: notes.slice(0, 5), notebook };
}

/** While a reply streams, holds back what might be the start of a block. */
function withoutPartialTag(raw: string) {
  for (const opener of OPENERS) {
    for (let length = Math.min(opener.length - 1, raw.length); length > 0; length--) {
      if (raw.endsWith(opener.slice(0, length))) return raw.slice(0, -length).trimEnd();
    }
  }
  return raw.trimEnd();
}

export const MAX_NOTEBOOK = 1500;

/** The profile with the notebook replaced; empty text removes it. `edited`: the student wrote this version. */
export function writeNotebook(profile: LearnerProfile, text: string, edited: boolean, now = Date.now()): LearnerProfile {
  // The student's text is kept as typed (trimming each keystroke would eat spaces).
  const clean = (edited ? text : text.trim()).slice(0, MAX_NOTEBOOK);
  const rest = { ...profile, updatedAt: now };
  delete rest.notebook;
  return clean.trim() ? { ...rest, notebook: { text: clean, updatedAt: now, ...(edited ? { edited: true } : {}) } } : rest;
}

export const MAX_FAVORITE_REASON = 300;
const MAX_FAVORITE_LINE = 160;
// With every favorite sent, older ones go as a name and a line; the newest also carry the student's reason.
const FAVORITE_REASONS_SENT = 20;

const oneLine = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** A favorite as it is stored: one line each, the reason bounded. */
export function favoriteEntry(id: string, title: string, problem: string, reason: string, createdAt: number): FavoriteProblem {
  return { id, title: oneLine(title, MAX_FAVORITE_LINE), problem: oneLine(problem, MAX_FAVORITE_LINE), reason: oneLine(reason, MAX_FAVORITE_REASON), createdAt };
}

export const findFavorite = (profile: LearnerProfile | null | undefined, id: string | null) =>
  id ? profile?.favorites?.find((favorite) => favorite.id === id) : undefined;

/** The profile with a board starred, or its favorite updated (it keeps the day it was first starred). */
export function setFavorite(profile: LearnerProfile, favorite: Omit<FavoriteProblem, 'createdAt'>, now = Date.now()): LearnerProfile {
  const existing = findFavorite(profile, favorite.id);
  const entry = favoriteEntry(favorite.id, favorite.title, favorite.problem, favorite.reason, existing?.createdAt ?? now);
  const favorites = [entry, ...(profile.favorites ?? []).filter((item) => item.id !== favorite.id)].sort((a, b) => b.createdAt - a.createdAt);
  return { ...profile, favorites, updatedAt: now };
}

export function removeFavorite(profile: LearnerProfile, id: string, now = Date.now()): LearnerProfile {
  return { ...profile, favorites: (profile.favorites ?? []).filter((item) => item.id !== id), updatedAt: now };
}

export function removeTopic(profile: LearnerProfile, id: string, now = Date.now()): LearnerProfile {
  return { ...profile, topics: profile.topics.filter((topic) => topic.id !== id), updatedAt: now };
}

const areaOrder = (area: string) => {
  const index = TOPIC_AREAS.findIndex((item) => item.area === area);
  return index < 0 ? TOPIC_AREAS.length : index;
};
const catalogOrder = (topic: ProfileTopic) => TOPIC_AREAS.find((item) => item.area === topic.area)?.topics.indexOf(topic.name) ?? -1;

function sortTopics(topics: ProfileTopic[]) {
  return [...topics].sort((a, b) => areaOrder(a.area) - areaOrder(b.area) || catalogOrder(a) - catalogOrder(b) || a.name.localeCompare(b.name));
}

/**
 * What the tutor reads: the student's words, their ratings grouped by rating, the tutor's own
 * notes and notebook, and the problems they starred. Empty when there is nothing to say or the student turned sharing off.
 */
export function profileForTutor(profile: LearnerProfile | null | undefined): string {
  if (!profile?.shareWithTutor) return '';
  const lines: string[] = [];
  const about = profile.aboutMe.trim().slice(0, MAX_ABOUT_ME);
  if (about) lines.push(`About me (in the student's words): ${about}`);
  const rated = RATINGS
    .map(({ rating, label }) => ({ label, names: profile.topics.filter((topic) => topic.rating === rating).map((topic) => topic.name) }))
    .filter((group) => group.names.length);
  if (rated.length) {
    lines.push('How they rate their own knowledge:');
    for (const group of rated) lines.push(`- ${group.label}: ${group.names.join('; ')}`);
  }
  // The most recent notes, so a long memory stays a short read.
  const noted = profile.topics.filter((topic) => topic.tutor)
    .sort((a, b) => (b.tutor?.updatedAt ?? 0) - (a.tutor?.updatedAt ?? 0)).slice(0, MAX_NOTES_SENT);
  if (noted.length) {
    lines.push('Your notes from their earlier boards (the student sees these and can correct them):');
    for (const { name, tutor } of noted) {
      if (!tutor) continue;
      const level = RATINGS.find((option) => option.rating === tutor.level)?.label ?? tutor.level;
      const how = tutor.edited ? 'set by the student' : `${tutor.confidence} confidence`;
      lines.push(`- ${name}: ${level} (${how})${tutor.note ? `: ${tutor.note}` : ''}`);
    }
  }
  const notebook = profile.notebook?.text.trim();
  if (notebook) {
    lines.push(`Your notebook about them (${profile.notebook?.edited ? 'last edited by the student' : 'you wrote it; the student can read and edit it'}):`);
    lines.push(notebook.slice(0, MAX_NOTEBOOK));
  }
  // Last, so if the whole profile is ever cut short, the oldest favorites go first.
  const favorites = profile.favorites ?? [];
  if (favorites.length) {
    lines.push('Problems they marked as favorites, newest first:');
    favorites.forEach(({ title, problem, reason }, index) => {
      const what = problem && problem !== title ? `${title}: ${problem}` : title;
      lines.push(`- ${what}${reason && index < FAVORITE_REASONS_SENT ? ` (why they liked it: ${reason})` : ''}`);
    });
  }
  return lines.join('\n');
}
