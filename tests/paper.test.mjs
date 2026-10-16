import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { paperFor, paperLines } = load('src/lib/paper.ts');

test('notes start lined and problems blank, until the student chooses', () => {
  assert.equal(paperFor(undefined, 'note'), 'lined');
  assert.equal(paperFor(null, 'problem'), 'blank');
  assert.equal(paperFor('grid', 'note'), 'grid');
  assert.equal(paperFor('lined', 'problem'), 'lined');
});

test('the lines move and zoom with the board, and go when too dense', () => {
  assert.deepEqual(paperLines({ x: 0, y: 0, z: 1 }, 40), { gap: 40, x: 0, y: 0 });
  assert.deepEqual(paperLines({ x: -10, y: 50, z: 0.5 }, 40), { gap: 20, x: 15, y: 5 });
  assert.equal(paperLines({ x: 0, y: 0, z: 0.1 }, 40), null);
});
