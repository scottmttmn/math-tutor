import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makePdf } from './makePdf.mjs';

// Reading a Shelf PDF: turning pages, printed page numbers, contents, trimmed margins, full screen.
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browserErrors = [];
const folder = await mkdtemp(join(tmpdir(), 'reader-acceptance-'));
const pdfPath = join(folder, 'Complex numbers.pdf');
const body = (title) => [title, '', 'Every complex number z = x + iy has a real part and an imaginary part.',
  'Multiplying two of them multiplies their lengths and adds their angles.'];
await writeFile(pdfPath, makePdf([body('Preface'), body('Contents'), body('1 Numbers'), body('1.1 Polar form'), body('2 Functions')], {
  outline: [{ title: 'Preface', page: 1 }, { title: '1 Numbers', page: 3, children: [{ title: '1.1 Polar form', page: 4 }] }, { title: '2 Functions', page: 5 }],
  pageLabels: [{ from: 0, style: 'r' }, { from: 2, style: 'D' }],
}));

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));
const at = (text) => page.getByText(text, { exact: true }).waitFor();
const canvasRatio = async () => {
  const box = await page.getByLabel(/^Page \d+$/).boundingBox();
  return box.height / box.width;
};
// Taps a point on the page, as fractions of its shown part.
const tapPage = async (x, y) => {
  const box = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
};

try {
  await page.goto(`${origin}/shelf`);
  await page.locator('input[aria-label="Add PDF"]').setInputFiles(pdfPath);
  await page.getByRole('link', { name: 'Open Complex numbers' }).click();

  // Printed page numbers: roman for the front matter, then 1, 2, 3.
  await at('p. i (1 of 5)');

  // Tapping the page's edges and the arrow keys turn it; a sideways swipe does too.
  await tapPage(0.9, 0.5);
  await at('p. ii (2 of 5)');
  await tapPage(0.1, 0.5);
  await at('p. i (1 of 5)');
  await page.keyboard.press('ArrowRight');
  await at('p. ii (2 of 5)');
  await page.keyboard.press('ArrowLeft');
  await at('p. i (1 of 5)');
  const overlay = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay.x + overlay.width * 0.7, overlay.y + 200);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.3, overlay.y + 210, { steps: 6 });
  await page.mouse.up();
  await at('p. ii (2 of 5)');
  // A tap in the middle doesn't turn it.
  await tapPage(0.5, 0.5);
  await at('p. ii (2 of 5)');
  console.log('PASS page turns: edge taps, arrow keys, swipes');

  // Go to a page by its printed number, or its place in the file; one that doesn't exist says so.
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('2');
  await page.getByLabel('Go to page').press('Enter');
  await at('p. 2 (4 of 5)');
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('ii');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await at('p. ii (2 of 5)');
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('40');
  await page.getByLabel('Go to page').press('Enter');
  await page.getByText('There is no page 40 in this PDF.').waitFor();
  await page.getByLabel('Go to page').press('Escape');
  await at('p. ii (2 of 5)');
  console.log('PASS go to page by printed number');

  // Contents from the bookmarks, nested, with where you are; tapping one goes there.
  await page.getByRole('tab', { name: 'Contents' }).click();
  const entries = page.getByRole('tabpanel').getByRole('button');
  assert.deepEqual((await entries.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')), ['Preface i', '1 Numbers 1', '1.1 Polar form 2', '2 Functions 3']);
  await page.getByRole('button', { name: /^1\.1 Polar form/ }).click();
  await at('p. 2 (4 of 5)');
  assert.equal(await page.getByRole('button', { name: /^1\.1 Polar form/ }).getAttribute('aria-current'), 'location');
  console.log('PASS contents from the bookmarks');

  // Blank margins are trimmed (the page is wider than tall would be for Letter), and that can be
  // turned off; the choice is kept for the book.
  assert.equal(await page.getByRole('button', { name: 'Trim margins' }).getAttribute('aria-pressed'), 'true');
  const trimmed = await canvasRatio();
  await page.getByRole('button', { name: 'Trim margins' }).click();
  await page.waitForTimeout(300);
  const whole = await canvasRatio();
  assert.ok(Math.abs(whole - 792 / 612) < 0.02, `the whole Letter page shows (${whole})`);
  assert.ok(Math.abs(trimmed - whole) > 0.05, `trimming changes the page's shape (${trimmed} vs ${whole})`);
  await page.waitForTimeout(1200);
  await page.reload();
  await at('p. 2 (4 of 5)');
  assert.equal(await page.getByRole('button', { name: 'Trim margins' }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: 'Trim margins' }).click();
  console.log('PASS margins trimmed, and kept off once turned off');

  // Full screen: only the page and its bars; a tap in the middle hides the bars and brings them back.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('link', { name: 'Home' }).waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Contents' }).waitFor({ state: 'hidden' });
  await tapPage(0.5, 0.4);
  await page.getByRole('button', { name: 'Exit full screen' }).waitFor({ state: 'hidden' });
  await tapPage(0.9, 0.4);
  await page.keyboard.press('ArrowLeft');
  await tapPage(0.5, 0.4);
  await at('p. 2 (4 of 5)');
  // The book's lists open as a panel over the page; choosing a section closes it.
  await page.getByRole('button', { name: 'Book: exercises and contents' }).click();
  await page.getByRole('tab', { name: 'Contents' }).click();
  await page.getByRole('button', { name: /^2 Functions/ }).click();
  await at('p. 3 (5 of 5)');
  await page.getByRole('region', { name: 'Book' }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByRole('link', { name: 'Home' }).waitFor();
  console.log('PASS full screen reading with bars on tap');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
