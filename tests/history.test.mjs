import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { toHistoryItem, queryHistory } = load('src/lib/history.ts');

const session = (overrides) => ({
  id: 'a', title: 'Untitled', problemStatement: '', problemImage: null, canvasStrokes: [], canvasDocument: null,
  canvasImageBlob: null, chatHistory: [], createdAt: 1, updatedAt: 1, ...overrides,
});
const withShape = { store: { 'shape:1': {} }, schema: {} };

test('boards from the removed built-in workbook no longer appear', () => {
  assert.equal(toHistoryItem(session({ id: 'workbook:cg:exercise:x1_3_2', canvasDocument: withShape, isSolved: true })), null);
  assert.equal(toHistoryItem(session({ id: 'workbook:cg:reading', sessionType: 'note', chatHistory: [{}] })), null);
  assert.equal(toHistoryItem(session({ id: 'board-1' })).href, null);
});

test('Shelf exercises appear once they hold work, and open beside their page', () => {
  assert.equal(toHistoryItem(session({ id: 'shelf:doc1:ex1' })), null);
  const solved = toHistoryItem(session({ id: 'shelf:doc1:ex1', isSolved: true }));
  assert.equal(solved.source, 'shelf');
  assert.equal(solved.href, '/shelf/read?doc=doc1&open=ex1');
  assert.equal(toHistoryItem(session({ id: 'board-1' })).source, 'board');
  // The exercise put on its board when it opened isn't work; anything drawn beside it is.
  const placed = { store: { 'shape:p': { meta: { problemImage: true } } }, schema: {} };
  assert.equal(toHistoryItem(session({ id: 'shelf:doc1:ex1', canvasDocument: placed })), null);
  assert.equal(toHistoryItem(session({ id: 'shelf:doc1:ex1', canvasDocument: { ...placed, store: { ...placed.store, 'shape:1': { meta: {} } } } })).source, 'shelf');
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
  ].map((item) => toHistoryItem(item));
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
  assert.deepEqual(ids({ show: 'problems' }), ['2', '1']);
});

test('favorites: a starred board shows as one, and a starred Shelf exercise shows even without work', () => {
  const ids = new Set(['board-1', 'shelf:doc1:ex1']);
  assert.equal(toHistoryItem(session({ id: 'board-1' }), ids).favorite, true);
  assert.equal(toHistoryItem(session({ id: 'board-2' }), ids).favorite, false);
  assert.equal(toHistoryItem(session({ id: 'shelf:doc1:ex1' }), ids).favorite, true);
  const items = [toHistoryItem(session({ id: 'board-1' }), ids), toHistoryItem(session({ id: 'board-2' }), ids)];
  assert.deepEqual(queryHistory(items, { search: '', show: 'favorites', sort: 'updated' }).map((item) => item.id), ['board-1']);
});
