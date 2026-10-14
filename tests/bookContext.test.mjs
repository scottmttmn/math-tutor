import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { readingRange, sectionFor } = load('src/lib/bookContext.ts');

const exercise = (id, page, readFrom) => ({ id, label: id, page, rect: { x: 0, y: 0, width: 1, height: 1 }, createdAt: 1, readFrom });
const book = (...exercises) => ({ id: 'doc', title: 'Book', exercises });
const starts = [
  { title: 'Chapter 2', page: 30 },
  { title: '2.1 Limits', page: 30 },
  { title: '2.1 Exercises', page: 38 },
  { title: '2.2 Continuity', page: 41 },
];

test('pages run from the section start to the exercise, skipping an Exercises bookmark', () => {
  assert.equal(sectionFor(starts, 30).title, '2.1 Limits');
  const ex = exercise('a', 39);
  assert.deepEqual(readingRange(book(ex), ex, starts), { from: 30, to: 39, section: '2.1 Limits' });
});

test('at most 15 pages, ending at the exercise page', () => {
  const ex = exercise('a', 70);
  assert.deepEqual(readingRange(book(ex), ex, starts), { from: 56, to: 70, section: '2.2 Continuity' });
});

test('without bookmarks, the 6 pages before the exercise', () => {
  const ex = exercise('a', 20);
  assert.deepEqual(readingRange(book(ex), ex, []), { from: 14, to: 20, section: undefined });
  const early = exercise('b', 3);
  assert.equal(readingRange(book(early), early, []).from, 1);
});

test('the student can choose the start or turn it off', () => {
  const chosen = exercise('a', 39, 34);
  assert.equal(readingRange(book(chosen), chosen, starts).from, 34);
  const off = exercise('a', 39, 0);
  assert.equal(readingRange(book(off), off, starts), null);
});

test('a later exercise in the same section reuses the correction', () => {
  const corrected = exercise('a', 20, 12);
  const later = exercise('b', 24);
  assert.equal(readingRange(book(corrected, later), later, []).from, 12);
  const farLater = exercise('c', 40);
  assert.equal(readingRange(book(corrected, farLater), farLater, []).from, 34, 'out of reach of the correction');
  const otherSection = exercise('d', 43);
  const inLimits = exercise('e', 39, 32);
  assert.equal(readingRange(book(inLimits, otherSection), otherSection, starts).from, 41);
});
