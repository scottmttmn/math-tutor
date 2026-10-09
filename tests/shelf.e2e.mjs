import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makePdf } from './makePdf.mjs';

const origin = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
const folder = await mkdtemp(join(tmpdir(), 'shelf-acceptance-'));
const pdfPath = join(folder, 'Algebra drills.pdf');
await writeFile(pdfPath, makePdf([
  ['Chapter 1 Exercises', '', '1. Find all z with z^3 = 1.', '', '2. Show that |zw| = |z||w|.'],
  ['3. Compute (1+i)^8.', '', '4. Describe the set |z - 1| < 2.'],
]));
const imagePath = join(folder, 'one problem.png');

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Shelf hint.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));

async function drawStroke(offset = 0) {
  const board = await page.locator('.tl-canvas').boundingBox();
  await page.mouse.move(board.x + 120 + offset, board.y + 120);
  await page.mouse.down();
  await page.mouse.move(board.x + 260 + offset, board.y + 180, { steps: 8 });
  await page.mouse.up();
}
const shapeCount = () => page.locator('.tl-shape').count();
const exerciseHeading = (name) => page.getByRole('heading', { name, exact: true });

try {
  await page.goto(`${origin}/`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.getByRole('link', { name: 'Shelf' }).click();
  await page.getByText('Your Shelf is empty.').waitFor();

  // Add a PDF; it lands on the Shelf with its page count.
  await page.locator('input[aria-label="Add PDF"]').setInputFiles(pdfPath);
  const card = page.getByRole('link', { name: 'Open Algebra drills' });
  await card.waitFor();
  assert.match(await page.locator('li', { has: card }).innerText(), /2 pages/);
  await card.click();
  await page.getByText('Page 1 of 2').waitFor();

  // Mark an exercise: drag a box on the page, keep the suggested name, and its board opens.
  await page.getByRole('button', { name: 'Mark exercise' }).click();
  const overlay = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay.x + overlay.width * 0.1, overlay.y + overlay.height * 0.13);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.6, overlay.y + overlay.height * 0.17, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Exercise 1');
  await page.getByRole('button', { name: 'Save and open' }).click();
  await exerciseHeading('Exercise 1').waitFor();
  await page.locator('.tl-canvas').waitFor();
  await drawStroke();
  await page.getByText('Saved', { exact: true }).waitFor();

  // Ask for help: the marked region goes to the tutor as the problem image, the board as the work.
  await page.getByRole('button', { name: 'Ask for Help' }).click();
  await page.getByText('Shelf hint.').waitFor();
  const content = requests.at(-1).messages.at(-1).content;
  assert.equal(content.filter((part) => part.type === 'image_url').length, 2, 'problem image and board');
  assert.match(JSON.stringify(content), /Exercise 1 · Algebra drills, p\. 1/);

  // Solving shows on the page's mark; a reload returns to the same board with the stroke.
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  await page.getByRole('button', { name: /Mark Solved/ }).click();
  await page.getByRole('button', { name: 'Open Exercise 1' }).filter({ hasText: '✓' }).waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await exerciseHeading('Exercise 1').waitFor();
  await page.locator('.tl-shape').first().waitFor();
  assert.equal(await shapeCount(), 1);

  // A second exercise on page 2 gets its own empty board; the first keeps its work.
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByText('Page 2 of 2').waitFor();
  await page.getByRole('button', { name: 'Mark exercise' }).click();
  const overlay2 = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay2.x + overlay2.width * 0.1, overlay2.y + overlay2.height * 0.07);
  await page.mouse.down();
  await page.mouse.move(overlay2.x + overlay2.width * 0.5, overlay2.y + overlay2.height * 0.11, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Exercise 2');
  await page.getByLabel('Name').fill('Problem 3');
  await page.getByRole('button', { name: 'Save and open' }).click();
  await exerciseHeading('Problem 3').waitFor();
  await page.locator('.tl-canvas').waitFor();
  assert.equal(await shapeCount(), 0);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.getByRole('button', { name: 'Open Exercise 1' }).click();
  await exerciseHeading('Exercise 1').waitFor();
  await page.locator('.tl-shape').first().waitFor();
  assert.equal(await shapeCount(), 1);
  console.log('PASS add a PDF, mark exercises, boards beside the page, tutor sees the marked region, reload');

  // History lists the exercise with work in it (not the empty one) and opens it beside its page.
  await page.getByRole('button', { name: 'Close board' }).click();
  await page.getByRole('heading', { name: 'Exercises', exact: true }).waitFor();
  await page.goto(`${origin}/`);
  await page.getByRole('button', { name: 'History' }).click();
  const history = page.getByRole('dialog', { name: 'History' });
  await history.getByRole('button', { name: /^Open Exercise 1/ }).waitFor();
  assert.equal(await history.getByRole('button', { name: /^Open Problem 3/ }).count(), 0);
  assert.match(await history.locator('li').first().innerText(), /Shelf/);
  await history.getByRole('button', { name: /^Open Exercise 1/ }).click();
  await exerciseHeading('Exercise 1').waitFor();
  await page.getByText('Page 1 of 2').waitFor();

  // Removing a mark removes its board.
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('heading', { name: 'Exercises', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open Exercise 1' }).count(), 0);
  console.log('PASS History opens Shelf exercises; removing a mark removes its board');

  // A single problem goes straight onto a new board as its problem image.
  await page.goto(`${origin}/shelf`);
  // Any picture will do as the problem; take one of the Shelf header.
  await writeFile(imagePath, await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 80 } }));
  await page.locator('input[aria-label="Single problem"]').setInputFiles(imagePath);
  await page.waitForURL(`${origin}/`, { waitUntil: 'commit' });
  await page.getByAltText(/problem/i).first().waitFor();
  console.log('PASS a single problem opens on a new board');

  // Removing the PDF takes its remaining boards with it.
  await page.goto(`${origin}/shelf`);
  await page.getByRole('button', { name: 'Remove Algebra drills' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('Your Shelf is empty.').waitFor();
  const shelfSessions = await page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('math-tutor');
    open.onsuccess = () => {
      const all = open.result.transaction('sessions').objectStore('sessions').getAllKeys();
      all.onsuccess = () => resolve(all.result.filter((key) => String(key).startsWith('shelf:')));
    };
  }));
  assert.deepEqual(shelfSessions, []);
  assert.deepEqual(browserErrors, []);
  console.log('PASS removing a PDF removes its boards; no browser exceptions');
} finally {
  await browser.close();
  provider.close();
  await rm(folder, { recursive: true, force: true });
}
