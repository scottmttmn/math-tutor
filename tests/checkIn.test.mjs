import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const saved = [];
let boardToOpen = null;
const { checkInCandidates, checkInTitle, checkInStarted, startCheckIn, MAX_CHECK_IN_TOPICS } = load('src/lib/checkIn.ts', {
  '@/lib/db': { saveSession: async (session) => { saved.push(session); } },
  '@/lib/currentBoard': { setBoardToOpen: (id) => { boardToOpen = id; } },
});
const { emptyProfile, rateTopic, addOwnTopic, noteTopic, setTutorLevel } = load('src/lib/learnerProfile.ts');

test('a check-in offers the topics nobody is sure about', () => {
  let profile = emptyProfile();
  profile = rateTopic(profile, 'Calculus', 'Limits', 'rusty');
  profile = rateTopic(profile, 'Calculus', 'Derivatives', 'solid');
  profile = rateTopic(profile, 'Calculus', 'Integrals', 'learning');
  profile = rateTopic(profile, 'Calculus', 'Infinite series', 'never');
  profile = addOwnTopic(profile, 'Fourier series');
  // The tutor's read beats the self-rating: sure means skip, unsure means check.
  profile = noteTopic(profile, { topic: 'Integrals', level: 'solid', confidence: 'high', note: '' });
  profile = noteTopic(profile, { topic: 'Derivatives', level: 'rusty', confidence: 'low', note: '' });
  profile = noteTopic(profile, { topic: 'Factoring', level: 'learning', confidence: 'medium', note: '' });
  profile = noteTopic(profile, { topic: 'Quadratics', level: 'learning', confidence: 'low', note: '' });
  // A level the student set themselves is not questioned.
  profile = setTutorLevel(profile, 'algebra/quadratics', 'solid');
  assert.deepEqual(checkInCandidates(profile).map((topic) => topic.name), ['Factoring', 'Limits', 'Derivatives', 'Fourier series']);
  // A topic of the student's own with a catalog topic's name is offered once.
  assert.deepEqual(checkInCandidates(addOwnTopic(profile, 'limits')).map((topic) => topic.name), ['Factoring', 'Limits', 'Derivatives', 'Fourier series']);
});

test('starting a check-in saves its board and opens it next', async () => {
  const id = await startCheckIn(['Limits', 'limits ', 'Integrals', 'Factoring', 'Vectors', 'Matrices'], 5);
  assert.equal(boardToOpen, id);
  assert.equal(saved[0].id, id);
  assert.deepEqual(saved[0].checkIn, { topics: ['Limits', 'Integrals', 'Factoring', 'Vectors'].slice(0, MAX_CHECK_IN_TOPICS) });
  assert.equal(saved[0].title, 'Skill check-in: Limits, Integrals, Factoring, Vectors');
  assert.deepEqual([saved[0].chatHistory, saved[0].createdAt, saved[0].sessionType], [[], 5, 'problem']);
  assert.equal(checkInTitle({ topics: ['x'.repeat(100)] }).length, 80);
});

test('a check-in has started only once a first problem arrived, not after a failed request', () => {
  const user = { id: 'u', role: 'user', content: 'Start the check-in.', timestamp: 1 };
  assert.equal(checkInStarted([]), false);
  assert.equal(checkInStarted([user, { id: 'a', role: 'assistant', content: '\n\nError: Please wait a moment.', timestamp: 2 }]), false);
  assert.equal(checkInStarted([user, { id: 'a', role: 'assistant', content: '', timestamp: 2, pending: true }]), false);
  assert.equal(checkInStarted([user, { id: 'a', role: 'assistant', content: 'Problem 1 (Limits): …', timestamp: 2 }]), true);
});
