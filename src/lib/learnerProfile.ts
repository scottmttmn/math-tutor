import type { LearnerProfile, ProfileTopic, TopicRating, TutorConfidence, TutorNote } from '@/types';

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
  !profile.aboutMe.trim() && !profile.topics.some((topic) => topic.rating || topic.tutor);

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
const NOTES_OPEN = '<memory>';
const NOTES_CLOSE = '</memory>';

/**
 * Splits a tutor reply into what the student reads and the topic notes it ended with: a <memory>
 * block of lines "Topic | level | confidence | note". Malformed lines are ignored.
 */
export function splitTutorNotes(raw: string): { visible: string; notes: TopicObservation[] } {
  const start = raw.indexOf(NOTES_OPEN);
  if (start < 0) return { visible: withoutPartialTag(raw), notes: [] };
  const end = raw.indexOf(NOTES_CLOSE, start);
  const block = raw.slice(start + NOTES_OPEN.length, end < 0 ? undefined : end);
  const after = end < 0 ? '' : raw.slice(end + NOTES_CLOSE.length);
  const notes = block.split('\n').flatMap((line): TopicObservation[] => {
    const [topic, level, confidence, ...note] = line.replace(/^\s*[-*]\s*/, '').split('|').map((part) => part.trim());
    const levelKey = level?.toLowerCase().replace(/^never seen$/, 'never');
    if (!topic || !LEVELS.has(levelKey) || !CONFIDENCE_SET.has(confidence?.toLowerCase())) return [];
    return [{ topic, level: levelKey as TopicRating, confidence: confidence.toLowerCase() as TutorConfidence, note: note.join('|').trim() }];
  });
  return { visible: (raw.slice(0, start) + after).trimEnd(), notes: notes.slice(0, 5) };
}

/** While a reply streams, holds back what might be the start of the notes block. */
function withoutPartialTag(raw: string) {
  for (let length = Math.min(NOTES_OPEN.length - 1, raw.length); length > 0; length--) {
    if (raw.endsWith(NOTES_OPEN.slice(0, length))) return raw.slice(0, -length).trimEnd();
  }
  return raw.trimEnd();
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
 * What the tutor reads: the student's words, their ratings grouped by rating, and the tutor's own
 * notes. Empty when there is nothing to say or the student turned sharing off.
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
  return lines.join('\n');
}
