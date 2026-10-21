import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import load from './load-typescript.mjs';
import { chooseTutor, openTutor } from './tutor-ui.mjs';

// The ink board (replacing tldraw), opt-in through Board → Ink board for new boards: writing,
// erasing, undo, saving and reloading, paper, the tutor's picture, Save as, Put on board and Clear;
// and the converter on a board that tldraw itself drew.

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const tlschema = createRequire(import.meta.url)('@tldraw/tlschema');
const { boardFromTldraw } = load('src/lib/inkBoard/fromTldraw.ts', { tldraw: tlschema });
const requests = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Ink hint.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const profile = await mkdtemp(join(tmpdir(), 'ink-board-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 1440, height: 960 }, acceptDownloads: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = context.pages()[0] || await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const problemBox = () => page.getByPlaceholder("Type the math problem you're working on...");
const ink = () => page.locator('[data-ink-board]');
const count = async (what) => Number(await ink().getAttribute(`data-${what}`));
const waitCount = (what, value) => page.waitForFunction(([name, expected]) => document.querySelector('[data-ink-board]')?.getAttribute(`data-${name}`) === String(expected), [what, value]);
const boardMenu = async (item) => {
  await page.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: item }).or(page.getByRole('menuitem', { name: item })).click();
};
async function stroke(x0, y0, x1, y1) {
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
  await page.mouse.up();
}
/** The open board as saved in IndexedDB, once the autosave has written `check` true of it. */
async function saved(check) {
  for (let tries = 0; tries < 50; tries++) {
    const session = await page.evaluate(async (test) => {
      const id = localStorage.getItem('math-tutor:currentSession');
      if (!id) return null;
      const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
      const found = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
      db.close();
      // A Blob doesn't come back to the test; say whether there is one.
      return found && new Function('session', `return ${test}`)(found) ? { ...found, canvasImageBlob: Boolean(found.canvasImageBlob) } : null;
    }, check);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No saved board where ${check}`);
}

try {
  await page.goto(`${origin}/board`);
  await problemBox().waitFor();
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);

  // A tldraw board first, so the converter can be checked on ink tldraw itself drew.
  await page.reload();
  await problemBox().waitFor();
  const tlCanvas = page.locator('.tl-canvas').first();
  await tlCanvas.waitFor();
  const tlBox = await tlCanvas.boundingBox();
  await page.mouse.move(tlBox.x + 200, tlBox.y + 200, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(tlBox.x + 340, tlBox.y + 280, { steps: 12 });
  await page.mouse.up();
  const tlSession = await saved("Object.values(session.canvasDocument?.store ?? {}).some((record) => record.typeName === 'shape' && record.props.isComplete)");
  const converted = boardFromTldraw(tlSession.canvasDocument);
  assert.deepEqual(converted.leftovers, []);
  assert.equal(converted.board.strokes.length, 1);
  const [line] = converted.board.strokes;
  const xs = line.points.filter((_, i) => i % 3 === 0);
  const ys = line.points.filter((_, i) => i % 3 === 1);
  // tldraw opens at zoom 1, so the stroke spans what the mouse moved: 140 by 80.
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 140) < 6 && Math.abs(Math.max(...ys) - Math.min(...ys) - 80) < 6, `converted span ${Math.max(...xs) - Math.min(...xs)} × ${Math.max(...ys) - Math.min(...ys)}`);
  assert.equal(line.width, 3);
  assert.equal(line.color, 'black');
  console.log('PASS a stroke tldraw drew converts to one ink stroke of the same span and width');

  // The choice is off by default; turning it on makes the open, still empty… board an ink board for new boards.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'New Problem' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-loading]') && document.querySelector('.tl-canvas'));
  await boardMenu('Ink board for new boards (experiment)');
  await ink().waitFor();
  assert.equal(await page.locator('.tl-canvas').count(), 0);

  // Writing, the highlighter, erasing and undo.
  await problemBox().fill('Ink board check.');
  await stroke(100, 200, 400, 230);
  await stroke(100, 300, 400, 330);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await stroke(100, 420, 400, 420);
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await stroke(250, 280, 250, 350);
  await waitCount('strokes', 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitCount('strokes', 2);
  await page.keyboard.press('ControlOrMeta+z');
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  console.log('PASS pen, highlighter, eraser (between samples), undo, redo and Ctrl+Z');

  // Saved as ink (no tldraw document), and back after a reload.
  const session = await saved('session.ink?.strokes?.length === 3');
  assert.equal(session.canvasDocument, null);
  assert.deepEqual(session.ink.strokes.map((s) => s.tool), ['pen', 'pen', 'highlighter']);
  assert.ok(session.canvasImageBlob, 'Home gets a thumbnail');
  await page.reload();
  await ink().waitFor();
  await waitCount('strokes', 3);
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'undo starts fresh on a reopened board');
  console.log('PASS the board saves as ink with a thumbnail and reopens as an ink board');

  // Paper, zoom and Fit width.
  await page.getByRole('button', { name: 'Paper: Blank' }).click();
  await page.getByRole('menuitemradio', { name: 'Lined' }).click();
  await saved("session.paper === 'lined'");
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => Number(document.querySelector('[data-ink-board]').getAttribute('data-zoom')) > 1.2);
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ink-board]').getAttribute('data-zoom') === '1');
  console.log('PASS lined paper is kept; Ctrl+wheel zooms and Fit width returns to writing scale');

  // The tutor gets a picture of the writing.
  await openTutor(page);
  const before = requests.length;
  await chooseTutor(page);
  while (requests.length === before) await new Promise((resolve) => setTimeout(resolve, 50));
  await page.getByText('Ink hint.', { exact: true }).last().waitFor();
  const content = requests.at(-1).messages.at(-1).content;
  const image = content.find((part) => part.type === 'image_url')?.image_url.url;
  assert.match(image, /^data:image\/png;base64,/);
  const png = Buffer.from(image.split(',')[1], 'base64');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  // The writing spans about 300 by 220 screen px, about 270 by 200 board units at this width, sent at 2x with padding.
  assert.ok(width > 560 && width < 720 && height > 420 && height < 560, `tutor picture ${width} × ${height}`);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  console.log('PASS the tutor gets the writing, trimmed and at 2x');

  // Save as PNG.
  const [download] = await Promise.all([page.waitForEvent('download'), boardMenu('Save as PNG')]);
  const file = await readFile(await download.path());
  assert.equal(file.subarray(1, 4).toString(), 'PNG');
  console.log('PASS Save as PNG');

  // Put on board places the problem picture once, above the work; Clear leaves it.
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, 600, 160);
    context.fillStyle = 'black'; context.font = '48px serif'; context.fillText('Solve x + 2 = 5', 20, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Problem picture', { exact: true }).setInputFiles({ name: 'problem.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  await waitCount('images', 1);
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await count('images'), 1);
  const placed = await saved('session.ink?.images?.length === 1');
  const [problem] = placed.ink.images;
  assert.equal(problem.problem, true);
  assert.ok(problem.y + problem.h < Math.min(...placed.ink.strokes.flatMap((s) => s.points.filter((_, i) => i % 3 === 1))), 'the picture sits above the work');
  assert.ok(placed.ink.page.top <= problem.y, 'the page grows up to the picture');
  await page.getByRole('button', { name: 'Clear board' }).click();
  await waitCount('strokes', 0);
  assert.equal(await count('images'), 1);
  console.log('PASS Put on board places the picture once, above the work; Clear leaves it');

  // Turned off, a new board is tldraw again; the ink board stays an ink board.
  await boardMenu('Ink board for new boards (experiment)');
  await ink().waitFor();
  await stroke(100, 300, 300, 300);
  await saved('session.ink?.strokes?.length === 1');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'New Problem' }).click();
  await page.locator('.tl-canvas').first().waitFor();
  assert.equal(await ink().count(), 0);
  console.log('PASS with the choice off, new boards are tldraw boards');

  assert.deepEqual(errors, []);
} finally {
  await context.close();
  provider.close();
}
