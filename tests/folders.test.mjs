import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { folderIndex, folderPath, folderTree, isWithin, itemFolder, folderHref } = load('src/lib/folders.ts');
// The database is replaced by a recorder: moves are tested on what they would write.
const moves = [];
const saved = [];
const actions = load('src/lib/folderActions.ts', {
  '@/lib/db': {
    moveSession: async (id, folderId) => { moves.push([id, folderId]); },
    saveFolder: async (folder) => { saved.push(folder); },
    loadShelfDocument: async () => undefined, saveShelfDocument: async () => {}, deleteFolder: async () => {},
  },
});

const folder = (id, parentId, name = id) => ({ id, name, parentId, createdAt: 1, updatedAt: 1 });
const folders = [folder('fall', null, 'Fall'), folder('book:doc1', 'fall', 'Calculus'), folder('ch4', 'book:doc1', 'Chapter 4'), folder('art', null, 'Art')];
const books = [{ id: 'doc1', title: 'Calculus', folderId: 'book:doc1', exercises: [] }];

test('a folder knows where it is; a missing parent or a loop counts as the top level', () => {
  const index = folderIndex([...folders, folder('orphan', 'gone'), folder('a', 'b'), folder('b', 'a')], books);
  assert.deepEqual(folderPath(index, 'ch4').map((entry) => entry.id), ['fall', 'book:doc1', 'ch4']);
  assert.deepEqual(folderPath(index, null), []);
  assert.equal(index.parent.get('orphan'), null);
  assert.equal(index.parent.get('a'), null);
  assert.equal(index.parent.get('b'), null);
  assert.ok(isWithin(index, 'ch4', 'fall'));
  assert.ok(isWithin(index, 'ch4', null));
  assert.ok(!isWithin(index, 'fall', 'ch4'));
  assert.ok(!isWithin(index, null, 'fall'));
  assert.equal(folderHref('ch4'), '/folder?id=ch4');
  assert.equal(folderHref(null), '/');
});

test('Move to lists every folder under its parent, by name', () => {
  const tree = folderTree(folderIndex(folders, books)).map(({ folder: entry, depth }) => `${'  '.repeat(depth)}${entry.name}`);
  assert.deepEqual(tree, ['Art', 'Fall', '  Calculus', '    Chapter 4']);
});

test('a board is where it was filed, else with its book, else at the top level', () => {
  const index = folderIndex(folders, books);
  assert.equal(itemFolder(index, { folderId: undefined, bookId: 'doc1' }), 'book:doc1');
  assert.equal(itemFolder(index, { folderId: 'ch4', bookId: 'doc1' }), 'ch4');
  assert.equal(itemFolder(index, { folderId: null, bookId: 'doc1' }), null);
  assert.equal(itemFolder(index, { folderId: 'gone', bookId: 'doc1' }), 'book:doc1');
  assert.equal(itemFolder(index, { folderId: undefined, bookId: null }), null);
  assert.equal(itemFolder(index, { folderId: 'art', bookId: null }), 'art');
});

test('moving a board back where it belongs by default clears its folder, so it follows its book', async () => {
  const index = folderIndex(folders, books);
  moves.length = 0;
  await actions.moveBoard(index, { id: 'shelf:doc1:ex1', bookId: 'doc1' }, 'ch4');
  await actions.moveBoard(index, { id: 'shelf:doc1:ex1', bookId: 'doc1' }, 'book:doc1');
  await actions.moveBoard(index, { id: 'shelf:doc1:ex1', bookId: 'doc1' }, null);
  await actions.moveBoard(index, { id: 'board-1', bookId: null }, 'art');
  await actions.moveBoard(index, { id: 'board-1', bookId: null }, null);
  assert.deepEqual(moves, [['shelf:doc1:ex1', 'ch4'], ['shelf:doc1:ex1', undefined], ['shelf:doc1:ex1', null], ['board-1', 'art'], ['board-1', undefined]]);
});

test('a folder never moves inside itself', async () => {
  const index = folderIndex(folders, books);
  await assert.rejects(actions.moveFolder(index, folders[0], 'ch4'), /inside itself/);
  await assert.rejects(actions.moveFolder(index, folders[0], 'fall'), /inside itself/);
  saved.length = 0;
  await actions.moveFolder(index, folders[2], 'art');
  assert.equal(saved[0].parentId, 'art');
  const made = await actions.createFolder('  ', 'fall');
  assert.equal(made.name, 'New folder');
  assert.equal(made.parentId, 'fall');
});
