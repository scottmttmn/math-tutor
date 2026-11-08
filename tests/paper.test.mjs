import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { paperFor } = load('src/lib/paper.ts');

test('notes start lined and problems blank, until the student chooses', () => {
  assert.equal(paperFor(undefined, 'note'), 'lined');
  assert.equal(paperFor(null, 'problem'), 'blank');
  assert.equal(paperFor('grid', 'note'), 'grid');
  assert.equal(paperFor('lined', 'problem'), 'lined');
});

