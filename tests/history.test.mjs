import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { toHistoryItem, queryHistory, libraryView, folderSummaries } = load('src/lib/history.ts');

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

test('a Shelf entry knows its book and mark; a book lists one only when untouched ones are asked for', () => {
  const item = toHistoryItem(session({ id: 'shelf:doc1:ex1' }), new Set(), { untouched: true });
  assert.equal(item.bookId, 'doc1');
  assert.equal(item.exerciseId, 'ex1');
  assert.equal(toHistoryItem(session({ id: 'board-1' })).bookId, null);
});

test('the library lists what is in each folder; a search or filter reaches everything inside it', () => {
  const book = (id, title, folderId, createdAt, updatedAt, exercises = []) => ({ id, title, folderId, createdAt, updatedAt, exercises });
  const mark = (id, page, createdAt) => ({ id, label: id, page, rect: {}, createdAt });
  const folders = [
    { id: 'book:doc1', name: 'Calculus', parentId: 'fall', createdAt: 1, updatedAt: 1 },
    { id: 'fall', name: 'Fall semester', parentId: null, createdAt: 2, updatedAt: 2 },
    { id: 'ch4', name: 'Chapter 4', parentId: 'book:doc1', createdAt: 3, updatedAt: 3 },
  ];
  const books = [
    book('doc1', 'Calculus', 'book:doc1', 1, 1, [mark('ex1', 9, 1), mark('ex2', 4, 2), mark('ex3', 4, 3)]),
    book('doc2', 'Linear algebra', null, 2, 2),
  ];
  const items = [
    session({ id: 'board-1', title: 'Expand (x + 1)^2', updatedAt: 3 }),
    session({ id: 'board-2', title: 'Fall notes', sessionType: 'note', folderId: 'fall', updatedAt: 4 }),
    session({ id: 'shelf:doc1:ex1', title: 'Exercise 1 · Calculus, p. 9', isSolved: true, updatedAt: 9 }),
    session({ id: 'shelf:doc1:ex2', title: 'Exercise 2 · Calculus, p. 4', updatedAt: 5 }),
    session({ id: 'shelf:doc1:ex3', title: 'Exercise 3 · Calculus, p. 4', folderId: 'ch4', chatHistory: [{}], updatedAt: 6 }),
  ].map((entry) => toHistoryItem(entry, new Set(), { untouched: true }));
  const view = (query) => {
    const shown = libraryView(items, books, folders, { folderId: null, search: '', show: 'all', sort: 'updated', ...query });
    return { folders: shown.folders.map((entry) => entry.id), books: shown.books.map((entry) => entry.id), boards: shown.boards.map((entry) => entry.id) };
  };
  // The top level: its folders, the book outside any, and its free board.
  assert.deepEqual(view({}), { folders: ['fall'], books: ['doc2'], boards: ['board-1'] });
  assert.deepEqual(view({ folderId: 'fall' }), { folders: ['book:doc1'], books: [], boards: ['board-2'] });
  // A book's folder: the book, the folder inside it, and its boards (only opened ones too) not filed elsewhere, in its order.
  assert.deepEqual(view({ folderId: 'book:doc1', sort: 'book' }), { folders: ['ch4'], books: ['doc1'], boards: ['shelf:doc1:ex2', 'shelf:doc1:ex1'] });
  assert.deepEqual(view({ folderId: 'ch4' }).boards, ['shelf:doc1:ex3']);
  // Searching from the top reaches every depth; boards only with work in them.
  assert.deepEqual(view({ search: 'calculus' }), { folders: ['book:doc1'], books: ['doc1'], boards: ['shelf:doc1:ex1', 'shelf:doc1:ex3'] });
  assert.deepEqual(view({ show: 'solved' }), { folders: [], books: [], boards: ['shelf:doc1:ex1'] });
  // In a folder, only inside it.
  assert.deepEqual(view({ folderId: 'ch4', search: 'exercise' }).boards, ['shelf:doc1:ex3']);
  assert.deepEqual(view({ folderId: 'fall', show: 'notes' }).boards, ['board-2']);
  // A folder was last worked on when anything inside it was, a book read in it included.
  const reading = books.map((entry) => (entry.id === 'doc1' ? { ...entry, updatedAt: 50 } : entry));
  const art = { id: 'art', name: 'Art', parentId: null, createdAt: 9, updatedAt: 20 };
  const order = (list) => libraryView(items, list, [...folders, art], { folderId: null, search: '', show: 'all', sort: 'updated' }).folders.map((entry) => entry.id);
  assert.deepEqual(order(books), ['art', 'fall']);
  assert.deepEqual(order(reading), ['fall', 'art']);
  // A folder's counts take in everything inside it.
  assert.deepEqual(folderSummaries(items, books, folders).get('fall'), { folders: 2, books: 1, problems: 3, notes: 1, solved: 1 });
  assert.deepEqual(folderSummaries(items, books, folders).get('ch4'), { folders: 0, books: 0, problems: 1, notes: 0, solved: 0 });
});
