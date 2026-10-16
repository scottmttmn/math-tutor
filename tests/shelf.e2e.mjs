import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makePdf } from './makePdf.mjs';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
const folder = await mkdtemp(join(tmpdir(), 'shelf-acceptance-'));
const pdfPath = join(folder, 'Algebra drills.pdf');
await writeFile(pdfPath, makePdf([
  ['Chapter 1 Exercises', '', '1. Find all z with z^3 = 1.', '', '2. Show that |zw| = |z||w|.', '',
    'Reminder: the n-th roots of unity are the numbers e^(2 pi i k / n) for k = 0, ..., n - 1.',
    'They are the vertices of a regular n-gon inscribed in the unit circle.'],
  ['3. Compute (1+i)^8.', '', '4. Describe the set |z - 1| < 2.'],
]));
const imagePath = join(folder, 'one problem.png');
const secondPdfPath = join(folder, 'Geometry notes.pdf');
await writeFile(secondPdfPath, makePdf([['Angles in a triangle sum to 180 degrees.']]));

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
  // The app opens on Home, the library, empty until something is added; there is no Shelf tab.
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.getByText('Nothing here yet.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Shelf', exact: true }).count(), 0);
  // An old link to the Shelf lands on Home.
  await page.goto(`${origin}/shelf`);
  await page.waitForURL(`${origin}/`);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();

  // + New → Add a PDF opens the new book's page, with its page count; Start reading opens the reader.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Add a PDF…' }).waitFor();
  await page.locator('input[aria-label="Add a PDF"]').setInputFiles(pdfPath);
  await page.getByRole('heading', { name: 'Algebra drills', exact: true }).waitFor();
  assert.match(new URL(page.url()).pathname, /^\/book$/);
  await page.getByText(/2 pages/).waitFor();
  await page.getByText(/^None yet\./).waitFor();
  // Adding another PDF from a book's page shows the new book; Back shows the first again.
  await page.locator('input[aria-label="Add a PDF"]').setInputFiles(secondPdfPath);
  await page.getByRole('heading', { name: 'Geometry notes', exact: true }).waitFor();
  await page.goBack();
  await page.getByRole('heading', { name: 'Algebra drills', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Start reading' }).click();
  await page.getByText('Page 1 of 2').waitFor();

  // Mark an exercise: drag a box on the page, keep the suggested name, and its board opens.
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  const overlay = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay.x + overlay.width * 0.1, overlay.y + overlay.height * 0.13);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.6, overlay.y + overlay.height * 0.17, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Exercise 1');
  await page.getByRole('button', { name: 'Save and open' }).click();
  await exerciseHeading('Exercise 1').waitFor();
  // A new board opens with its exercise on it, locked, for the tutor to read work written on it.
  await page.locator('.tl-image').waitFor();
  await drawStroke();
  await page.getByText('Saved', { exact: true }).waitFor();

  // Ask for help: the marked region goes to the tutor as the problem image, the board as the work.
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  await page.getByText('Shelf hint.').waitFor();
  const content = requests.at(-1).messages.at(-1).content;
  assert.equal(content.filter((part) => part.type === 'image_url').length, 2, 'problem image and board');
  assert.match(JSON.stringify(content), /Exercise 1 · Algebra drills, p\. 1/);
  // Each image is labeled, so the board (which can hold a copy of the figure) reads as the work.
  assert.deepEqual(content.map((part) => part.type === 'text' ? part.text.split(/[ ,:]/)[0] + ' ' + part.text.split(/[ ,:]/)[1] : part.type),
    ['Problem figure', 'image_url', 'My board', 'image_url', 'The problem']);
  // The tutor reads the book up to the exercise's page, never past it.
  assert.equal(await page.getByLabel('Tutor reads').inputValue(), '1');
  // The pages open the conversation as user text; only the rule about them is in the system prompt.
  const [system, pages] = requests.at(-1).messages;
  assert.equal(system.role, 'system');
  assert.doesNotMatch(system.content, /roots of unity/);
  assert.equal(pages.role, 'user');
  assert.match(pages.content, /<book_pages>[\s\S]*roots of unity/);
  assert.doesNotMatch(pages.content, /Compute \(1\+i\)\^8/);

  // Solving shows on the page's mark; a reload returns to the same board with the stroke.
  // The tutor opened in its drawer; closing it leaves the page and the board.
  await page.getByRole('complementary', { name: 'Tutor' }).waitFor();
  await page.getByRole('button', { name: 'Close tutor' }).click();
  await page.getByRole('button', { name: 'Mark solved', exact: true }).click();
  await page.getByRole('button', { name: 'Open Exercise 1' }).filter({ hasText: '✓' }).waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await exerciseHeading('Exercise 1').waitFor();
  await page.locator('.tl-image').waitFor();
  assert.equal(await shapeCount(), 2);
  const pictureOnBoard = () => page.locator('.tl-image').first().evaluate((image) => image.src);
  const firstPicture = await pictureOnBoard();

  // A second exercise on page 2 gets its own empty board; the first keeps its work.
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.getByText('Page 2 of 2').waitFor();
  await page.getByRole('button', { name: 'Mark', exact: true }).click();

  // A box near the foot of a scrolled page stays drawn, its form opens beside it in view, and
  // dragging again redraws it.
  await page.setViewportSize({ width: 1280, height: 600 });
  let overlay2 = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay2.x + overlay2.width / 2, overlay2.y + 200);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(200);
  overlay2 = await page.getByTestId('page-overlay').boundingBox();
  assert.ok(overlay2.y < 0, 'the page is scrolled');
  const footY = Math.min(overlay2.y + overlay2.height * 0.9, 560);
  await page.mouse.move(overlay2.x + overlay2.width * 0.1, footY - 40);
  await page.mouse.down();
  await page.mouse.move(overlay2.x + overlay2.width * 0.5, footY, { steps: 5 });
  await page.mouse.up();
  const saveBox = await page.getByRole('button', { name: 'Save and open' }).boundingBox();
  assert.ok(saveBox.y >= 0 && saveBox.y + saveBox.height <= 600, 'the save form is in view');
  assert.equal(await page.getByTestId('page-overlay').locator('.border-dashed').count(), 1, 'the box stays drawn');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await page.getByTestId('page-overlay').locator('.border-dashed').count(), 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByTestId('page-overlay').evaluate((element) => element.closest('.overflow-y-auto').scrollTo(0, 0));
  overlay2 = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay2.x + overlay2.width * 0.1, overlay2.y + overlay2.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(overlay2.x + overlay2.width * 0.5, overlay2.y + overlay2.height * 0.35, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(overlay2.x + overlay2.width * 0.1, overlay2.y + overlay2.height * 0.07);
  await page.mouse.down();
  await page.mouse.move(overlay2.x + overlay2.width * 0.5, overlay2.y + overlay2.height * 0.11, { steps: 5 });
  await page.mouse.up();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Exercise 2');
  await page.getByLabel('Name').fill('Problem 3');
  await page.getByRole('button', { name: 'Save and open' }).click();
  await exerciseHeading('Problem 3').waitFor();
  await page.locator('.tl-image').waitFor();
  assert.equal(await shapeCount(), 1);
  // Its own picture: the last board's (locked) one doesn't stay behind.
  await page.waitForTimeout(300);
  assert.notEqual(await pictureOnBoard(), firstPicture);
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.getByRole('button', { name: 'Open Exercise 1' }).click();
  await exerciseHeading('Exercise 1').waitFor();
  await page.locator('.tl-shape').first().waitFor();
  await page.waitForTimeout(300);
  assert.equal(await shapeCount(), 2, 'its exercise and the stroke, not a second copy');
  console.log('PASS add a PDF, mark exercises, boards beside the page, tutor sees the marked region, reload');

  // The marked problem is on the board once; Put on board finds it rather than adding another,
  // and Clear leaves it there.
  await page.getByRole('button', { name: 'Put on board' }).click();
  await page.waitForTimeout(300);
  assert.equal(await shapeCount(), 2, 'placed only once');
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.waitForTimeout(300);
  assert.equal(await shapeCount(), 1, 'Clear keeps the problem');

  // Full screen hides the page and gives the board the window; asking for help leaves it.
  const boardWidth = (await page.locator('.tl-canvas').boundingBox()).width;
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByText('Page 1 of 2').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  assert.ok((await page.locator('.tl-canvas').boundingBox()).width > boardWidth * 1.5, 'the board fills the window');
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByText('Page 1 of 2').waitFor();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  await page.getByRole('button', { name: 'Full screen' }).waitFor();
  await page.getByText('Shelf hint.').last().waitFor();
  // Hiding the tools leaves the pen writing; the choice survives a reload.
  await page.locator('.tlui-layout').waitFor();
  await page.getByRole('button', { name: 'Hide tools' }).click();
  await page.locator('.tlui-layout').waitFor({ state: 'detached' });
  const before = await shapeCount();
  await drawStroke(200);
  await page.waitForTimeout(300);
  assert.equal(await shapeCount(), before + 1, 'the pen still writes');
  await page.reload();
  await page.getByRole('button', { name: 'Show tools' }).click();
  await page.locator('.tlui-layout').waitFor();
  console.log('PASS the problem goes on the board; full screen board');


  // The book's page lists both of its boards; Home lists the book, and a search there finds the
  // exercise with work in it (not the empty one), opening it beside its page.
  await page.getByRole('button', { name: 'Close board' }).click();
  await page.getByRole('tab', { name: 'Your list', exact: true }).waitFor();
  // The list beside the page can be hidden, so the page gets the width; it stays hidden after a reload.
  const pageWidth = (await page.getByTestId('page-overlay').boundingBox()).width;
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await page.getByRole('tab', { name: 'Your list', exact: true }).waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
  assert.ok((await page.getByTestId('page-overlay').boundingBox()).width > pageWidth * 1.3, 'the page is wider');
  await page.reload();
  await page.getByRole('button', { name: 'Your list', exact: true }).click();
  await page.getByRole('tab', { name: 'Your list', exact: true }).waitFor();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Algebra drills' }).waitFor();
  await page.getByRole('link', { name: 'Algebra drills', exact: true }).click();
  const bookBoards = page.locator('[aria-labelledby="book-boards-heading"]');
  await bookBoards.getByRole('button', { name: /^Open Exercise 1/ }).waitFor();
  await bookBoards.getByRole('button', { name: /^Open Problem 3/ }).waitFor();
  await page.getByText(/1 of 2 solved/).waitFor();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.locator('[aria-labelledby="books-heading"]').getByRole('link', { name: 'Open Algebra drills' }).waitFor();
  assert.equal(await page.locator('[aria-labelledby="boards-heading"]').count(), 0, 'a book’s boards are on its page');
  await page.getByRole('searchbox', { name: 'Search books, problems and notes' }).fill('exercise');
  const history = page.locator('[aria-labelledby="boards-heading"]');
  await history.getByRole('button', { name: /^Open Exercise 1/ }).waitFor();
  assert.equal(await history.getByRole('button', { name: /^Open Problem 3/ }).count(), 0);
  assert.match(await history.locator('li').first().innerText(), /Algebra drills/);
  await history.getByRole('button', { name: /^Open Exercise 1/ }).click();
  await exerciseHeading('Exercise 1').waitFor();
  await page.getByText('Page 1 of 2').waitFor();

  // Removing a mark removes its board.
  await page.getByRole('button', { name: 'More for Exercise 1' }).click();
  await page.getByRole('menuitem', { name: 'Remove exercise' }).click();
  await page.getByRole('tab', { name: 'Your list', exact: true }).waitFor();
  // The board closes before the mark's removal is written, so wait for the mark to go.
  await page.getByRole('button', { name: 'Open Exercise 1' }).waitFor({ state: 'detached' });
  console.log('PASS a book’s page lists its boards; a search on Home finds them; removing a mark removes its board');

  // A new problem takes a picture of itself as its figure.
  await page.goto(`${origin}/`);
  // Any picture will do as the problem; take one of the page's top.
  await writeFile(imagePath, await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 80 } }));
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'New Problem' }).click();
  await page.waitForURL(`${origin}/board`);
  await page.locator('input[aria-label="Problem picture"]').setInputFiles(imagePath);
  await page.getByAltText(/problem/i).first().waitFor();
  // Its picture can go on the board, and the board can take the whole screen.
  await page.locator('.tl-canvas').waitFor();
  await page.getByRole('button', { name: 'Put on board' }).click();
  await page.locator('.tl-image').waitFor();
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('link', { name: 'Home' }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByAltText(/problem/i).count(), 0, 'the problem header is hidden');
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await page.getByRole('link', { name: 'Home' }).waitFor();
  console.log('PASS a new problem takes a picture; it goes on the board; full screen main board');

  // The book's card on Home: asks what the PDF is until told, then shows it, with solved progress and
  // where you left off; the kind can be changed from the menu.
  await page.goto(`${origin}/`);
  // Geometry notes, added too, still asks what it is, so look inside Algebra drills' card.
  const bookCard = page.locator('li', { has: page.getByRole('link', { name: 'Open Algebra drills' }) });
  const kinds = page.getByRole('group', { name: 'What Algebra drills is' });
  await kinds.getByRole('button', { name: 'Problem set' }).click();
  await kinds.waitFor({ state: 'hidden' });
  await bookCard.getByText('Problem set', { exact: true }).waitFor();
  await bookCard.getByText(/^\d+ of \d+ solved/).waitFor();
  await bookCard.getByText(/^p\. \d+/).waitFor();
  await page.reload();
  await bookCard.getByText('Problem set', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'More for Algebra drills' }).click();
  await page.getByRole('menuitem', { name: 'Change kind' }).click();
  await kinds.getByRole('button', { name: 'Textbook' }).click();
  await bookCard.getByText('Textbook', { exact: true }).waitFor();
  console.log('PASS the book card shows its kind, solved progress and where you left off');

  // Removing the PDF takes its remaining boards with it.
  await page.getByRole('button', { name: 'More for Algebra drills' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('link', { name: 'Open Algebra drills' }).waitFor({ state: 'detached' });
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
