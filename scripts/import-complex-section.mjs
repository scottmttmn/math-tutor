import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import katex from 'katex';

// Regenerate with: curl -L https://complexanalysis.org/web/sec_geometry-1.html -o /tmp/complex-geometry.html
// Then run: node scripts/import-complex-section.mjs /tmp/complex-geometry.html

const SOURCE_URL = 'https://complexanalysis.org/web/sec_geometry-1.html';
const OUTPUT = fileURLToPath(new URL('../src/content/complex-geometry.json', import.meta.url));

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Pass the downloaded source HTML path as the first argument');
// Correct two source misprints and stale references in Exercise 4.
const source = (await readFile(sourcePath, 'utf8'))
  .replace(String.raw`|z_1| - |z_2| \le |z_1| + |z_2|`, String.raw`|z_1| - |z_2| \le |z_1+z_2|`)
  .replace(String.raw`\sqrt{\sum\limits_{k=1}^n |z_k|^2 \sqrt{\sum\limits_{k=1}^n |w_k|^2}}`, String.raw`\sqrt{\sum\limits_{k=1}^n |z_k|^2} \sqrt{\sum\limits_{k=1}^n |w_k|^2}`);
const $ = cheerio.load(source);
$('#x1_3_4b a.xref').text('(1.3.4)').attr('href', 'sec_geometry-1.html#TriangleIneq').attr('title', 'Equation 1.3.4');
const section = $('#sec_geometry-1');
if (!section.length) throw new Error('Source section was not found');

// The source defines \amp as & in a page-level MathJax preamble outside the section.
// Preserve its alignment meaning when importing individual expressions into KaTeX.
const normalizeBookMath = (text) => text.replace(/\\amp\b/g, '&');

function clean(fragment) {
  const $part = cheerio.load(fragment, { decodeEntities: false });
  $part('.solutions, .solution, .autopermalink, script, style').remove();
  $part('[data-knowl]').removeAttr('data-knowl');
  $part('a[href]').each((_, link) => {
    const href = $part(link).attr('href');
    if (!href) return;
    const url = new URL(href, SOURCE_URL);
    if (url.pathname === new URL(SOURCE_URL).pathname && url.hash) {
      $part(link).attr('href', url.hash).removeAttr('target').removeAttr('rel');
    } else {
      $part(link).attr('href', url.toString()).attr('target', '_blank').attr('rel', 'noopener noreferrer');
    }
  });
  $part('img[src]').each((_, image) => {
    const src = $part(image).attr('src');
    if (src) {
      const url = new URL(src, SOURCE_URL);
      // These eight book figures are bundled locally, under the book's CC BY 4.0 license.
      if (!/^ch-01-fig-(07|08|09|10|11|12|13|14)\.svg$/.test(url.pathname.split('/').at(-1))) {
        throw new Error(`Review attribution and bundle the new figure before importing: ${url}`);
      }
      $part(image).attr('src', `/workbook/complex-geometry/${url.pathname.split('/').at(-1)}`);
      $part(image).attr('alt', $part(image).closest('figure').find('figcaption').text().replace(/\s+/g, ' ').trim());
    }
    $part(image).removeAttr('style');
  });
  $part('.process-math').each((_, element) => {
    const math = normalizeBookMath($part(element).text().trim().replace(/^\\\(|\\\)$/g, '').replace(/^\\\[|\\\]$/g, ''));
    const displayMode = $part(element).hasClass('displaymath');
    const rendered = katex.renderToString(math, { displayMode, throwOnError: true, trust: false });
    $part(element).removeClass('process-math').html(rendered);
  });
  $part('*').each((_, element) => {
    if (element.type !== 'tag') return;
    for (const name of Object.keys(element.attribs ?? {})) {
      if (name.toLowerCase().startsWith('on')) $part(element).removeAttr(name);
    }
  });
  return $part('body').html() ?? '';
}

const exercises = section.find('section.exercises > article.exercise').map((_, element) => {
  const clone = $(element).clone();
  clone.find('.solutions, .solution, .autopermalink').remove();
  clone.children('h3.heading').first().remove();
  return {
    id: $(element).attr('id'),
    number: $(element).children('h3.heading').first().text().trim(),
    html: clean($.html(clone)),
    text: normalizeBookMath(clone.text()).replace(/\s+/g, ' ').trim(),
  };
}).get();

if (exercises.length < 20) throw new Error(`Expected section exercises, found ${exercises.length}`);

const reading = section.clone();
reading.find('section.exercises, .solutions, .solution, .autopermalink').remove();
const content = {
  id: 'howell-mathews-1.3',
  title: 'The Geometry of Complex Numbers, Part I',
  bookTitle: 'Complex Analysis',
  authors: 'Russell W. Howell and John H. Mathews',
  sourceUrl: SOURCE_URL,
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  sourceRevision: '2026-08-21',
  readingHtml: clean($.html(reading)),
  readingText: normalizeBookMath(reading.text()).replace(/\s+/g, ' ').trim(),
  recommendedIds: ['x1_3_1', 'x1_3_2', 'x1_3_6', 'x1_3_8'],
  exercises,
};

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, `${JSON.stringify(content, null, 2)}\n`);
console.log(`Imported section 1.3 with ${exercises.length} exercises`);
