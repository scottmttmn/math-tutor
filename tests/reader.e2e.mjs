import { openTutor } from './tutor-ui.mjs';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makePdf } from './makePdf.mjs';

// Reading a Shelf PDF: turning pages, printed page numbers, contents, trimmed margins, full screen,
// ink, Your list and note pages.
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
const atPage = (text) => page.getByRole('button', { name: `${text}. Go to a page`, exact: true }).waitFor();
const trimControl = () => page.getByRole('menuitemcheckbox', { name: 'Trim margins' });
const openTextMenu = () => page.getByRole('button', { name: 'Text menu', exact: true }).click();
const canvasRatio = async () => {
  const box = await page.getByLabel(/^Page \d+$/).boundingBox();
  return box.height / box.width;
};
// Taps a point on the page, as fractions of its shown part.
const tapPage = async (x, y) => {
  const overlay = page.getByTestId('page-overlay');
  const box = await overlay.boundingBox();
  // Locator clicks wait for the page to settle after full-screen and bar layout changes.
  await overlay.click({ position: { x: box.width * x, y: box.height * y } });
};

try {
  await page.goto(`${origin}/`);
  await page.locator('input[aria-label="Add a PDF"]').setInputFiles(pdfPath);
  await page.getByRole('link', { name: 'Start reading' }).click();

  // Printed page numbers: roman for the front matter, then 1, 2, 3.
  await atPage('p. i (1 of 5)');

  // Compact controls keep pen-sized targets and names, including when the list is hidden.
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  const controls = page.getByRole('group', { name: 'Text controls' });
  for (const width of [1600, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    const buttons = await controls.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute('aria-label') || button.textContent.trim(), title: button.title, x: box.x, y: box.y, w: box.width, h: box.height };
    }));
    assert.ok(buttons.every((button) => button.w >= 44 && button.h >= 44), JSON.stringify(buttons));
    assert.equal(new Set(buttons.map((button) => button.y)).size, 1, `one reader toolbar row at ${width}px: ${JSON.stringify(buttons)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const name of ['Previous page', 'Next page', 'Pen', 'Highlight', 'Eraser', 'Full screen', 'Text menu']) {
      assert.equal(buttons.find((button) => button.name === name)?.title, name);
    }
    if (process.env.READER_SCREENSHOT_DIR) {
      await mkdir(process.env.READER_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.READER_SCREENSHOT_DIR, `reader-${width}.png`) });
    }
  }
  for (const width of [360, 420, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    await openTextMenu();
    const menu = await page.getByRole('menu', { name: 'Text menu' }).boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width, `Text menu fits at ${width}px: ${JSON.stringify(menu)}`);
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await controls.getByRole('button', { name: 'Your list', exact: true }).click();
  await openTextMenu();
  assert.equal(await trimControl().getAttribute('aria-checked'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Text menu' }).evaluate((button) => button === document.activeElement), true);
  console.log('PASS compact reader controls: one row at tablet and desktop sizes, 44px targets and keyboard menu');

  // Tapping the page's edges and the arrow keys turn it; a sideways swipe does too.
  await tapPage(0.9, 0.5);
  await atPage('p. ii (2 of 5)');
  await tapPage(0.1, 0.5);
  await atPage('p. i (1 of 5)');
  await page.keyboard.press('ArrowRight');
  await atPage('p. ii (2 of 5)');
  await page.keyboard.press('ArrowLeft');
  await atPage('p. i (1 of 5)');
  const overlay = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(overlay.x + overlay.width * 0.7, overlay.y + 200);
  await page.mouse.down();
  await page.mouse.move(overlay.x + overlay.width * 0.3, overlay.y + 210, { steps: 6 });
  await page.mouse.up();
  await atPage('p. ii (2 of 5)');
  // A tap in the middle doesn't turn it.
  await tapPage(0.5, 0.5);
  await atPage('p. ii (2 of 5)');
  console.log('PASS page turns: edge taps, arrow keys, swipes');

  // Go to a page by its printed number, or its place in the file; one that doesn't exist says so.
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('2');
  await page.getByLabel('Go to page').press('Enter');
  await atPage('p. 2 (4 of 5)');
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('ii');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await atPage('p. ii (2 of 5)');
  await page.getByRole('button', { name: /Go to a page/ }).click();
  await page.getByLabel('Go to page').fill('40');
  await page.getByLabel('Go to page').press('Enter');
  await page.getByText('There is no page 40 in this PDF.').waitFor();
  await page.getByLabel('Go to page').press('Escape');
  await atPage('p. ii (2 of 5)');
  // A box drawn but not saved doesn't follow you to another page (its crop would be of the wrong page).
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  const marking = await page.getByTestId('page-overlay').boundingBox();
  await page.mouse.move(marking.x + marking.width * 0.2, marking.y + marking.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(marking.x + marking.width * 0.6, marking.y + marking.height * 0.3, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Save and open' }).waitFor();
  await page.getByRole('button', { name: 'Next page' }).click();
  await atPage('p. 1 (3 of 5)');
  await page.getByRole('button', { name: 'Save and open' }).waitFor({ state: 'detached' });
  assert.equal(await page.getByTestId('page-overlay').locator('.border-dashed').count(), 0);
  await page.getByRole('button', { name: 'Done marking' }).click();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await atPage('p. ii (2 of 5)');
  console.log('PASS go to page by printed number; an unsaved box stays behind');

  // Contents from the bookmarks, nested, with where you are; tapping one goes there.
  await page.getByRole('tab', { name: 'Contents' }).click();
  const entries = page.getByRole('tabpanel').getByRole('button');
  assert.deepEqual((await entries.allInnerTexts()).map((text) => text.replace(/\s+/g, ' ')), ['Preface i', '1 Numbers 1', '1.1 Polar form 2', '2 Functions 3']);
  await page.getByRole('button', { name: /^1\.1 Polar form/ }).click();
  await atPage('p. 2 (4 of 5)');
  assert.equal(await page.getByRole('button', { name: /^1\.1 Polar form/ }).getAttribute('aria-current'), 'location');
  console.log('PASS contents from the bookmarks');

  // Blank margins are trimmed (the page is wider than tall would be for Letter), and that can be
  // turned off; the choice is kept for the book.
  await openTextMenu();
  assert.equal(await trimControl().getAttribute('aria-checked'), 'true');
  const trimmed = await canvasRatio();
  await trimControl().click();
  await page.waitForTimeout(300);
  const whole = await canvasRatio();
  assert.ok(Math.abs(whole - 792 / 612) < 0.02, `the whole Letter page shows (${whole})`);
  assert.ok(Math.abs(trimmed - whole) > 0.05, `trimming changes the page's shape (${trimmed} vs ${whole})`);
  await page.waitForTimeout(1200);
  await page.reload();
  await atPage('p. 2 (4 of 5)');
  await openTextMenu();
  assert.equal(await trimControl().getAttribute('aria-checked'), 'false');
  await trimControl().click();
  console.log('PASS margins trimmed, and kept off once turned off');

  // Full screen: only the page and its bars; a tap in the middle hides the bars and brings them back.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('link', { name: 'Home' }).waitFor({ state: 'hidden' });
  await page.getByRole('tab', { name: 'Contents' }).waitFor({ state: 'hidden' });
  // Entering full screen remounts the PDF, which first has its canvas's default size.
  await page.waitForFunction(() => document.fullscreenElement && document.querySelector('[data-testid="page-overlay"]')?.getBoundingClientRect().width > innerWidth * 0.8);
  await tapPage(0.5, 0.4);
  await page.getByRole('button', { name: 'Exit full screen' }).waitFor({ state: 'hidden' });
  await tapPage(0.9, 0.4);
  await page.getByLabel('Page 5', { exact: true }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await page.getByLabel('Page 4', { exact: true }).waitFor();
  await tapPage(0.5, 0.4);
  await atPage('p. 2 (4 of 5)');
  // The book's lists open as a panel over the page; choosing a section closes it.
  await page.getByRole('button', { name: 'Lists: your list, contents and search' }).click();
  await page.getByRole('tab', { name: 'Contents' }).click();
  await page.getByRole('button', { name: /^2 Functions/ }).click();
  await atPage('p. 3 (5 of 5)');
  await page.getByRole('region', { name: 'Lists' }).waitFor({ state: 'detached' });
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
  await atPage('p. 3 (5 of 5)');
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
  await atPage('p. 2 (4 of 5)');
  await inkShown(0);
  await page.waitForTimeout(1200);
  await page.reload();
  await atPage('p. 2 (4 of 5)');
  await page.getByRole('button', { name: 'Next page' }).click();
  await atPage('p. 3 (5 of 5)');
  await inkShown(withHighlight);
  console.log('PASS ink on the page: pen, highlighter, eraser, undo, kept after reload');

  // Your list: what was made in the book, by section; a highlight across a line of print quotes it.
  // The rows of print on the page, as fractions of its height (from the rendered page's dark pixels).
  // The page label and saved ink can update before PDF.js finishes painting the new canvas.
  const printed = await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas[aria-label^="Page "]');
    if (!canvas) return false;
    const { width, height } = canvas;
    const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
    const rows = [];
    let from = -1;
    for (let y = 0; y <= height; y += 1) {
      let dark = false;
      for (let x = 0; y < height && x < width && !dark; x += 2) dark = data[(y * width + x) * 4] < 128;
      if (dark && from < 0) from = y;
      if (!dark && from >= 0) { rows.push((from + y) / 2 / height); from = -1; }
    }
    return rows.length >= 3 ? rows : false;
  });
  const printRows = await printed.jsonValue();
  await printed.dispose();
  assert.ok(printRows.length >= 3, `found the lines of print (${printRows})`);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await stroke([0.02, printRows[1]], [0.3, printRows[1]]);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  const functions = page.getByRole('region', { name: '2 Functions' });
  await functions.getByRole('button', { name: /^“Every complex.*” p\. 3$/ }).waitFor();
  await functions.getByRole('button', { name: /^Highlight p\. 3$/ }).waitFor();
  await functions.getByRole('button', { name: /^Your ink, p\. 3/ }).waitFor();

  // A note page: Mark, choose Note, and it opens on a lined Notes board (the tutor explains there,
  // so it reads no book pages); the paper can be changed and is kept with the board.
  const markBox = async (from, to) => {
    const area = await page.getByTestId('page-overlay').boundingBox();
    await page.mouse.move(area.x + area.width * from[0], area.y + area.height * from[1]);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width * to[0], area.y + area.height * to[1], { steps: 5 });
    await page.mouse.up();
  };
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  await markBox([0.1, 0.1], [0.8, 0.3]);
  assert.equal(await page.getByLabel('Name').inputValue(), 'Exercise 1');
  await page.getByRole('radio', { name: 'Note' }).click();
  assert.equal(await page.getByLabel('Name').inputValue(), 'Note 1');
  await page.getByRole('button', { name: 'Save and open' }).click();
  await page.getByRole('heading', { name: 'Note 1' }).waitFor();
  await page.locator('.tl-image').waitFor();
  await page.locator('[data-paper="lined"]').waitFor();
  assert.equal(await page.getByText('Tutor reads').count(), 0);
  await openTutor(page);
  await page.getByRole('group', { name: 'Tutor choices' }).getByRole('button', { name: 'Explain this' }).waitFor();
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('button', { name: 'Paper: Lined' }).click();
  await page.getByRole('menuitemradio', { name: 'Grid' }).click();
  await page.locator('[data-paper="grid"]').waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.getByRole('heading', { name: 'Note 1' }).waitFor();
  await page.locator('[data-paper="grid"]').waitFor();
  await page.getByRole('button', { name: 'Close board' }).click();
  await functions.getByRole('button', { name: /^Note 1 p\. 3$/ }).waitFor();
  assert.equal(await page.getByTestId('page-overlay').locator('.border-dotted').count(), 1, 'the note is marked dotted on the page');
  // Later marks keep the last kind chosen; the tablet check below marks an exercise.
  console.log('PASS Your list; a note page opens on a lined Notes board, and its paper can change');

  // Search: every place the words are, by section, with the line around them; a result opens its
  // page with the words lit, and Clear puts them out.
  await page.getByRole('tab', { name: 'Search' }).click();
  await page.getByLabel('Search this text').fill('ADDS their   angles');
  await at('5 matches on 5 pages.');
  const polar = page.getByRole('region', { name: '1.1 Polar form' });
  const result = polar.getByRole('button', { name: /their lengths and adds their angles\. p\. 2$/ });
  assert.equal(await result.locator('mark').innerText(), 'adds their angles');
  await result.click();
  await atPage('p. 2 (4 of 5)');
  const hit = page.getByTestId('search-hit');
  await hit.waitFor();
  assert.equal(await hit.count(), 1);
  const hitBox = await hit.boundingBox();
  const pageBox = await page.getByTestId('page-overlay').boundingBox();
  assert.ok(hitBox.width > 40 && hitBox.x > pageBox.x + pageBox.width * 0.3 && hitBox.y < pageBox.y + pageBox.height * 0.5,
    `the words are lit where they are printed (${JSON.stringify(hitBox)} on ${JSON.stringify(pageBox)})`);
  await page.getByLabel('Search this text').fill('quaternion');
  await at('Not found in this text.');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  assert.equal(await hit.count(), 0);
  await page.getByRole('tab', { name: 'Your list' }).click();
  await page.getByRole('button', { name: 'Next page' }).click();
  await atPage('p. 3 (5 of 5)');
  console.log('PASS search finds words by section and lights them on the page');

  // Ask about the page: Ask, drag a box, ask; the tutor gets the box and explains it as on a note page.
  // Closing drops the conversation; Save as note page keeps it on a new note page.
  const asked = [];
  const reply = (text) => [{ type: 'text_delta', content: text }, { type: 'message_stop' }].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
  await page.route('**/api/tutor', (route) => {
    asked.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: reply(`Reply ${asked.length} about the box.`) });
  });
  const askAbout = async (question) => {
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await markBox([0.1, 0.35], [0.8, 0.5]);
    if (question) await page.getByLabel('Your question about the box').fill(question);
    await page.getByRole('button', { name: 'Ask', exact: true }).last().click();
  };
  const askPanel = page.getByRole('region', { name: 'Tutor' });
  await askAbout('Why do the angles add?');
  await askPanel.getByText('Reply 1 about the box.').waitFor();
  assert.equal(asked[0].sessionType, 'note');
  assert.equal(asked[0].userQuestion, 'Why do the angles add?');
  assert.ok(asked[0].problemImage?.length > 100, 'the box goes as the figure');
  assert.equal(asked[0].canvasImage, '');
  assert.equal(asked[0].bookContext, undefined);
  await askPanel.getByRole('button', { name: 'Close tutor' }).click();
  await page.getByRole('tab', { name: 'Your list' }).waitFor();
  await askAbout('');
  await askPanel.getByText('Reply 2 about the box.').waitFor({ timeout: 15000 });
  assert.equal(asked[1].userQuestion, 'Can you explain this?');
  await askPanel.getByRole('button', { name: 'Save as note page' }).click();
  await page.getByRole('heading', { name: 'Note 2' }).waitFor();
  await openTutor(page);
  await page.getByText('Reply 2 about the box.').waitFor();
  assert.equal(await page.getByText('Reply 1 about the box.').count(), 0, 'a closed question is not kept');
  await page.getByRole('button', { name: 'Close board' }).click();
  await functions.getByRole('button', { name: /^Note 2 p\. 3$/ }).waitFor();
  await page.unroute('**/api/tutor');
  console.log('PASS asking about a box on the page, closed or saved as a note page');

  // An upright tablet: an exercise opens on its board, which takes the screen with the exercise
  // put on it; the page button swaps the page in, and Back to board (or its mark) swaps back.
  await page.setViewportSize({ width: 800, height: 1100 });
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  await markBox([0.1, 0.1], [0.7, 0.25]);
  await page.getByRole('radio', { name: 'Exercise' }).click();
  await page.getByRole('button', { name: 'Save and open' }).click();
  await page.locator('.tl-image').waitFor();
  await page.getByTestId('page-overlay').waitFor({ state: 'hidden' });
  const boardBox = await page.locator('.tl-canvas').boundingBox();
  assert.ok(boardBox.height > 600, `the board takes the screen (${boardBox.height}px tall)`);
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).click();
  await page.getByTestId('notebook-paper').waitFor();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
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
  await page.getByTestId('notebook-paper').waitFor();
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  assert.equal(await page.locator('.tl-image').count(), 1, 'notebook navigation does not duplicate the problem picture');
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).click();
  await page.getByTestId('notebook-paper').waitFor({ state: 'detached' });
  console.log('PASS on an upright tablet the exercise opens on its board, swapping with the page');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} catch (error) {
  console.error('Reader browser exceptions:', browserErrors);
  throw error;
} finally {
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
