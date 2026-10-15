import type { LearnerProfile, ProfileTopic, TopicRating } from '@/types';

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
  !profile.aboutMe.trim() && !profile.topics.some((topic) => topic.rating);

/** The profile with one catalog topic rated, or unrated (null), which drops it. */
export function rateTopic(profile: LearnerProfile, area: string, name: string, rating: TopicRating | null, now = Date.now()): LearnerProfile {
  const id = topicId(area, name);
  const others = profile.topics.filter((topic) => topic.id !== id);
  const existing = profile.topics.find((topic) => topic.id === id);
  // A topic the student added stays when unrated; a catalog topic only exists while rated.
  const keep = rating || existing?.area === OWN_AREA;
  const topics = keep ? [...others, { id, name: existing?.name ?? name, area: existing?.area ?? area, rating }] : others;
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
 * What the tutor reads: the student's words and their ratings, grouped by rating. Empty when there
 * is nothing to say or the student turned sharing off.
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
  return lines.join('\n');
}
