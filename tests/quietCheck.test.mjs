import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { parseQuietCheck, workKey, countToday, shownCheck } = load('src/lib/quietCheck.ts');
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
