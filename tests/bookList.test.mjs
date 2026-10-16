import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { bookList, textUnder } = load('src/lib/bookList.ts');

const mark = (id, page, y, kind) => ({ id, label: id, page, rect: { x: 0.1, y, width: 0.5, height: 0.1 }, createdAt: 0, ...(kind ? { kind } : {}) });
const pen = (y) => ({ tool: 'pen', points: [0.1, y, 0.5, 0.2, y, 0.5] });
const highlight = (y) => ({ tool: 'highlighter', points: [0.1, y, 0.5, 0.4, y, 0.5] });
const contents = [
  { title: '1 Numbers', page: 3, depth: 0 },
  { title: '1.1 Polar form', page: 3, depth: 1 },
  { title: '1.2 Roots', page: 6, depth: 1 },
  { title: '2 Functions', page: 10, depth: 0 },
];

test('marks, highlights and ink are listed by section, in page order, with solved counts', () => {
  const sections = bookList(
    [mark('Exercise 2', 4, 0.6), mark('Exercise 1', 4, 0.2), mark('Note 1', 7, 0.1, 'note'), mark('Exercise 3', 7, 0.5)],
    ['Exercise 1'],
    { 4: [highlight(0.4), pen(0.9)], 5: [pen(0.1)], 12: [highlight(0.3)] },
    contents, 20,
  );
  assert.deepEqual(sections.map((section) => [section.title, section.from, section.to, section.solved, section.exercises]), [
    ['1.1 Polar form', 3, 5, 1, 2],
    ['1.2 Roots', 6, 9, 0, 1],
    ['2 Functions', 10, 20, 0, 0],
  ]);
  const rows = (section) => section.rows.map((row) => (row.kind === 'mark' ? row.mark.id : row.kind === 'ink' ? `ink ${row.pages}` : `highlight ${row.page}`));
  assert.deepEqual(rows(sections[0]), ['Exercise 1', 'highlight 4', 'Exercise 2', 'ink 4,5']);
  assert.deepEqual(rows(sections[1]), ['Note 1', 'Exercise 3']);
  assert.equal(sections[0].rows[0].solved, true);
  assert.deepEqual(rows(sections[2]), ['highlight 12']);
});

test('without bookmarks, pages are grouped ten at a time; pages before the first bookmark have their own group', () => {
  assert.deepEqual(bookList([mark('A', 2, 0), mark('B', 14, 0)], [], {}, [], 15).map((section) => [section.title, section.from, section.to]), [
    [null, 1, 10], [null, 11, 15],
  ]);
  assert.deepEqual(bookList([mark('A', 1, 0)], [], {}, contents, 20).map((section) => [section.key, section.from, section.to]), [['before', 1, 2]]);
});

test('an empty book has an empty list', () => {
  assert.deepEqual(bookList([], [], { 3: [] }, contents, 20), []);
});

test('a highlight quotes the words along its line, whole words only', () => {
  const boxes = [
    { text: 'Then z = r(cos t + i sin t), and t is an argument.', x: 0.1, y: 0.2, width: 0.8, height: 0.02 },
    { text: 'The next line is not highlighted.', x: 0.1, y: 0.25, width: 0.8, height: 0.02 },
  ];
  // Across the first half of the first line.
  const stroke = { tool: 'highlighter', points: [0.1, 0.21, 0.5, 0.48, 0.21, 0.5] };
  const quote = textUnder(stroke, boxes, 1.3);
  assert.ok(quote.startsWith('Then z = r(cos'), quote);
  assert.ok(!quote.includes('argument'), quote);
  assert.ok(!quote.includes('next'), quote);
  assert.equal(textUnder({ tool: 'highlighter', points: [0.1, 0.6, 0.5, 0.5, 0.6, 0.5] }, boxes, 1.3), '');
});
