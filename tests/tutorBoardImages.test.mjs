import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { tutorDetailBounds } = load('src/lib/tutorBoardImages.ts');
const small = { x: 50, y: 70, w: 200, h: 100 };
const tall = { x: 50, y: 70, w: 200, h: 6100 };

test('small boards and problem pictures alone need no close-ups', () => {
  assert.deepEqual(tutorDetailBounds(small, [small]), []);
  assert.deepEqual(tutorDetailBounds(tall, []), []);
});

test('distant work stays at 2x without tiling the empty gap', () => {
  const bottom = { ...small, y: 6070 };
  const tiles = tutorDetailBounds(tall, [bottom, small]);
  assert.equal(tiles.length, 2);
  assert.ok(tiles[0].y < tiles[1].y, 'reading order, regardless of creation order');
  for (const work of [small, bottom]) {
    assert.ok(tiles.some((tile) => tile.x <= work.x && tile.y <= work.y && tile.x + tile.w >= work.x + work.w && tile.y + tile.h >= work.y + work.h));
  }
  assert.ok(tiles.every((tile) => tile.w * 2 <= 2048 && tile.h * 2 <= 2048));
});

test('close-ups overlap at boundaries and cover a stroke crossing tiles', () => {
  const work = { x: -200, y: -300, w: 1300, h: 100 };
  const tiles = tutorDetailBounds(work, [work]);
  assert.equal(tiles.length, 2);
  assert.ok(tiles[0].x + tiles[0].w > tiles[1].x);
  assert.ok(tiles[1].x + tiles[1].w >= work.x + work.w);
});

test('oversized boards request a selection instead of dropping work or exporting unbounded images', () => {
  const huge = { x: 0, y: 0, w: 100_000, h: 100_000 };
  assert.throws(() => tutorDetailBounds(huge, [huge]), /Select the work/);
});
