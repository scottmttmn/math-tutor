import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openTutor } from './tutor-ui.mjs';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1366 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  await page.route('**/api/tutor', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"text_delta","content":"Notebook checked."}\n\ndata: {"type":"message_stop"}\n\n' });
  });
  await page.goto(`${origin}/board?new=problem`);
  const canvas = page.locator('.tl-canvas');
  await canvas.waitFor();
  const controls = page.getByRole('group', { name: 'Board controls' });
  const paper = page.getByTestId('notebook-paper');
  const fit = controls.getByRole('button', { name: 'Fit width', exact: true });
  async function toggle() {
    await controls.getByRole('button', { name: 'Board menu' }).click();
    await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).click();
  }
  async function assertFit() {
    await page.waitForFunction(() => {
      const paper = document.querySelector('[data-testid="notebook-paper"]');
      const canvas = document.querySelector('.tl-canvas');
      return paper && canvas && Math.abs(paper.getBoundingClientRect().width - (canvas.getBoundingClientRect().width - 32)) < 2;
    }, null, { timeout: 5000 });
  }
  // The page has a top: scrolling up stops with its edge just below the board's top.
  async function assertTop() {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 250);
    for (let step = 0; step < 5; step += 1) await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(250);
    const top = (await paper.boundingBox()).y;
    assert.ok(Math.abs(top - (box.y + 16)) < 2, `the notebook stops at its top (page ${top}, board ${box.y})`);
  }
  async function draw(x, y) {
    const box = await canvas.boundingBox();
    await page.getByTestId('tools.draw').click();
    await page.mouse.move(box.x + x, box.y + y, { steps: 4 });
    await page.waitForTimeout(50);
    await page.mouse.down();
    await page.mouse.move(box.x + x + 110, box.y + y + 45, { steps: 12 });
    await page.mouse.up();
    await controls.getByRole('button', { name: 'Clear board', exact: true }).and(page.locator(':enabled')).waitFor();
  }
  async function savedShapes() {
    await page.waitForTimeout(1300);
    return page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('math-tutor');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const session = await new Promise((resolve, reject) => {
        const request = db.transaction('sessions').objectStore('sessions').get(localStorage.getItem('math-tutor:currentSession'));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      return session.canvasDocument ? Object.values(session.canvasDocument.store).filter((record) => record.typeName === 'shape') : session.canvasStrokes;
    });
  }
  assert.equal(await fit.count(), 0, 'the experiment starts off');
  await toggle();
  await paper.waitFor();
  assert.equal(await paper.getAttribute('data-page-width'), '960');
  await assertFit();
  await assertTop();
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Notebook experiment');
  await controls.getByRole('button', { name: 'Paper: Blank' }).click();
  await page.getByRole('menuitemradio', { name: 'Lined', exact: true }).click();
  await draw(110, 190);
  const originalShapes = await savedShapes();
  assert.equal(originalShapes.length, 1);
  const stroke = page.locator('.tl-shape').first();
  const beforePan = await stroke.boundingBox();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 250);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(250);
  const afterPan = await stroke.boundingBox();
  assert.ok(afterPan.y < beforePan.y - 30, 'wheel scrolls downward through the notebook');
  assert.ok(Math.abs(afterPan.width - beforePan.width) < 1, 'scrolling keeps the writing scale');
  await page.mouse.wheel(500, 0);
  await page.waitForTimeout(250);
  await assertFit();
  assert.ok(Math.abs((await stroke.boundingBox()).x - afterPan.x) < 1, 'horizontal scrolling stays on the page at writing scale');
  await assertTop();
  assert.ok(Math.abs((await stroke.boundingBox()).y - beforePan.y) < 2, 'scrolling back up returns to the top of the page');

  await page.keyboard.press('ControlOrMeta+=');
  await page.waitForTimeout(400);
  assert.ok((await paper.boundingBox()).width > box.width, 'zoom remains available for inspection');
  await fit.click();
  await assertFit();
  // Shelf swaps keep the editor mounted but hidden. A zero-size viewport must not make
  // fit-x constraints produce zero/NaN camera coordinates before the board reappears.
  await page.locator('.tl-container').evaluate((element) => { element.style.display = 'none'; });
  await page.waitForTimeout(200);
  await page.locator('.tl-container').evaluate((element) => { element.style.removeProperty('display'); });
  await assertFit();
  assert.deepEqual(errors, [], 'hiding the mounted notebook does not crash the editor');
  await page.setViewportSize({ width: 700, height: 1000 });
  await assertFit();
  assert.equal(await paper.getAttribute('data-page-width'), '960', 'resizing does not rescale the document');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.keyboard.press('ControlOrMeta+=');
  await page.waitForTimeout(400);
  const zoomedWidth = (await paper.boundingBox()).width;
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(250);
  assert.ok(Math.abs((await paper.boundingBox()).width - zoomedWidth) < 2, 'resizing preserves an intentional close-up');
  await fit.click();
  await assertFit();
  await page.setViewportSize({ width: 700, height: 1000 });
  await assertFit();
  await controls.getByRole('button', { name: 'Full screen', exact: true }).click();
  await assertFit();
  await controls.getByRole('button', { name: 'Exit full screen', exact: true }).click();
  await assertFit();
  await controls.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Hide drawing tools', exact: true }).click();
  await fit.click();
  await assertFit();
  await page.getByRole('button', { name: 'Show tools', exact: true }).click();
  await toggle();
  await paper.waitFor({ state: 'detached' });
  const pattern = page.locator('.tl-background pattern');
  const infiniteX = Number(await pattern.getAttribute('x'));
  const infiniteBox = await canvas.boundingBox();
  await page.mouse.move(infiniteBox.x + infiniteBox.width / 2, infiniteBox.y + 200);
  await page.mouse.wheel(150, 0);
  await page.waitForTimeout(250);
  assert.ok(Math.abs(Number(await pattern.getAttribute('x')) - infiniteX) > 1, 'turning notebook off restores horizontal navigation');
  assert.deepEqual(await savedShapes(), originalShapes, 'camera controls and notebook mode leave ink unchanged');
  await toggle();
  await page.reload();
  await paper.waitFor();
  await assertFit();
  assert.deepEqual(await savedShapes(), originalShapes, 'mode and saved ink survive reload');

  async function ask() {
    await openTutor(page);
    await page.getByRole('group', { name: 'Tutor choices' }).getByRole('button', { name: 'Check my work', exact: true }).and(page.locator(':enabled')).waitFor();
    const response = page.waitForResponse('**/api/tutor');
    await page.getByRole('group', { name: 'Tutor choices' }).getByRole('button', { name: 'Check my work', exact: true }).click();
    await (await response).finished();
    await page.getByText('Notebook checked.', { exact: true }).last().waitFor();
    assert.ok(requests.at(-1).canvasImage, 'Check my work still attaches the notebook');
    return requests.at(-1).canvasImage;
  }
  const firstImage = await ask();
  // A view change must not change the exported handwriting.
  await page.getByRole('button', { name: 'Close tutor', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+=');
  const secondImage = await ask();
  assert.equal(secondImage, firstImage, 'the tutor receives the same ink at a different camera zoom');
  await page.getByRole('button', { name: 'Close tutor', exact: true }).click();
  await fit.click();
  if (process.env.BOARD_SCREENSHOT_DIR) {
    await mkdir(process.env.BOARD_SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({ path: join(process.env.BOARD_SCREENSHOT_DIR, 'notebook-700.png') });
  }
  await savedShapes();
  await page.reload();
  await paper.waitFor();
  await assertFit();
  await stroke.waitFor();
  await page.getByTestId('tools.select').click();
  const ink = await stroke.boundingBox();
  await page.mouse.click(ink.x + ink.width - 4, ink.y + ink.height - 2.5);
  await page.getByTestId('quick-actions.delete').and(page.locator(':enabled')).waitFor();
  for (let step = 0; step < 85; step += 1) await page.keyboard.press('Shift+ArrowRight');
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="notebook-paper"]')?.getAttribute('data-page-width')) > 960);
  await assertFit();
  const movedInk = await stroke.boundingBox();
  const expandedPage = await paper.boundingBox();
  assert.ok(movedInk.x + movedInk.width < expandedPage.x + expandedPage.width, 'nudging ink beyond the page expands the notebook so it stays reachable');

  // Existing wide/negative-coordinate work remains intact and gets enough horizontal room.
  await savedShapes();
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.evaluate(async () => {
    const db = await new Promise((resolve) => {
      const request = indexedDB.open('math-tutor');
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put({
        id: 'wide-notebook', title: 'Wide notebook', problemStatement: 'Existing wide work', problemImage: null,
        canvasStrokes: [{ points: [{ x: -500, y: -100 }, { x: 2200, y: 100 }], color: '#000000', thickness: 2, tool: 'pen' }],
        canvasImageBlob: null, chatHistory: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = reject;
    });
    db.close();
    localStorage.setItem('math-tutor:currentSession', 'wide-notebook');
  });
  await page.goto(`${origin}/board`);
  await paper.waitFor();
  await page.waitForFunction(() => Number(document.querySelector('[data-testid="notebook-paper"]')?.getAttribute('data-page-width')) > 2700);
  assert.ok(Number(await paper.getAttribute('data-page-width')) > 2700);
  await assertFit();
  const wide = await page.locator('.tl-shape').boundingBox();
  const widePaper = await paper.boundingBox();
  assert.ok(wide.x > widePaper.x && wide.x + wide.width < widePaper.x + widePaper.width, 'old work fits inside its widened page');
  await assertTop();
  assert.ok((await page.locator('.tl-shape').boundingBox()).y > (await paper.boundingBox()).y, 'work above the old top raises the page top so it stays reachable');
  const wideShapes = await savedShapes();
  await toggle(); await toggle();
  assert.deepEqual(await savedShapes(), wideShapes, 'entering notebook does not rewrite legacy ink');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: /New Notes/ }).click();
  await page.getByPlaceholder('Topic or concept you\'re studying...').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-testid="notebook-paper"]')?.getAttribute('data-page-width') === '960');
  await assertFit();
  assert.equal(await page.locator('.tl-shape').count(), 0, 'switching boards clears previous ink');
  await page.getByPlaceholder('Topic or concept you\'re studying...').fill('A fresh notebook');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: /New Problem/ }).click();
  await page.getByPlaceholder("Type the math problem you're working on...").waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-loading]'));
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 800;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 3000, 800);
    ctx.fillStyle = 'black'; ctx.font = '100px serif'; ctx.fillText('Solve x + 2 = 5', 100, 200);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Problem picture', { exact: true }).setInputFiles({ name: 'problem.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  // Place while zoomed in: the picture must still use the document's writing width.
  await page.keyboard.press('ControlOrMeta+=');
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  await page.locator('.tl-image').waitFor();
  await assertFit();
  const pictureBox = await page.locator('.tl-image').boundingBox();
  const pageBox = await paper.boundingBox();
  assert.ok(pictureBox.x >= pageBox.x && pictureBox.x + pictureBox.width <= pageBox.x + pageBox.width, 'a new problem picture fits the paper at any zoom');
  assert.ok(pictureBox.y >= pageBox.y, 'the picture sits on the page, below its top');
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  assert.equal(await page.locator('.tl-image').count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS notebook opt-in, page top, vertical scroll, horizontal containment, zoom/Fit width, resize/full screen, hidden tools, reload, unchanged ink/captures, wide legacy boards and New');
} finally {
  await browser.close();
}
