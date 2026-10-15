import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { texDocument, cleanTexReply, texBlocks, texInline } = load('src/lib/texWriteUp.ts');

test('the .tex file wraps the body in a minimal article with a safe title', () => {
  const tex = texDocument('Sum of $x_n$ {draft}\nsecond line', 'Body.');
  assert.match(tex, /^\\documentclass\{article\}\n\\usepackage\{amsmath,amssymb\}\n\\title\{Sum of xn draft\}/);
  assert.match(tex, /\\begin\{document\}\n\\maketitle\n\nBody\.\n\n\\end\{document\}\n$/);
  assert.doesNotMatch(texDocument('', 'Body.'), /\\title|\\maketitle/);
});

test('a reply loses code fences and any preamble the model added', () => {
  assert.equal(cleanTexReply('```latex\n\\section*{A}\nText\n```'), '\\section*{A}\nText');
  assert.equal(cleanTexReply('\\documentclass{article}\n\\begin{document}\n\\maketitle\nBody\n\\end{document}\nThanks!'), 'Body');
  assert.equal(cleanTexReply('  Plain body  '), 'Plain body');
});

test('the preview reads headings, paragraphs, display math and lists', () => {
  const blocks = texBlocks([
    '\\section*{Problem}',
    '% a comment',
    'Show that',
    '$x^2 \\ge 0$.',
    '',
    '\\[',
    'x^2 = x \\cdot x',
    '\\]',
    '\\begin{align}',
    'a &= b \\\\',
    '  &= c',
    '\\end{align}',
    '$$ y = 1 $$',
    '\\begin{enumerate}',
    '\\item First',
    '\\item Second',
    '\\end{enumerate}',
    '\\subsection*{Done}',
  ].join('\n'));
  assert.deepEqual(blocks, [
    { kind: 'heading', level: 1, text: 'Problem' },
    { kind: 'paragraph', text: 'Show that $x^2 \\ge 0$.' },
    { kind: 'math', tex: 'x^2 = x \\cdot x' },
    { kind: 'math', tex: '\\begin{align*}\na &= b \\\\\n  &= c\n\\end{align*}' },
    { kind: 'math', tex: 'y = 1' },
    { kind: 'list', ordered: true, items: ['First', 'Second'] },
    { kind: 'heading', level: 2, text: 'Done' },
  ]);
  // An environment left open (as while streaming) takes the rest of the text.
  assert.deepEqual(texBlocks('\\[\nx'), [{ kind: 'math', tex: 'x' }]);
});

test('inline text splits math, bold, italic, boxes and escapes', () => {
  assert.deepEqual(texInline('\\textbf{Solution.} Since $a>0$ and \\(b\\), \\emph{so}~\\fbox{Figure: a circle} costs 5\\%'), [
    { kind: 'bold', value: 'Solution.' },
    { kind: 'text', value: ' Since ' },
    { kind: 'math', value: 'a>0' },
    { kind: 'text', value: ' and ' },
    { kind: 'math', value: 'b' },
    { kind: 'text', value: ', ' },
    { kind: 'italic', value: 'so' },
    { kind: 'text', value: '\u00a0' },
    { kind: 'box', value: 'Figure: a circle' },
    { kind: 'text', value: ' costs 5%' },
  ]);
});
