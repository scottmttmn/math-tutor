import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const loaded = new Map();
const model = load('src/lib/inkBoard/model.ts', {}, loaded);
const { GridIndex } = load('src/lib/inkBoard/hitTest.ts', {}, loaded);
const { isScribble, scratchedOut } = load('src/lib/inkBoard/scratchOut.ts', {}, loaded);

// A path through (x, y) corners, sampled every 2 units, as flat [x, y, pressure, …].
const path = (corners) => {
  const points = [];
  for (let i = 1; i < corners.length; i += 1) {
    const [[x0, y0], [x1, y1]] = [corners[i - 1], corners[i]];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2));
    for (let s = i === 1 ? 0 : 1; s <= steps; s += 1) points.push(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps, 0.5);
  }
  return points;
};
const curve = (f, from, to) => { const corners = []; for (let t = from; t <= to; t += 0.5) corners.push(f(t)); return corners; };
// Back and forth across a word `width` wide, drifting down a little each time.
const scribble = (x, y, width, sweeps, drift = 3) => path(Array.from({ length: sweeps + 1 }, (_, i) => [i % 2 ? x + width : x, y + i * drift]));
const stroke = (id, points, tool = 'pen') => ({ id, tool, color: 'black', width: 3, points });
const board = (strokes) => ({ ...model.emptyBoard(), strokes, images: [] });
const indexed = (b) => { const index = new GridIndex(); index.update(b); return index; };

test('a scribble back and forth is recognized, across or up and down', () => {
  assert.equal(isScribble(scribble(100, 100, 120, 6)), true);
  assert.equal(isScribble(scribble(100, 100, 60, 5, 2)), true);
  const vertical = path(Array.from({ length: 7 }, (_, i) => [100 + i * 3, i % 2 ? 160 : 100]));
  assert.equal(isScribble(vertical), true);
});

test('writing and drawing are not scribbles', () => {
  // A straight line, a check mark, a circle.
  assert.equal(isScribble(path([[0, 0], [200, 0]])), false);
  assert.equal(isScribble(path([[0, 20], [10, 30], [40, 0]])), false);
  assert.equal(isScribble(path(curve((t) => [50 + 30 * Math.cos(t), 50 + 30 * Math.sin(t)], 0, 2 * Math.PI))), false);
  // A sine wave across the page, a cursive m, a run of m's.
  assert.equal(isScribble(path(curve((t) => [t * 10, 50 + 15 * Math.sin(t)], 0, 30))), false);
  assert.equal(isScribble(path([[0, 30], [0, 0], [10, 0], [10, 30], [10, 0], [20, 0], [20, 30], [24, 30]])), false);
  assert.equal(isScribble(path(Array.from({ length: 13 }, (_, i) => [i * 8, i % 2 ? 0 : 20]))), false);
  // Going back and forth only twice (a z, an underline and back).
  assert.equal(isScribble(path([[0, 0], [80, 0], [0, 20], [80, 20]])), false);
  // A tiny jiggle is a dot.
  assert.equal(isScribble(scribble(0, 0, 6, 8, 0.5)), false);
});

test('a scribble over ink takes the strokes mostly under it, and nothing else', () => {
  const word = [stroke('a', path([[110, 104], [130, 112]])), stroke('b', path([[140, 104], [150, 112], [160, 104]]))];
  const neighbor = stroke('long', path([[150, 108], [600, 108]]));
  const below = stroke('below', path([[100, 300], [200, 300]]));
  const highlight = stroke('hl', path([[105, 108], [215, 108]]), 'highlighter');
  const b = board([...word, neighbor, below, highlight]);
  const taken = scratchedOut(b, indexed(b), scribble(100, 100, 120, 6), 4);
  assert.deepEqual([...taken].sort(), ['a', 'b']);
});

test('a scribble over empty paper, or a lookalike over ink, erases nothing', () => {
  const b = board([stroke('a', path([[110, 104], [130, 112]]))]);
  assert.equal(scratchedOut(b, indexed(b), scribble(400, 400, 120, 6), 4).size, 0);
  assert.equal(scratchedOut(b, indexed(b), path([[100, 108], [300, 108]]), 4).size, 0);
});
