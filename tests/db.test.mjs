import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { restoredBoard } = load('src/lib/db.ts');
const board = (overrides) => ({ id: 'b', title: 'x', problemStatement: '', updatedAt: 1, ...overrides });

test('a restore takes the board from the copy worked on last, and its folder from the copy moved last', () => {
  assert.deepEqual(restoredBoard(undefined, board({ folderId: 'f' })), board({ folderId: 'f' }));
  assert.equal(restoredBoard(board({ updatedAt: 2 }), board({ updatedAt: 2 })), undefined);
  // Moved on the other device, with no new work: only the filing comes back.
  assert.deepEqual(restoredBoard(board({ title: 'here', updatedAt: 3 }), board({ title: 'there', updatedAt: 2, folderId: 'f', filedAt: 9 })),
    board({ title: 'here', updatedAt: 3, folderId: 'f', filedAt: 9 }));
  // Worked on there, moved here later: the work comes back, the move here stays.
  assert.deepEqual(restoredBoard(board({ updatedAt: 1, folderId: null, filedAt: 5 }), board({ title: 'new', updatedAt: 4, folderId: 'f', filedAt: 2 })),
    board({ title: 'new', updatedAt: 4, folderId: null, filedAt: 5 }));
  // Moved back to where it belongs by default: no folder at all.
  assert.deepEqual(restoredBoard(board({ folderId: 'f', filedAt: 1 }), board({ filedAt: 2 })), board({ filedAt: 2 }));
});
