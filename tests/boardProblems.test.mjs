import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { boardMarkOf, pictureKey, markSolved, withoutProblem, problemsTitle } = load('src/lib/boardProblems.ts');
const { sessionReducer, initialState } = load('src/context/SessionContext.tsx');
const { toHistoryItem } = load('src/lib/history.ts');
const { folderIndex, folderSummary } = load('src/lib/folders.ts');
const { planTutorRequest } = load('src/lib/tutorPrompt.ts');

// The database is replaced by a store in memory: what the Shelf actions would write.
const sessions = new Map();
const shelf = load('src/lib/shelf.ts', {
  '@/lib/db': {
    loadSession: async (id) => sessions.get(id), saveSession: async (session) => { sessions.set(session.id, session); },
    deleteSession: async (id) => { sessions.delete(id); }, saveShelfDocument: async () => {},
    shelfSessionId: (documentId, exerciseId) => `shelf:${documentId}:${exerciseId}`,
    bookFolder: () => ({}), bookFolderId: (id) => `book:${id}`, deleteShelfDocument: async () => {}, loadShelfDocument: async () => undefined, saveFolder: async () => {},
  },
  '@/lib/pdf': { cropPage: async () => 'crop' },
  '@/lib/sessionRecovery': { discardRecoveryCopy: () => {} },
});

const problem = (id, extra = {}) => ({ id, label: `Exercise ${id}`, problemStatement: `Exercise ${id} · Book, p. 4`, problemImage: `image ${id}`, ...extra });
const board = (extra = {}) => ({
  id: 'shelf:doc:11', title: 'Exercise 11', problemStatement: 'Exercise 11 · Book, p. 4', problemImage: 'image 11', canvasStrokes: [], canvasDocument: null,
  canvasImageBlob: null, chatHistory: [], createdAt: 1, updatedAt: 2, isSolved: false, sessionType: 'problem', ...extra,
});

test('a mark added to a board is worked there; its picture is tagged with its id', () => {
  assert.equal(boardMarkOf({ id: '12', boardOf: '11' }), '11');
  assert.equal(boardMarkOf({ id: '11' }), '11');
  assert.equal(pictureKey({ id: '11' }), true);
  assert.equal(pictureKey({ id: '12', boardOf: '11' }), '12');
  assert.equal(problemsTitle([problem('11'), problem('12')]), 'Exercise 11, Exercise 12');
});

test('adding an exercise to the open board makes the board own one its first, and works on the new one', () => {
  let state = sessionReducer({ ...initialState, currentSessionId: 'shelf:doc:11' }, {
    type: 'LOAD_SESSION', sessionId: 'shelf:doc:11', problemStatement: 'Exercise 11 · Book, p. 4', problemImage: 'image 11', chatHistory: [], isSolved: true,
  });
  state = sessionReducer(state, { type: 'ADD_PROBLEM', first: { id: '11', label: 'Exercise 11' }, problem: problem('12', { isSolved: false }) });
  assert.deepEqual(state.problems.map((entry) => [entry.id, Boolean(entry.isSolved)]), [['11', true], ['12', false]]);
  assert.equal(state.currentProblem, '12');
  assert.equal(state.problemImage, 'image 12');
  assert.equal(state.isSolved, false);

  // Mark solved and the problem's text follow the current one; switching brings the other back.
  state = sessionReducer(state, { type: 'TOGGLE_SOLVED' });
  state = sessionReducer(state, { type: 'SET_PROBLEM', text: 'edited' });
  state = sessionReducer(state, { type: 'SELECT_PROBLEM', id: '11' });
  assert.equal(state.problemStatement, 'Exercise 11 · Book, p. 4');
  assert.equal(state.isSolved, true);
  assert.deepEqual(state.problems[1], problem('12', { problemStatement: 'edited', isSolved: true }));

  // Removing the current one works on the next.
  state = sessionReducer(state, { type: 'REMOVE_PROBLEM', id: '11' });
  assert.deepEqual(state.problems.map((entry) => entry.id), ['12']);
  assert.equal(state.problemStatement, 'edited');
});

test('loading a board of several opens its current problem', () => {
  const state = sessionReducer(initialState, {
    type: 'LOAD_SESSION', sessionId: 'shelf:doc:11', problemStatement: 'stale', problemImage: null, chatHistory: [], isSolved: false,
    problems: [problem('11'), problem('12', { isSolved: true })], currentProblem: '12',
  });
  assert.equal(state.problemStatement, 'Exercise 12 · Book, p. 4');
  assert.equal(state.isSolved, true);
  assert.equal(sessionReducer(state, { type: 'NEW_SESSION' }).problems, null);
});

