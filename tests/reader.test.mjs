import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { bookCrop, printedArea, samplePages, toShown, toPage, pageName, findPage } = load('src/lib/reader.ts');

const close = (actual, expected) => {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, `${key}: ${actual[key]} vs ${expected[key]}`);
};

test('the crop is the union of the printed areas, padded', () => {
  close(bookCrop([{ x: 0.15, y: 0.1, width: 0.6, height: 0.8 }, { x: 0.2, y: 0.12, width: 0.65, height: 0.7 }, null]),
    { x: 0.135, y: 0.085, width: 0.73, height: 0.83 });
});

test('a nearly empty page does not shrink to a strip', () => {
  close(bookCrop([{ x: 0.4, y: 0.1, width: 0.2, height: 0.05 }]), { x: 0.18, y: 0.085, width: 0.64, height: 0.735 });
});

test('nothing to trim, or nothing printed: no crop', () => {
  assert.equal(bookCrop([{ x: 0.01, y: 0.01, width: 0.98, height: 0.98 }]), null);
  assert.equal(bookCrop([null, null]), null);
  assert.equal(bookCrop([]), null);
});

test('the printed area of a white image with one dark block', () => {
  const width = 10, height = 8;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 2; y < 5; y++) for (let x = 3; x < 7; x++) pixels.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  assert.deepEqual(printedArea(pixels, width, height), { x: 0.3, y: 0.25, width: 0.4, height: 0.375 });
  assert.equal(printedArea(new Uint8ClampedArray(width * height * 4).fill(255), width, height), null);
});

test('sample pages skip the cover and spread through the book', () => {
  assert.deepEqual(samplePages(2), [1, 2]);
  assert.deepEqual(samplePages(5), [2, 3, 4, 5]);
  assert.deepEqual(samplePages(300, 4), [2, 101, 201, 300]);
});

test('rects and points convert between the page and its shown part', () => {
  const crop = { x: 0.1, y: 0.2, width: 0.8, height: 0.5 };
  close(toShown({ x: 0.5, y: 0.45, width: 0.4, height: 0.1 }, crop), { x: 0.5, y: 0.5, width: 0.5, height: 0.2 });
  close(toPage({ x: 0.5, y: 0.5 }, crop), { x: 0.5, y: 0.45 });
  assert.deepEqual(toShown({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, null), { x: 0.5, y: 0.5, width: 0.1, height: 0.1 });
});

test('pages go by their printed numbers when the PDF has them', () => {
  const labels = ['i', 'ii', '1', '2', '3'];
  assert.equal(pageName(labels, 4), '2');
  assert.equal(pageName(null, 4), '4');
  assert.equal(findPage('2', labels, 5), 4);
  assert.equal(findPage('II', labels, 5), 2);
  assert.equal(findPage('p. 3', labels, 5), 5);
  // No such printed number: the page's place in the file.
  assert.equal(findPage('5', labels, 5), 5);
  assert.equal(findPage('9', labels, 5), null);
  assert.equal(findPage('x', labels, 5), null);
  assert.equal(findPage('3', null, 5), 3);
  assert.equal(findPage('', null, 5), null);
});
