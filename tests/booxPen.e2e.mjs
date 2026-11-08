import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fakeBooxBridge } from './boox-bridge.mjs';

// The pen test's BOOX pen SDK toggle, with the Android app's native bridge stood in for (the
// board's own BOOX pen is in tests/booxInk.e2e.mjs). What the SDK itself does on the e-ink screen
// can only be judged on the device.
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

try {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(fakeBooxBridge);
  await page.goto(`${origin}/pen-test`);
  await page.getByRole('button', { name: 'BOOX pen SDK' }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  const testCanvas = await page.getByTestId('pen-test-canvas').boundingBox();
  const testStroke = [];
  for (let i = 0; i <= 30; i += 1) testStroke.push(testCanvas.x + 100 + i * 6, testCanvas.y + 100, 0.5, i * 4);
  await page.evaluate((points) => window.__boox.emit('stroke', points), testStroke);
  await page.getByText(/Last stroke: \d+ samples\/s · drawn by the BOOX pen SDK · longest gap 4 ms/).waitFor();
  // A rotation resizes the canvas without reloading the app, so the SDK's region follows it.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'setRegion' && call.options.region.w < 800));

  // Anywhere else (a browser, or the app on another tablet) it isn't offered.
  const plain = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  plain.on('pageerror', (error) => errors.push(error.message));
  await plain.goto(`${origin}/pen-test`);
  await plain.getByRole('button', { name: 'Clear' }).waitFor();
  assert.equal(await plain.getByRole('button', { name: 'BOOX pen SDK' }).count(), 0);

  assert.deepEqual(errors, []);
  console.log('PASS the pen test hands the pen to the BOOX SDK on a BOOX, and offers it nowhere else');
} finally {
  await browser.close();
}
