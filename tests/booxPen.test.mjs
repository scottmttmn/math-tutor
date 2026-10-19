import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const capacitor = { Capacitor: { isNativePlatform: () => false, getPlatform: () => 'web' }, registerPlugin: () => ({}) };
const { booxPenAvailable, boxOf, overlaps, strokePoints, strokeStats, sweep } = load('src/lib/booxPen.ts', { '@capacitor/core': capacitor });

test('the plugin\'s flat stroke becomes points, dropping a partial sample', () => {
  assert.deepEqual(strokePoints([1, 2, 0.5, 0, 3, 4, 1, 8, 9]), [
    { x: 1, y: 2, pressure: 0.5, ms: 0 },
    { x: 3, y: 4, pressure: 1, ms: 8 },
  ]);
});

test('an SDK stroke reports samples per second and its longest gap, but no event delay', () => {
  const points = strokePoints([0, 0, 0.5, 0, 1, 0, 0.5, 10, 2, 0, 0.5, 40, 3, 0, 0.5, 50]);
  assert.deepEqual(strokeStats(points), { samplesPerSecond: 80, worstGapMs: 30 });
  assert.equal(strokeStats(points.slice(0, 1)), null);
});

test('hidden elements have no box, and only overlapping controls are excluded', () => {
  assert.equal(boxOf({ left: 0, top: 0, width: 0, height: 10 }), null);
  const board = boxOf({ left: 0, top: 50, width: 400, height: 300 });
  assert.equal(overlaps(board, { x: 10, y: 300, w: 100, h: 40 }), true);
  assert.equal(overlaps(board, { x: 10, y: 350, w: 100, h: 40 }), false);
});

test('outside the Android app the BOOX pen is never offered', async () => {
  assert.equal(await booxPenAvailable(), false);
});

test('a fast stroke is filled in between samples, so the eraser follows its whole path', () => {
  const path = sweep(strokePoints([0, 0, 0, 0, 10, 0, 1, 10]), 3);
  assert.equal(path.length, 5);
  assert.ok(path.every((point, i) => i === 0 || point.x - path[i - 1].x <= 3));
  assert.deepEqual(path.at(-1), { x: 10, y: 0, pressure: 1, ms: 10 });
});
