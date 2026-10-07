import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import load from './load-typescript.mjs';

const { default: TutorContent } = load('src/components/chat/TutorContent.tsx');
const render = (content) => renderToStaticMarkup(createElement(TutorContent, { content }));

test('chat renders common inline/display delimiters with Markdown and literal code', () => {
  const html = render(String.raw`**Modulus:** \(a_1 + b_2\), $x^2$, \[\frac{1}{2}\], $$\sqrt{z}$$`);
  assert.equal((html.match(/class="katex"/g) ?? []).length, 4);
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2);
  assert.match(html, /<strong/);
  assert.doesNotMatch(render('`$x$`'), /class="katex"/);
});

test('streaming, currency, invalid math and HTML stay readable and safe', () => {
  assert.doesNotMatch(render(String.raw`Not done: \(x^2`), /class="katex"/);
  assert.doesNotMatch(render('It costs $5 and $10.'), /class="katex"/);
  assert.match(render(String.raw`\(\unknownCommand{x}\)`), /unknownCommand/);
  assert.doesNotMatch(render('<img src=x onerror=alert(1)>'), /<img/);
  assert.doesNotMatch(render(String.raw`\(\href{javascript:alert(1)}{click}\)`), /href="javascript/);
});
