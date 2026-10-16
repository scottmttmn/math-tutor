import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { askChoices, askQuestion } = load('src/lib/tutorAsk.ts');

test('Ask tutor offers a hint, a check, feedback or your own question on a problem', () => {
  assert.deepEqual(askChoices('problem').map((choice) => choice.label), ['Hint', 'Check my work', 'Feedback', 'Ask…']);
  assert.equal(askQuestion('hint', 'problem'), 'Can you give me a hint?');
  assert.equal(askQuestion('check', 'problem'), 'Is my work right? Please check it.');
  assert.equal(askQuestion('feedback', 'problem'), "I'd like feedback on my work.");
});

test('notes get an explanation or a check', () => {
  assert.deepEqual(askChoices('note').map((choice) => choice.label), ['Explain this', 'Check my notes', 'Ask…']);
  assert.equal(askQuestion('explain', 'note'), 'Can you explain this?');
  assert.equal(askQuestion('check', 'note'), 'Please check my notes for mistakes.');
});
