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

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  server.close();
}
