// The Android app's bundle (out/, from `npm run build:android`) served the way the app serves it:
// Capacitor answers every path without an extension with index.html (Home), other paths with the file.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..', 'out');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const last = path.split('/').pop();
  const file = path === '/' || !last.includes('.') ? '/index.html' : normalize(path);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  await page.getByRole('link', { name: 'Shelf' }).first().click();
  await page.getByRole('heading', { name: 'Shelf', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/shelf');
  console.log('PASS Home opens and links work inside the bundle');

  // A full load of a page other than Home (a reload) shows that page, under its own address.
  await page.reload();
  await page.getByRole('heading', { name: 'Shelf', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/shelf');
  await page.goto(`${origin}/board?new=note`);
  await page.locator('.tl-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/board');
  // There is no server in the bundle yet, so the tutor says so rather than failing oddly.
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByText("The tutor isn't connected in the tablet app yet.").waitFor();
  await page.goto(`${origin}/pen-test`);
  await page.getByTestId('pen-test-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/pen-test');
  console.log('PASS reloading or opening a page directly shows that page; the tutor says it is not connected');

  // In the app, files go through Android's Save dialog (SaveFilePlugin), not a blob: download.
  // Stand in for the native side: Capacitor sees an Android bridge and the plugin's header.
  const app = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
  app.on('pageerror', (error) => errors.push(error.message));
  await app.addInitScript(() => {
    window.saves = [];
    window.saveAnswers = [];
    window.androidBridge = { postMessage() {} };
    window.Capacitor = {
      PluginHeaders: [{ name: 'SaveFile', methods: [{ name: 'save', rtype: 'promise' }] }],
      nativePromise: async (plugin, method, options) => {
        window.saves.push({ plugin, method, ...options });
        return { saved: window.saveAnswers.shift() ?? true };
      },
    };
  });
  await app.goto(`${origin}/board`);
  await app.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 7');
  await app.locator('.tl-canvas').waitFor();
  const board = await app.locator('.tl-canvas').boundingBox();
  await app.mouse.move(board.x + 120, board.y + 120);
  await app.mouse.down();
  await app.mouse.move(board.x + 300, board.y + 200, { steps: 8 });
  await app.mouse.up();
  await app.getByText('Saved', { exact: true }).waitFor();
  await app.getByRole('button', { name: 'Save board as' }).click();
  await app.getByRole('menuitem', { name: 'PNG picture' }).click();
  await app.waitForFunction(() => window.saves.length === 1);
  const png = await app.evaluate(() => window.saves[0]);
  assert.equal(png.plugin, 'SaveFile');
  assert.equal(png.name, 'Find x when 2x + 3 = 7.png');
  assert.equal(png.mimeType, 'image/png');
  assert.deepEqual([...Buffer.from(png.data, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  // A cancelled Save dialog is not a backup: the reminder stays until one is saved.
  await app.evaluate(() => window.saveAnswers.push(false));
  await app.getByRole('button', { name: 'Back up', exact: true }).click();
  await app.getByRole('button', { name: 'Download backup' }).click();
  await app.waitForFunction(() => window.saves.length === 2);
  assert.match((await app.evaluate(() => window.saves[1])).name, /^math-tutor-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  await app.waitForTimeout(300);
  assert.equal(await app.getByText(/Last downloaded/).count(), 0);
  await app.getByRole('button', { name: 'Download backup' }).click();
  await app.getByText(/Last downloaded just now/).waitFor();
  await app.getByRole('button', { name: 'Done' }).click();
  assert.equal(await app.getByRole('button', { name: 'Back up', exact: true }).count(), 0);
  console.log('PASS in the app, Save as and the backup go through the Save dialog; a cancelled one keeps the reminder');

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  server.close();
}
