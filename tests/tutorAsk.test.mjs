import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { askChoices, askQuestion } = load('src/lib/tutorAsk.ts');

test('Ask tutor offers a hint, a check, feedback on a problem', () => {
  assert.deepEqual(askChoices('problem').map((choice) => choice.label), ['Hint', 'Check my work', 'Feedback']);
  assert.equal(askQuestion('hint', 'problem'), 'Can you give me a hint?');
  assert.equal(askQuestion('check', 'problem'), 'Is my work right? Please check it.');
  assert.equal(askQuestion('feedback', 'problem'), "I'd like feedback on my work.");
});

test('notes get an explanation or a check', () => {
  assert.deepEqual(askChoices('note').map((choice) => choice.label), ['Explain this', 'Check my notes']);
  assert.equal(askQuestion('explain', 'note'), 'Can you explain this?');
  assert.equal(askQuestion('check', 'note'), 'Please check my notes for mistakes.');
});

test('first autosave keeps the conversation identity; New and Load reset it', () => {
  const { sessionReducer, initialState } = load('src/context/SessionContext.tsx');
  const saved = sessionReducer(initialState, { type: 'SET_CURRENT_SESSION_ID', id: 'saved' });
  assert.equal(saved.conversationKey, initialState.conversationKey);
  const fresh = sessionReducer(saved, { type: 'NEW_SESSION' });
  assert.notEqual(fresh.conversationKey, saved.conversationKey);
  const loaded = sessionReducer(fresh, { type: 'LOAD_SESSION', sessionId: 'another', problemStatement: '', chatHistory: [], problemImage: null });
  assert.notEqual(loaded.conversationKey, fresh.conversationKey);
});
