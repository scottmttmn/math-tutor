import { openTutor, chooseTutor } from './tutor-ui.mjs';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const reply = String.raw`**Modulus:** \(a_1 + b_2\), $x^2$, \[\frac{1}{2}\], $$\sqrt{z}$$`;
const frames = [
  { type: 'model', model: 'gemini-3.7-flash' },
  { type: 'text_delta', content: reply.slice(0, 20) },
  { type: 'text_delta', content: reply.slice(20) },
  { type: 'message_stop' },
].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/tutor', (route) => route.fulfill({ contentType: 'text/event-stream', body: frames }));
  await page.goto(`${origin}/board?new=note`);
  await page.locator('.tl-canvas').waitFor();
  await chooseTutor(page);
  const chat = () => page.locator('.tutor-content').last();
  await chat().locator('.katex').nth(3).waitFor();
  assert.equal(await chat().locator('.katex').count(), 4);
  assert.equal(await chat().locator('.katex-display').count(), 2);
  await page.getByText('Answered with gemini-3.7-flash after a quota limit').waitFor();

  const box = page.getByPlaceholder('Ask your own question…');
  const oneLine = (await box.boundingBox()).height;
  await box.fill('Why is the modulus of a product the product of the moduli, and does the same hold for sums of complex numbers?');
  const wrapped = (await box.boundingBox()).height;
  assert.ok(wrapped > oneLine, 'a long question wraps onto more lines');
  // Narrowing the panel rewraps the draft; the box grows without the text changing.
  await page.evaluate(() => { document.querySelector('aside').style.width = '260px'; });
  await page.waitForFunction((before) => document.querySelector('aside textarea').getBoundingClientRect().height > before, wrapped);
  await page.evaluate(() => { document.querySelector('aside').style.width = ''; });
  await box.fill('Explain');
  await box.press('Shift+Enter');
  await box.pressSequentially('modulus.');
  assert.equal(await box.inputValue(), 'Explain\nmodulus.');
  // Follow-ups wait out the five-second limit after the first question.
  await page.getByRole('button', { name: 'Send', exact: true }).and(page.locator(':enabled')).waitFor({ timeout: 10_000 });
  const sent = page.waitForRequest('**/api/tutor');
  await box.press('Enter');
  assert.equal(JSON.parse((await sent).postData()).userQuestion, 'Explain\nmodulus.');
  assert.equal(await box.inputValue(), '');
  await page.locator('.tutor-content').nth(1).locator('.katex').nth(3).waitFor();

  await page.reload();
  await openTutor(page);
  await page.getByText('Answered with gemini-3.7-flash after a quota limit').first().waitFor();
  assert.equal(await chat().locator('.katex').count(), 4);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(tmpdir(), 'tutor-math-mobile.png') });
  console.log('PASS chat math, wrapping follow-ups, fallback metadata, reload, and mobile layout');

  // A board written while zoomed out spans a large page area; its snapshot must stay small.
  const wide = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  wide.on('pageerror', (error) => errors.push(error.message));
  const wideRequests = [];
  await wide.route('**/api/tutor', (route) => {
    wideRequests.push(route.request().postDataJSON());
    route.fulfill({ contentType: 'text/event-stream', body: frames });
  });
  await wide.goto(`${origin}/board`);
  const canvas = wide.locator('.tl-canvas');
  await canvas.waitFor();
  const canvasBox = await canvas.boundingBox();
  await wide.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let i = 0; i < 8; i += 1) {
    await wide.keyboard.down('Control');
    await wide.mouse.wheel(0, 100);
    await wide.keyboard.up('Control');
    await wide.waitForTimeout(150);
  }
  await wide.keyboard.press('d');
  for (const [x, y] of [[canvasBox.x + 60, canvasBox.y + 60], [canvasBox.x + canvasBox.width - 120, canvasBox.y + canvasBox.height - 120]]) {
    await wide.mouse.move(x, y);
    await wide.mouse.down();
    for (let i = 0; i < 10; i += 1) await wide.mouse.move(x + i * 5, y + Math.sin(i) * 10);
    await wide.mouse.up();
  }
  await chooseTutor(wide);
  await wide.locator('.tutor-content').last().locator('.katex').first().waitFor();
  const png = Buffer.from(wideRequests.at(-1).canvasImage, 'base64');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.ok(Math.max(width, height) <= 2048 && width > 1000, `snapshot ${width}x${height}`);
  console.log(`PASS zoomed-out board snapshot is ${width}x${height}`);

  // Widely separated lines used to become a ~29px-wide strip, even with no problem picture.
  // Load legacy strokes to give the regression a deterministic 6000-unit board on every viewport.
  const tall = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  tall.on('pageerror', (error) => errors.push(error.message));
  const tallRequests = [];
  await tall.route('**/api/tutor', (route) => {
    tallRequests.push(route.request().postDataJSON());
    return route.fulfill({ contentType: 'text/event-stream', body: frames });
  });
  await tall.goto(`${origin}/board`);
  await tall.locator('.tl-canvas').waitFor();
  await tall.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('math-tutor');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const canvasStrokes = [0, 6000].flatMap((y) => [0, 30, 60].map((dy) => ({
      points: [{ x: 100, y: y + dy + 100 }, { x: 112, y: y + dy + 120 }, { x: 135, y: y + dy + 100 }, { x: 155, y: y + dy + 120 }],
      color: '#000000', thickness: 2, tool: 'pen',
    })));
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put({
        id: 'tall-work', title: 'Tall work', problemStatement: 'Check these lines', problemImage: null,
        canvasStrokes, canvasImageBlob: null, chatHistory: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      transaction.objectStore('sessions').put({
        id: 'diagonal-work', title: 'Long diagonal', problemStatement: 'Check the long diagonal', problemImage: null,
        canvasStrokes: [{ points: [{ x: 0, y: 0 }, { x: 3000, y: 3000 }], color: '#000000', thickness: 2, tool: 'pen' }],
        canvasImageBlob: null, chatHistory: [], createdAt: Date.now(), updatedAt: Date.now(),
      });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
    localStorage.setItem('math-tutor:currentSession', 'tall-work');
  });
  await tall.reload();
  await tall.locator('.tl-canvas').waitFor();
  await tall.getByPlaceholder("Type the math problem you're working on...").fill('Check these lines');
  await tall.waitForFunction(() => document.querySelectorAll('.tl-shape[data-shape-type="draw"]').length === 6);
  await chooseTutor(tall);
  await tall.locator('.tutor-content .katex').first().waitFor();
  const first = tallRequests.at(-1);
  assert.ok(first.canvasImage);
  assert.equal(first.canvasDetails.length, 2, 'tile the ink, skipping the empty gap');
  const inkWidth = async (data) => tall.evaluate(async (data) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let left = canvas.width, right = -1;
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4] < 120) { left = Math.min(left, x); right = Math.max(right, x); }
    }
    return { ink: right - left + 1, width: canvas.width, height: canvas.height };
  }, data);
  const overview = await inkWidth(first.canvasImage);
  assert.ok(overview.ink < 30, `reproduces tiny overview ink: ${overview.ink}px`);
  for (const detail of first.canvasDetails) {
    const size = await inkWidth(detail);
    assert.ok(size.ink > 100 && Math.max(size.width, size.height) <= 2048, JSON.stringify(size));
  }
  await writeFile(join(tmpdir(), 'tutor-board-close-up.png'), Buffer.from(first.canvasDetails[0], 'base64'));
  const follow = tall.getByPlaceholder('Ask your own question…');
  await follow.fill('What about the same work?');
  await tall.getByRole('button', { name: 'Send', exact: true }).and(tall.locator(':enabled')).waitFor({ timeout: 10_000 });
  await follow.press('Enter');
  await tall.locator('.tutor-content').filter({ has: tall.locator('.katex') }).nth(1).waitFor();
  assert.equal(tallRequests.at(-1).canvasImage, first.canvasImage);
  assert.deepEqual(tallRequests.at(-1).canvasDetails, first.canvasDetails, 'unchanged follow-up resends all readable work');
  console.log('PASS tall board has readable close-ups, empty space is skipped, and unchanged follow-ups resend the images');

  // A failed export must be visible, preserve a typed question, and never reach the provider.
  await tall.evaluate(() => {
    window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
    window.captureFailures = 0;
    HTMLCanvasElement.prototype.toBlob = () => { window.captureFailures += 1; throw new Error('Simulated capture failure'); };
  });
  const beforeFailure = tallRequests.length;
  await tall.getByRole('button', { name: 'Ask tutor', exact: true }).and(tall.locator(':enabled')).waitFor({ timeout: 10_000 });
  await chooseTutor(tall);
  await tall.getByRole('alert').filter({ hasText: 'could not be captured' }).waitFor({ timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}; requests=${tallRequests.length}; failures=${await tall.evaluate(() => window.captureFailures)}; alerts=${await tall.getByRole('alert').allTextContents()}; browserErrors=${errors}`);
  });
  assert.equal(tallRequests.length, beforeFailure);
  await follow.fill('Keep this question if capture fails.');
  await follow.press('Enter');
  await tall.locator('form').getByRole('alert').filter({ hasText: 'could not be captured' }).waitFor();
  assert.equal(await follow.inputValue(), 'Keep this question if capture fails.');
  assert.equal(tallRequests.length, beforeFailure);
  await tall.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.originalToBlob; });
  await tall.getByRole('button', { name: 'Send', exact: true }).and(tall.locator(':enabled')).waitFor();
  await follow.press('Enter');
  await tall.locator('.tutor-content').filter({ has: tall.locator('.katex') }).nth(2).waitFor();
  assert.ok(tallRequests.at(-1).canvasImage);
  console.log('PASS capture failures are visible, keep the question, send no incomplete request, and allow retry');

  // A sparse diagonal spans 16 grid cells by bounds, but only its actual ink needs close-ups.
  await tall.getByRole('link', { name: 'Home', exact: true }).click();
  await tall.getByRole('button', { name: 'Open Long diagonal', exact: true }).click();
  await tall.locator('.tl-canvas').waitFor();
  await tall.waitForFunction(() => document.querySelector('textarea')?.value === 'Check the long diagonal' && document.querySelectorAll('.tl-shape[data-shape-type="draw"]').length === 1);
  await tall.getByRole('button', { name: 'Ask tutor', exact: true }).and(tall.locator(':enabled')).waitFor({ timeout: 10_000 });
  await chooseTutor(tall);
  await tall.locator('.tutor-content .katex').first().waitFor();
  assert.ok(tallRequests.at(-1).canvasDetails.length > 0 && tallRequests.at(-1).canvasDetails.length <= 12);
  console.log('PASS a long diagonal uses shape geometry to skip empty cells and reaches the tutor');

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
}
