import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLatex, scorePage, similarity, transcriptionLines } from '../scripts/handwriting/score.mjs';

test('equivalent spellings and spacing score as exact', () => {
  const pairs = [
    [String.raw`\sqrt{\frac{a^2+b^2}{2}} \ge \frac{a+b}{2}`, String.raw`$\sqrt{\dfrac{a^{2}+b^{2}}{2}}\geq\frac{a+b}{2}$`],
    [String.raw`\left(\frac{2}{3}\right)^{-2} = \frac{9}{4}`, String.raw`(\frac{2}{3})^{-2}=\frac{9}{4}`],
    [String.raw`z^2 = 2z \implies z \in \{0, 2\}`, String.raw`z^2=2z \Rightarrow z\in\left\{0,2\right\}`],
    [String.raw`a_{ij} = a_{ji} \text{ for all } i, j`, String.raw`a_{ij}=a_{ji}\ \text{for all}\ i,j`],
    [String.raw`\forall \varepsilon > 0 \; \exists \delta > 0, \quad x \in S`, String.raw`\forall\epsilon>0\exists\delta>0,x\in S`],
  ];
  for (const [expected, got] of pairs) assert.equal(similarity(expected, got), 1, `${expected} vs ${got}`);
});

test('misreadings lower the score', () => {
  assert.ok(similarity('O \\ne 0', '\\theta \\ne 0') < 1);
  assert.ok(similarity('u \\cup v \\ne u \\vee v', 'u \\cup v \\ne uvv') < 1);
  assert.notEqual(normalizeLatex('\\{0,2\\}'), normalizeLatex('{0,2}'));
});

test('matrix alignment points are kept, others dropped', () => {
  assert.match(normalizeLatex(String.raw`\begin{pmatrix} 2 & -1 \end{pmatrix}`), /&/);
  assert.equal(normalizeLatex('&= 4x'), '=4x');
});

test('pages match lines in order, so a missing line costs only that line', () => {
  const key = ['a=1', 'b=2', 'c=3'];
  const scored = scorePage(key, ['a=1', 'c=3']);
  assert.equal(scored.exact, 2);
  assert.equal(scored.lines[1].got, null);
  assert.ok(Math.abs(scored.score - 2 / 3) < 1e-9);
  assert.equal(scorePage(key, ['junk', 'a=1', 'b=2', 'c=3']).score, 1);
});

test('fences, blank lines and the diagram note are not transcription lines', () => {
  assert.deepEqual(transcriptionLines('```latex\nx=1\n\ny=2\nDIAGRAM: a circle\n```'), ['x=1', 'y=2']);
});
