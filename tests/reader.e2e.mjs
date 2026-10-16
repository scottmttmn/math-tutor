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
  // A box drawn but not saved doesn't follow you to another page (its crop would be of the wrong page).
  await page.getByRole('button', { name: 'Mark exercise' }).click();
  const marking = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(marking.x + marking.width * 0.2, marking.y + marking.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(marking.x + marking.width * 0.6, marking.y + marking.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save and open' }).waitFor();
  await page.getByRole('button', { name: 'Next page' }).click();
  await at('p. 1 (3 of 5)');
  await page.getByRole('button', { name: 'Save and open' }).waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('page-overlay').locator('.border-dashed').count(), 0);
  await page.getByRole('button', { name: 'Done marking' }).click();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await at('p. ii (2 of 5)');
  console.log('PASS go to page by printed number; an unsaved box stays behind');

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

  // Ink: the pen writes on the page (a finger would still turn it), saved with the page.
  const inkPixels = () => page.getByTestId('page-ink').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
  // Waits for the page's ink to show this many pixels (it is drawn once the page and its ink load).
  const inkShown = async (expected) => {
    for (let tries = 0; tries < 50 && await inkPixels() !== expected; tries += 1) await page.waitForTimeout(100);
    assert.equal(await inkPixels(), expected);
  };
  const stroke = async (from, to) => {
    const box = await page.getByTestId('page-overlay').boundingBox();
    await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 });
    await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  assert.equal(await inkPixels(), 0);
  // Drawn across the page's edge zone: with the pen on, it writes instead of turning the page.
  await stroke([0.6, 0.3], [0.9, 0.35]);
  await at('p. 3 (5 of 5)');
  const penInk = await inkPixels();
  assert.ok(penInk > 50, `the pen wrote (${penInk} px)`);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await stroke([0.2, 0.6], [0.7, 0.6]);
  const withHighlight = await inkPixels();
  assert.ok(withHighlight > penInk * 2, `the highlight is wider than the pen (${withHighlight} vs ${penInk})`);
  // The eraser rubs out the stroke it crosses, and Undo brings it back.
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await stroke([0.45, 0.5], [0.45, 0.7]);
  assert.equal(await inkPixels(), penInk);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await inkShown(withHighlight);
  // Off again, and a tap at the edge turns the page; the ink stays with its page.
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).waitFor({ state: 'detached' });
  await tapPage(0.1, 0.5);
  await at('p. 2 (4 of 5)');
  await inkShown(0);
  await page.waitForTimeout(1200);
  await page.reload();
  await at('p. 2 (4 of 5)');
  await page.getByRole('button', { name: 'Next page' }).click();
  await at('p. 3 (5 of 5)');
  await inkShown(withHighlight);
  console.log('PASS ink on the page: pen, highlighter, eraser, undo, kept after reload');

  // An upright tablet: an exercise opens on its board, which takes the screen with the exercise
  // put on it; the page button swaps the page in, and Back to board (or its mark) swaps back.
  await page.setViewportSize({ width: 800, height: 1100 });
  await page.getByRole('button', { name: 'Mark exercise' }).click();
  const markArea = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(markArea.x + markArea.width * 0.1, markArea.y + markArea.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(markArea.x + markArea.width * 0.7, markArea.y + markArea.height * 0.25, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save and open' }).click();
  await page.locator('.tl-image').waitFor();
  await page.getByTestId('page-overlay').waitFor({ state: 'hidden' });
  const boardBox = await page.locator('.tl-canvas').boundingBox();
  assert.ok(boardBox.height > 600, `the board takes the screen (${boardBox.height}px tall)`);
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await page.getByTestId('page-overlay').waitFor();
  await page.locator('.tl-canvas').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Back to board' }).click();
  await page.locator('.tl-canvas').waitFor();
  await page.getByTestId('page-overlay').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await page.getByRole('button', { name: 'Open Exercise 1' }).click();
  await page.locator('.tl-canvas').waitFor();
  await page.getByTestId('page-overlay').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.tl-image').count(), 1, 'put on the board once');
  console.log('PASS on an upright tablet the exercise opens on its board, swapping with the page');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
