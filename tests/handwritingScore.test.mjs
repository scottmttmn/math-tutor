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

test('a matrix or cases block split over several output lines still matches its key line', () => {
  const key = [String.raw`A = \begin{pmatrix} 2 & -1 \\ 0 & 3 \end{pmatrix}`, 'B = 1'];
  const split = [String.raw`A = \begin{pmatrix} 2 & -1 \\`, String.raw`0 & 3 \end{pmatrix}`, 'B = 1'];
  const scored = scorePage(key, split);
  assert.equal(scored.exact, 2);
  assert.equal(scored.lines[1].got, 'B = 1');
});

test('inline fractions, stray dollar signs and \\colon are not misreadings', () => {
  assert.equal(similarity(String.raw`x^{\frac{3}{2}} = \sqrt{x^3}`, String.raw`x^{3/2} = \sqrt{x^3}`), 1);
  assert.equal(similarity(String.raw`3 \times x = 3x`, String.raw`$3 \times x = 3x$`), 1);
  assert.equal(similarity(String.raw`\varphi : G \to H`, String.raw`\varphi \colon G \to H`), 1);
  assert.ok(similarity(String.raw`\frac{1}{2}`, String.raw`\frac{1}{3}`) < 1);
  assert.ok(similarity(String.raw`\frac{1}{2}x`, String.raw`\frac{1}{2x}`) < 1);
  assert.ok(similarity(String.raw`a\frac{b}{c}`, String.raw`\frac{ab}{c}`) < 1);
});

test('thin spaces before a letter and matrix row breaks normalize correctly', () => {
  assert.equal(similarity(String.raw`\int_0^1 x^2 \, dx = \frac{1}{3}`, String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`), 1);
  assert.equal(similarity(String.raw`A = \begin{pmatrix} 2 & -1 \\ 0 & 3 \end{pmatrix}`, String.raw`A=\begin{pmatrix}2&-1\\0&3\end{pmatrix}`), 1);
  assert.ok(similarity(String.raw`\begin{pmatrix} 1 \\ 2 \end{pmatrix}`, String.raw`\begin{pmatrix} 12 \end{pmatrix}`) < 1);
});
