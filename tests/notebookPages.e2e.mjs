import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { chooseTutor } from './tutor-ui.mjs';

// A notes board's pages: one at a time, the rail's page controls and Page Up/Down, a new page after the
// last, saved and reopened on the last page; the tutor reads the page in view. Problem boards stay one page.

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const PAGE_HEIGHT = 1280;
const requests = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Page reply.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const profile = await mkdtemp(join(tmpdir(), 'notebook-pages-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 820, height: 1180 },
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = context.pages()[0] || await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const ink = () => page.locator('[data-ink-board]');
const attr = (name) => ink().getAttribute(`data-${name}`);
const waitAttr = (name, value) => page.waitForFunction(([key, expected]) => document.querySelector('[data-ink-board]')?.getAttribute(`data-${key}`) === String(expected), [name, value]);
async function stroke(x0, y0, x1, y1) {
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
  await page.mouse.up();
}
async function saved(check) {
  for (let tries = 0; tries < 50; tries++) {
    const session = await page.evaluate(async (test) => {
      const id = localStorage.getItem('math-tutor:currentSession');
      if (!id) return null;
      const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
      const found = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
      db.close();
      return found && new Function('session', `return ${test}`)(found) ? { ...found, canvasImageBlob: null } : null;
    }, check);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No saved board where ${check}`);
}
const pngHeight = (base64) => Buffer.from(base64, 'base64').readUInt32BE(20);

try {
  await page.goto(`${origin}/board?new=note`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await waitAttr('pages', 1);
  assert.equal(await page.getByTestId('page-number').textContent(), '1/1');
  assert.equal(await page.getByRole('button', { name: 'Previous page' }).isDisabled(), true);

  // Write on page 1, add a page, write on page 2.
  await stroke(100, 150, 400, 160);
  await waitAttr('strokes', 1);
  await page.getByRole('button', { name: 'New page' }).click();
  await waitAttr('pages', 2);
  await waitAttr('page', 2);
  assert.equal(await page.getByTestId('page-number').textContent(), '2/2');
  await stroke(100, 150, 400, 300);
  await waitAttr('strokes', 2);
  const two = await saved('session.ink?.page?.pages === 2 && session.ink.strokes.length === 2');
  const tops = two.ink.strokes.map((s) => Math.min(...s.points.filter((_, i) => i % 3 === 1)));
  assert.ok(tops[0] < PAGE_HEIGHT && tops[1] > PAGE_HEIGHT && tops[1] < 2 * PAGE_HEIGHT, `one stroke on each page (${tops})`);
  console.log('PASS a notes board writes on page 1, adds page 2 and writes there');

  // The view stays on its page: scrolling down past it doesn't reach the next.
  const viewY = Number(await attr('view-y'));
  await page.mouse.move(400, 600);
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(300);
  assert.ok(Number(await attr('view-y')) < 2 * PAGE_HEIGHT, `scrolling stays on page 2 (${viewY} → ${await attr('view-y')})`);

  // The tutor reads the page in view, not the whole notebook.
  const asked = requests.length;
  await chooseTutor(page, 'Explain this');
  while (requests.length === asked) await new Promise((resolve) => setTimeout(resolve, 50));
  const image = requests.at(-1).messages.at(-1).content.find((part) => part.type === 'image_url').image_url.url.split(',')[1];
  assert.ok(pngHeight(image) < 600, `the tutor reads page 2 alone (${pngHeight(image)} px tall)`);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  console.log('PASS the view and the tutor stay on the page');

  // Back and forth with the rail and the keyboard.
  await page.getByRole('button', { name: 'Previous page' }).click();
  await waitAttr('page', 1);
  assert.ok(Number(await attr('view-y')) < PAGE_HEIGHT);
  await page.keyboard.press('PageDown');
  await waitAttr('page', 2);
  await page.keyboard.press('PageUp');
  await waitAttr('page', 1);
  await page.getByRole('button', { name: 'Next page' }).click();
  await waitAttr('page', 2);
  // Undo takes back the stroke, then the new page.
  await page.keyboard.press('ControlOrMeta+z');
  await waitAttr('strokes', 1);
  await page.keyboard.press('ControlOrMeta+z');
  await waitAttr('pages', 1);
  await waitAttr('page', 1);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await waitAttr('strokes', 2);
  console.log('PASS pages turn with the rail and Page Up/Down; undo takes back a new page');

  // Reopened, the notebook is on its last page.
  await saved('session.ink?.page?.pages === 2 && session.ink.strokes.length === 2');
  await page.reload();
  await waitAttr('pages', 2);
  await waitAttr('page', 2);
  console.log('PASS a notebook reopens on its last page');

  // A problem board is still one long page.
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  assert.equal(await attr('pages'), null);
  assert.equal(await page.getByTestId('page-number').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS problem boards keep one long page; no browser exceptions');
} finally {
  await context.close();
  provider.close();
}