test('Home lists a board of several once, with its count, opening its current problem', () => {
  const session = board({ problems: [problem('11', { isSolved: true }), problem('12'), problem('13')], currentProblem: '12', chatHistory: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 }] });
  const item = toHistoryItem(session);
  assert.deepEqual(item.problems, { total: 3, solved: 1 });
  assert.equal(item.exerciseId, '11');
  assert.equal(item.href, '/shelf/read?doc=doc&open=12');
  const index = folderIndex([{ id: 'book:doc', name: 'Book', parentId: null, createdAt: 1, updatedAt: 1 }], [{ id: 'doc', folderId: 'book:doc', exercises: [] }]);
  assert.deepEqual(folderSummary(index, 'book:doc', [item]), { folders: 0, books: 1, problems: 3, notes: 0, solved: 1 });
  // One exercise solved is work, though the board as a whole isn't solved yet.
  assert.equal(toHistoryItem(board({ problems: [problem('11', { isSolved: true }), problem('12')] }))?.hasWork, true);
  assert.equal(toHistoryItem(board({ problems: [problem('11'), problem('12')] })), null);
  // The mark it was made for may be gone: it is placed by its first problem.
  assert.equal(toHistoryItem(board({ problems: [problem('12')], chatHistory: session.chatHistory })).exerciseId, '12');
});

test('a mark on a shared board knows its own Solved', () => {
  const session = board({ problems: [problem('11', { isSolved: true }), problem('12')] });
  assert.equal(markSolved(session, '11'), true);
  assert.equal(markSolved(session, '12'), false);
  assert.equal(markSolved(board({ isSolved: true }), '11'), true);
  assert.equal(markSolved(undefined, '11'), false);
});

test('removing one mark keeps a shared board; removing the board removes its marks', async () => {
  sessions.clear();
  const document = { id: 'doc', exercises: [{ id: '11' }, { id: '12', boardOf: '11' }, { id: '13', boardOf: '11' }, { id: '20' }] };
  sessions.set('shelf:doc:11', board({ problems: [problem('11'), problem('12', { isSolved: true }), problem('13', { isSolved: true })], currentProblem: '11' }));
  sessions.set('shelf:doc:20', board({ id: 'shelf:doc:20' }));

  assert.deepEqual(await shelf.solvedExercises(document), ['12', '13']);
  const after = await shelf.unmarkExercise(document, '11');
  const kept = sessions.get('shelf:doc:11');
  assert.deepEqual(kept.problems.map((entry) => entry.id), ['12', '13']);
  assert.equal(kept.currentProblem, '12');
  assert.equal(kept.isSolved, true);
  assert.equal(kept.title, 'Exercise 12, Exercise 13');

  const left = await shelf.removeMarkedBoard(after, 'shelf:doc:11');
  assert.deepEqual(left.exercises.map((mark) => mark.id), ['20']);
  assert.equal(sessions.has('shelf:doc:11'), false);
  assert.ok(sessions.has('shelf:doc:20'));

  // The last mark on a board takes the board with it.
  await shelf.unmarkExercise(left, '20');
  assert.equal(sessions.has('shelf:doc:20'), false);
});

test('a board of several tells the tutor the others are on it', () => {
  const plan = planTutorRequest({
    problemStatement: 'Exercise 12 · Book, p. 4', chatHistory: [], canvasImage: '', modelConfig: {}, userQuestion: 'A hint?', otherProblems: ['Exercise 11', 'Exercise 13'],
  });
  assert.match(plan.board.at(-1).text, /My board also holds Exercise 11, Exercise 13; earlier messages may be about them\./);
  const one = planTutorRequest({ problemStatement: 'Exercise 12', chatHistory: [], canvasImage: '', modelConfig: {}, userQuestion: 'A hint?' });
  assert.doesNotMatch(one.board.at(-1).text, /also holds/);
});

test('without a shared board nothing changes', () => {
  const session = board();
  assert.equal(withoutProblem(session, '11'), session);
  assert.equal(toHistoryItem(board({ chatHistory: [{ id: 'm', role: 'user', content: 'hi', timestamp: 1 }] })).problems, undefined);
});
