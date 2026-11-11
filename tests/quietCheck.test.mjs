import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { parseQuietCheck, workKey, countToday, shownCheck, unreadSolved } = load('src/lib/quietCheck.ts');
const { planTutorRequest } = load('src/lib/tutorPrompt.ts');
const { toHistoryItem, markedItems, queryHistory } = load('src/lib/history.ts');

test('a quiet check reply becomes a verdict; where only for look, never anything else', () => {
  assert.deepEqual(parseQuietCheck('Result: look\nWhere: the second line, the sign of 3x'), { result: 'look', where: 'the second line, the sign of 3x' });
  assert.deepEqual(parseQuietCheck('**Result:** right'), { result: 'right' });
  assert.deepEqual(parseQuietCheck('Result: right\nWhere: nowhere'), { result: 'right' });
  assert.deepEqual(parseQuietCheck('result: UNCLEAR'), { result: 'unclear' });
  assert.deepEqual(parseQuietCheck('Result: look'), { result: 'look' });
  assert.equal(parseQuietCheck('Looks good to me!'), null);
});

test('the same work has the same key; the daily count starts again each day', () => {
  assert.equal(workKey('abc'), workKey('abc'));
  assert.notEqual(workKey('abc'), workKey('abd'));
  assert.equal(countToday({ day: '2026-11-11', count: 4 }, '2026-11-11'), 4);
  assert.equal(countToday({ day: '2026-11-10', count: 4 }, '2026-11-11'), 0);
  assert.equal(countToday(undefined, '2026-11-11'), 0);
});

test('a quiet check request reads only the problem and the work', () => {
  const plan = planTutorRequest({
    quietCheck: true, problemStatement: 'Solve x^2 = 4', chatHistory: [{ role: 'user', content: 'old' }],
    canvasImage: 'IMG', learnerProfile: 'About me', takeNotes: true, sessionType: 'note', modelConfig: { provider: 'anthropic', model: 'test' },
  });
  assert.match(plan.systemPrompt, /quietly read/);
  assert.doesNotMatch(plan.systemPrompt, /<memory>|learner profile/i);
  assert.deepEqual(plan.history, []);
  assert.equal(plan.profile, '');
  assert.ok(JSON.stringify(plan.board).includes('Solve x^2 = 4') && JSON.stringify(plan.board).includes('IMG'));
});

const session = (overrides) => ({
  id: 'a', title: 'Untitled', problemStatement: '', problemImage: null, canvasStrokes: [], canvasDocument: null,
  canvasImageBlob: null, chatHistory: [], createdAt: 1, updatedAt: 1, ...overrides,
});
const look = { result: 'look', where: 'line 2', at: 5, work: 'w' };

test('Home shows a check only while solved, and Second look lists solved problems to look at again', () => {
  const solved = toHistoryItem(session({ id: 's', isSolved: true, quietChecks: { board: look } }));
  const reopened = toHistoryItem(session({ id: 'o', isSolved: false, quietChecks: { board: look } }));
  const fine = toHistoryItem(session({ id: 'f', isSolved: true, quietChecks: { board: { ...look, result: 'right' } } }));
  assert.deepEqual(solved.check, look);
  assert.equal(reopened.check, undefined);
  assert.deepEqual(queryHistory([solved, reopened, fine], { search: '', show: 'secondLook', sort: 'updated' }).map((item) => item.id), ['s']);
  // A board of several: an exercise to look at again shows first.
  assert.equal(shownCheck({ a: { ...look, result: 'right', at: 9 }, b: look }, ['a', 'b']).result, 'look');
  assert.equal(shownCheck({ board: look }, ['other']), undefined);
  // One exercise left of a board of several keeps its own verdict.
  const survivor = toHistoryItem(session({ id: 'v', isSolved: true, problems: [{ id: 'ex2', label: '#2', isSolved: true }], currentProblem: 'ex2', quietChecks: { ex2: look } }));
  assert.deepEqual(survivor.check, look);
});

test('a marked problem shows its own check while it is solved', () => {
  const stroke = (id, y) => ({ id, tool: 'pen', color: 'black', width: 2, points: [10, y, 0.5, 50, y, 0.5] });
  const ink = {
    version: 1, page: { left: 0, top: 0, width: 960, pages: 1 }, strokes: [stroke('s1', 100), stroke('s2', 300)], images: [],
    marks: [{ id: 'm1', label: '#1', items: ['s1'], solved: true }, { id: 'm2', label: '#2', items: ['s2'] }],
  };
  const [one, two] = markedItems(session({ id: 'n', sessionType: 'note', ink, quietChecks: { m1: look, m2: look, board: look } }));
  assert.deepEqual(one.check, look);
  assert.equal(two.check, undefined);
});

test('solved but not checked: boards with ink, each solved exercise, solved marks; nothing else', () => {
  const stroke = (id) => ({ id, tool: 'pen', color: 'black', width: 2, points: [10, 10, 0.5, 40, 40, 0.5] });
  const ink = (strokes, marks) => ({ page: { left: 0, top: 0, width: 960 }, strokes, images: [], ...(marks ? { marks } : {}) });
  const base = { title: '', problemStatement: 'x^2 = 4', chatHistory: [], createdAt: 1, updatedAt: 1 };
  const sessions = [
    { ...base, id: 'solved', isSolved: true, ink: ink([stroke('a')]) },
    { ...base, id: 'read', isSolved: true, ink: ink([stroke('a')]), quietChecks: { board: { result: 'right', at: 1, work: 'w' } } },
    { ...base, id: 'open', ink: ink([stroke('a')]) },
    { ...base, id: 'empty', isSolved: true, ink: ink([]) },
    { ...base, id: 'old', isSolved: true },
    { ...base, id: 'several', isSolved: true, ink: ink([stroke('a')]), problems: [{ id: 'e1', label: '1', problemStatement: 'Exercise 1', problemImage: null, isSolved: true }, { id: 'e2', label: '2', problemStatement: 'Exercise 2', problemImage: null }] },
    { ...base, id: 'checkin', isSolved: true, ink: ink([stroke('a')]), checkIn: { topics: [] } },
    { ...base, id: 'notes', sessionType: 'note', ink: ink([stroke('a'), stroke('b'), stroke('c')], [
      { id: 'm1', label: '#55', book: 'Stewart 4.2', items: ['a'], solved: true },
      { id: 'm2', label: '#56', items: ['b'], solved: true },
      { id: 'm3', label: '#57', items: ['c'] },
      { id: 'm4', label: '#58', items: ['gone'], solved: true },
    ]), quietChecks: { m2: { result: 'look', at: 1, work: 'w' } } },
  ];
  const found = unreadSolved(sessions);
  assert.deepEqual(found.map((item) => `${item.sessionId}/${item.key}`), ['solved/board', 'several/e1', 'notes/m1']);
  assert.equal(found[1].problemStatement, 'Exercise 1');
  assert.deepEqual(found[2].items, ['a']);
  assert.match(found[2].problemStatement, /#55 · Stewart 4\.2/);
});
