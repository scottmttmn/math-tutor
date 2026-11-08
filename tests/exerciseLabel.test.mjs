import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { exerciseNumberIn, sectionNumber, printedLabel } = load('src/lib/exerciseLabel.ts');

const box = (text, x, y, width = 0.3, height = 0.012) => ({ text, x, y, width, height });
const rect = { x: 0.12, y: 0.3, width: 0.7, height: 0.1 };

test('the number at the start of the box\'s first line names the exercise', () => {
  assert.equal(exerciseNumberIn([box('Use the Mean Value Theorem to show', 0.15, 0.302), box('55.', 0.1, 0.302, 0.03)], rect), '55', 'a number hanging in the margin counts');
  assert.equal(exerciseNumberIn([box('12. Find all c such that', 0.13, 0.31), box('f(x) = 3', 0.13, 0.33)], rect), '12');
  assert.equal(exerciseNumberIn([box('Exercise 3.14 Prove that', 0.13, 0.31)], rect), '3.14');
  assert.equal(exerciseNumberIn([box('7) Sketch', 0.13, 0.31)], rect), '7');
  // The line above the box, or a later line, doesn't count; a line starting with words gives nothing.
  assert.equal(exerciseNumberIn([box('54. Above', 0.13, 0.25), box('Show that x > 0', 0.13, 0.31), box('56. Below', 0.13, 0.36)], rect), null);
  assert.equal(exerciseNumberIn([box('3x + 2 = 7', 0.13, 0.31)], rect), null, 'math is not a number label');
  assert.equal(exerciseNumberIn([], rect), null, 'a scan has no text');
});

test('section numbers come from the bookmark, and make "4.2 #55"', () => {
  assert.equal(sectionNumber('4.2 The Mean Value Theorem'), '4.2');
  assert.equal(sectionNumber('§1.3 Sets'), '1.3');
  assert.equal(sectionNumber('Section 2.1: Limits'), '2.1');
  assert.equal(sectionNumber('Chapter 4'), '4');
  assert.equal(sectionNumber('Exercises'), null);
  assert.equal(sectionNumber(null), null);
  assert.equal(printedLabel('55', '4.2'), '4.2 #55');
  assert.equal(printedLabel('55', null), 'Exercise 55');
  assert.equal(printedLabel('3.14', '3'), 'Exercise 3.14', 'a number with its own section part stands alone');
});
