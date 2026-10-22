import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { fakeBooxBridge } from './boox-bridge.mjs';
import { makePdf } from './makePdf.mjs';

// Ink on a Shelf page on a BOOX tablet, with the native bridge stood in for (tests/boox-bridge.mjs):
// with Pen or Highlight chosen Onyx's pen draws over the page (the part in view) and each stroke
// becomes the page's ink; the eraser end rubs out; the Eraser tool uses fast screen updates; with
// no tool, the pen and screen are left alone. How it looks on e-ink can only be judged on the device.
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const folder = await mkdtemp(join(tmpdir(), 'boox-page-'));
const pdfPath = join(folder, 'Notes.pdf');
await writeFile(pdfPath, makePdf([['Page one', '', 'Some text to write beside.'], ['Page two']]));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(fakeBooxBridge);
  await page.goto(`${origin}/`);
  await page.locator('input[aria-label="Add a PDF"]').setInputFiles(pdfPath);
  await page.getByRole('link', { name: 'Start reading' }).click();
  const overlay = page.getByTestId('page-overlay');
  await overlay.waitFor();
  const calls = (method) => page.evaluate((name) => window.__boox.calls.filter((call) => call.method === name), method);
  const inkPixels = () => page.getByTestId('page-ink').evaluate((canvas) => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return count;
  });
  const inkShown = (test) => page.waitForFunction((check) => {
    const canvas = document.querySelector('[data-testid="page-ink"]');
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count += 1;
    return new Function('count', `return ${check}`)(count);
  }, test);

  // Reading, the pen is the page's: nothing is started.
  await page.waitForTimeout(500);
  assert.equal((await calls('start')).length, 0, 'no tool, no BOOX pen');

  // Pen: the SDK takes the page's part in view, at the page's pen width.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  const [{ options: start }] = await calls('start');
  const box = await overlay.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(Math.abs(start.region.x - box.x) < 2 && Math.abs(start.region.w - box.width) < 2, `the pen draws over the page (${JSON.stringify(start.region)})`);
  assert.ok(start.region.y + start.region.h <= viewport.height + 1, 'only the part in view');
  assert.ok(start.width > 1 && start.width < 4, `preview width ${start.width}`);
  assert.equal(start.color, '#111827');

  // A stroke from the SDK becomes ink on the page; pen events the WebView hears are not drawn again.
  const flat = [];
  for (let i = 0; i <= 20; i += 1) flat.push(box.x + 100 + i * 10, box.y + 150 + i * 2, 0.6, i * 8);
  await page.evaluate((points) => window.__boox.emit('stroke', points), flat);
  await inkShown('count > 50');
  const penInk = await inkPixels();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'refresh'));
  const blocked = await overlay.evaluate((element) => {
    const { left, top } = element.getBoundingClientRect();
    const options = { pointerType: 'pen', bubbles: true, cancelable: true, clientX: left + 100, clientY: top + 300, button: 0, buttons: 1 };
    const down = new PointerEvent('pointerdown', options);
    element.dispatchEvent(down);
    element.dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: left + 300 }));
    element.dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: left + 300, buttons: 0 }));
    return down.defaultPrevented;
  });
  assert.equal(blocked, true);
  await page.waitForTimeout(300);
  assert.equal(await inkPixels(), penInk, 'the page does not draw the pen itself');

  // Highlight: a marker tip in the highlight's look, and a wide stroke.
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await page.waitForFunction(() => window.__boox.calls.filter((call) => call.method === 'setWidth').at(-1)?.options.marker === true);
  const highlight = (await calls('setWidth')).at(-1).options;
  assert.ok(highlight.width > start.width * 5, `highlighter preview ${highlight.width}`);
  assert.equal(highlight.color, '#cfd1d4');
  await page.evaluate(([x, y]) => window.__boox.emit('stroke', [x, y, 0.5, 0, x + 300, y, 0.5, 80]), [box.x + 80, box.y + 400]);
  await inkShown(`count > ${penInk * 2}`);

  // The eraser end rubs out the highlight it crosses, even between far-apart samples; Undo brings it back.
  await page.evaluate(([x, y]) => window.__boox.emit('erase', [x, y - 60, 0.5, 0, x, y + 60, 0.5, 8]), [box.x + 230, box.y + 400]);
  await inkShown(`count === ${penInk}`);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await inkShown(`count > ${penInk * 2}`);

  // The Eraser tool is the page's, in fast mode; no tool lets the pen and screen go.
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'stop'));
  await page.waitForFunction(() => window.__boox.calls.filter((call) => call.method === 'interaction').at(-1)?.options.active === true);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.waitForFunction(() => window.__boox.calls.filter((call) => call.method === 'interaction').at(-1)?.options.active === false);
  console.log('PASS BOOX pen on a page: SDK strokes and highlights become page ink, the eraser end rubs out, the Eraser tool uses fast mode, reading leaves the pen alone');

  // An upright tablet: the exercise's board has the pen; swapped for the page, the page takes it,
  // and its strokes never reach the hidden board; back on the board, the board takes it again.
  await page.evaluate(() => localStorage.setItem('math-tutor:inkBoard', '1'));
  await page.setViewportSize({ width: 800, height: 1100 });
  await page.getByRole('button', { name: 'Mark', exact: true }).click();
  const area = await overlay.boundingBox();
  await page.mouse.move(area.x + area.width * 0.1, area.y + area.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(area.x + area.width * 0.7, area.y + area.height * 0.25, { steps: 5 });
  await page.mouse.up();
  await page.getByRole('radio', { name: 'Exercise' }).click();
  await page.getByRole('button', { name: 'Save and open' }).click();
  const board = page.locator('[data-ink-board]');
  await board.waitFor();
  await overlay.waitFor({ state: 'hidden' });
  const startsWith = async (count) => page.waitForFunction((n) => window.__boox.calls.filter((call) => call.method === 'start').length >= n, count);
  let starts = (await calls('start')).length;
  await startsWith(starts + 1).catch(() => undefined);
  starts = (await calls('start')).length;
  await page.getByRole('button', { name: /^Page \d+$/ }).click();
  await overlay.waitFor();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await startsWith(starts + 1);
  const shownPage = await overlay.boundingBox();
  const lastStart = (await calls('start')).at(-1).options.region;
  assert.ok(Math.abs(lastStart.x - shownPage.x) < 2 && Math.abs(lastStart.w - shownPage.width) < 2, 'the swapped-in page has the pen');
  const before = await inkPixels();
  await page.evaluate(([x, y]) => window.__boox.emit('stroke', [x, y, 0.5, 0, x + 200, y + 20, 0.5, 80]), [shownPage.x + 60, shownPage.y + 100]);
  await inkShown(`count > ${before}`);
  assert.equal(await board.getAttribute('data-strokes'), '0', 'the hidden board gets none of it');
  starts = (await calls('start')).length;
  await page.getByRole('button', { name: 'Back to board' }).click();
  await board.waitFor();
  await startsWith(starts + 1);
  const boardBox = await board.boundingBox();
  await page.evaluate(([x, y]) => window.__boox.emit('stroke', [x, y, 0.5, 0, x + 200, y + 20, 0.5, 80]), [boardBox.x + 100, boardBox.y + 300]);
  await page.waitForFunction(() => document.querySelector('[data-ink-board]')?.getAttribute('data-strokes') === '1');
  assert.deepEqual(errors, []);
  console.log('PASS on an upright tablet the swapped-in page takes the BOOX pen, and the board takes it back');
} finally {
  await browser.close();
}
