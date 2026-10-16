import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { eraseAt, inkPoint, pageScale, PEN_WIDTH } = load('src/lib/ink.ts');

test('points are stored rounded, with a missing pressure as medium', () => {
  assert.deepEqual(inkPoint(0.123456, 0.987654, 0.33333), [0.1235, 0.9877, 0.33]);
  assert.deepEqual(inkPoint(0.5, 0.5, 0), [0.5, 0.5, 0.5]);
});

test('the whole page is larger than its trimmed part by the crop', () => {
  assert.deepEqual(pageScale(600, 800, null), { x: 600, y: 800 });
  assert.deepEqual(pageScale(600, 800, { x: 0.1, y: 0.1, width: 0.75, height: 0.8 }), { x: 800, y: 1000 });
});

test('the eraser removes whole strokes it touches, including between samples', () => {
  const scale = { x: 1000, y: 1000 };
  // A horizontal line from (100, 100) to (300, 100) px, sampled only at its ends.
  const line = { tool: 'pen', points: [0.1, 0.1, 0.5, 0.3, 0.1, 0.5] };
  const far = { tool: 'highlighter', points: [0.8, 0.8, 0.5] };
  const strokes = [line, far];
  assert.deepEqual(eraseAt(strokes, { x: 0.2, y: 0.11 }, 12, scale), [far]);
  // Missed by more than the radius and the pen's half width: nothing changes, the same array back.
  const reach = 12 + (PEN_WIDTH * 1000) / 2;
  assert.equal(eraseAt(strokes, { x: 0.2, y: 0.1 + (reach + 1) / 1000 }, 12, scale), strokes);
  // A one-point stroke (a dot) can be rubbed out too.
  assert.deepEqual(eraseAt(strokes, { x: 0.805, y: 0.8 }, 12, scale), [line]);
});
