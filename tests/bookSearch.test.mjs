import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { findOnPage, searchTerm } = load('src/lib/bookSearch.ts');
const { sectionAt } = load('src/lib/bookList.ts');

const line = (text, y, x = 0.1, width = 0.8) => ({ text, x, y, width, height: 0.02 });

test('finds words regardless of case and spacing, with the line around them', () => {
  const matches = findOnPage([line('Every complex number has a polar form.', 0.1)], 'POLAR   form');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].match, 'polar form');
  assert.equal(matches[0].before, 'Every complex number has a ');
  assert.equal(matches[0].after, '.');
  const [rect] = matches[0].rects;
  // "polar form" starts at character 27 of 38.
  assert.ok(Math.abs(rect.x - (0.1 + (0.8 * 27) / 38)) < 1e-9);
  assert.ok(Math.abs(rect.width - (0.8 * 10) / 38) < 1e-9);
  assert.equal(rect.y, 0.1);
});

test('a match across two runs of text gets a rect in each', () => {
  const matches = findOnPage([line('the unit', 0.1, 0.1, 0.3), line('circle is', 0.13, 0.1, 0.3)], 'unit circle');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].rects.length, 2);
  assert.equal(matches[0].rects[1].y, 0.13);
});

test('every match on a page is found; nothing for an empty query', () => {
  assert.equal(findOnPage([line('a root, a root, a root', 0.1)], 'root').length, 3);
  assert.deepEqual(findOnPage([line('anything', 0.1)], '   '), []);
  assert.equal(searchTerm('  Two  Words '), 'two words');
});

test('long context is cut to whole words with ellipses', () => {
  const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
  const [match] = findOnPage([line(`${words} target ${words}`, 0.1)], 'target');
  assert.ok(match.before.startsWith('…word'));
  assert.ok(match.after.endsWith('…'));
});

test('a page belongs to the last bookmark at or before it, else its run of ten pages', () => {
  const contents = [{ title: 'Intro', page: 3, depth: 0 }, { title: 'Roots', page: 8, depth: 0 }];
  assert.equal(sectionAt(contents, 9, 20).title, 'Roots');
  assert.equal(sectionAt(contents, 1, 20).key, 'before');
  assert.deepEqual(sectionAt([], 14, 25), { key: 'pages-11', title: null, from: 11, to: 20 });
});
