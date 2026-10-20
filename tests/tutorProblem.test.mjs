import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { parseMadeProblem, topicChoices, favoriteChoices } = load('src/lib/tutorProblem.ts', {
  '@/lib/db': { saveSession: async () => {} },
  '@/lib/currentBoard': { setBoardToOpen: () => {} },
});
const { emptyProfile, rateTopic, noteTopic, setFavorite } = load('src/lib/learnerProfile.ts');
const { planTutorRequest } = load('src/lib/tutorPrompt.ts');

test('the tutor\'s reply splits into the board\'s title and its problem', () => {
  assert.deepEqual(parseMadeProblem('Title: A contour integral\n\nEvaluate \\(\\oint_{|z|=2} \\frac{e^z}{z^2+1}\\,dz\\).'),
    { title: 'A contour integral', problem: 'Evaluate \\(\\oint_{|z|=2} \\frac{e^z}{z^2+1}\\,dz\\).' });
  assert.deepEqual(parseMadeProblem('**Title:** Sums of squares\nShow that 3 is not a sum of two squares.'),
    { title: 'Sums of squares', problem: 'Show that 3 is not a sum of two squares.' });
  // Without a title line it is all problem; a code fence a model adds anyway goes.
  assert.deepEqual(parseMadeProblem('```\nFind \\(x\\) with \\(2x = 4\\).\n```'), { title: '', problem: 'Find \\(x\\) with \\(2x = 4\\).' });
  // Mid-stream, the title line may not be finished yet.
  assert.deepEqual(parseMadeProblem('Title: Sum'), { title: 'Sum', problem: '' });
});

test('the form offers the topics a check-in would, with why, and the newest favorites', () => {
  let profile = emptyProfile();
  profile = rateTopic(profile, 'Calculus', 'Limits', 'rusty');
  profile = rateTopic(profile, 'Calculus', 'Derivatives', 'solid');
  profile = noteTopic(profile, { topic: 'Integrals', level: 'learning', confidence: 'medium', note: '' });
  assert.deepEqual(topicChoices(profile), [{ name: 'Limits', label: 'Rusty' }, { name: 'Integrals', label: 'tutor: Learning' }]);
  assert.deepEqual(topicChoices(undefined), []);
  profile = setFavorite(profile, { id: 'a', title: 'Fixed points', problem: '', reason: '' }, 1);
  profile = setFavorite(profile, { id: 'b', title: 'Ex. 3.4', problem: '', reason: '' }, 2);
  assert.deepEqual(favoriteChoices(profile), ['Ex. 3.4', 'Fixed points']);
});

test('writing a problem reads the memory and the request, and nothing from a board', () => {
  const plan = planTutorRequest({
    makeProblem: { topic: 'Residues', like: 'Fixed points', ask: 'make it  hard', avoid: ['Evaluate \\(\\int_0^1 x\\,dx\\).'] },
    problemStatement: 'Old problem', chatHistory: [{ role: 'user', content: 'Earlier' }], canvasImage: 'board',
    learnerProfile: 'About me: likes proofs', takeNotes: true, checkIn: { topics: ['Limits'] },
    modelConfig: { provider: 'anthropic', model: 'test' },
  });
  assert.match(plan.systemPrompt, /Write ONE problem/);
  assert.match(plan.systemPrompt, /LEARNER PROFILE/);
  assert.doesNotMatch(plan.systemPrompt, /TOPIC NOTES|SKILL CHECK-IN|The answer is theirs to find/);
  assert.match(plan.profile, /likes proofs/);
  assert.deepEqual(plan.history, []);
  assert.deepEqual(plan.board, []);
  assert.equal(plan.reference, '');
  assert.equal(plan.question, 'Write me a problem on Residues.\nMake it like my favorite "Fixed points".\nAlso: make it hard\nNot one of these, which I was already offered:\n- Evaluate \\(\\int_0^1 x\\,dx\\).');
  // No topic leaves it to the tutor; no memory, no profile rule.
  const open = planTutorRequest({ makeProblem: { topic: '' }, problemStatement: '', chatHistory: [], canvasImage: '', modelConfig: { provider: 'anthropic', model: 'test' } });
  assert.equal(open.question, 'Write me a problem. You choose the topic.');
  assert.doesNotMatch(open.systemPrompt, /LEARNER PROFILE/);
});
