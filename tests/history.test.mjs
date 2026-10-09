import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { toHistoryItem, queryHistory } = load('src/lib/history.ts');

const session = (overrides) => ({
  id: 'a', title: 'Untitled', problemStatement: '', problemImage: null, canvasStrokes: [], canvasDocument: null,
  canvasImageBlob: null, chatHistory: [], createdAt: 1, updatedAt: 1, ...overrides,
});
const withShape = { store: { 'shape:1': {} }, schema: {} };

test('workbook pages appear only once they hold work, and open in the workbook', () => {
  assert.equal(toHistoryItem(session({ id: 'workbook:cg:exercise:x1_3_2' })), null);
  assert.equal(toHistoryItem(session({ id: 'workbook:cg:activeExercise', isSolved: true })), null);
  const drawn = toHistoryItem(session({ id: 'workbook:cg:exercise:x1_3_2', canvasDocument: withShape }));
  assert.equal(drawn.href, '/workbook?open=x1_3_2');
  const reading = toHistoryItem(session({ id: 'workbook:cg:reading', sessionType: 'note', chatHistory: [{}] }));
  assert.equal(reading.href, '/workbook?open=reading');
  assert.equal(toHistoryItem(session({ id: 'board-1' })).href, null);
});

test('a given name wins over the title from the problem, and notes are never solved', () => {
  const named = toHistoryItem(session({ title: 'Find x', customTitle: 'Quadratics practice' }));
  assert.equal(named.title, 'Quadratics practice');
  assert.equal(named.renamed, true);
  assert.equal(toHistoryItem(session({ sessionType: 'note', isSolved: true })).isSolved, false);
  assert.equal(toHistoryItem(session({})).sessionType, 'problem');
});

test('search matches every word in the name or problem; filters and sorts apply', () => {
  const items = [
    session({ id: '1', title: 'Roots of unity', problemStatement: 'Find all z with z^5 = 1', isSolved: true, createdAt: 3, updatedAt: 4 }),
    session({ id: '2', title: 'Polar form', problemStatement: 'Write 1 + i in polar form', createdAt: 2, updatedAt: 6 }),
    session({ id: '3', title: 'Conjugates', sessionType: 'note', createdAt: 1, updatedAt: 5 }),
  ].map(toHistoryItem);
  const ids = (options) => queryHistory(items, { search: '', show: 'all', sort: 'updated', ...options }).map((item) => item.id);
  assert.deepEqual(ids({}), ['2', '3', '1']);
  assert.deepEqual(ids({ sort: 'created' }), ['1', '2', '3']);
  assert.deepEqual(ids({ sort: 'title' }), ['3', '2', '1']);
  assert.deepEqual(ids({ search: 'POLAR' }), ['2']);
  assert.deepEqual(ids({ search: 'find z^5' }), ['1']);
  assert.deepEqual(ids({ search: 'polar unity' }), []);
  assert.deepEqual(ids({ show: 'solved' }), ['1']);
  assert.deepEqual(ids({ show: 'inProgress' }), ['2']);
  assert.deepEqual(ids({ show: 'notes' }), ['3']);
});
