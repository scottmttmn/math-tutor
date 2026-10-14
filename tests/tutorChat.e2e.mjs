import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3100';
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
  await page.goto(`${origin}/workbook`);
  await page.getByRole('heading', { name: 'Reading tutor' }).waitFor();
  await page.getByRole('textbox').fill('Explain modulus.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const chat = page.locator('.tutor-content').last();
  await chat.locator('.katex').nth(3).waitFor();
  assert.equal(await chat.locator('.katex').count(), 4);
  assert.equal(await chat.locator('.katex-display').count(), 2);
  await page.getByText('Answered with gemini-3.7-flash after a quota limit').waitFor();
  await page.reload();
  await page.getByText('Answered with gemini-3.7-flash after a quota limit').waitFor();
  assert.equal(await page.locator('.tutor-content').last().locator('.katex').count(), 4);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: join(tmpdir(), 'tutor-math-mobile.png') });
  console.log('PASS workbook math, fallback metadata, reload, and mobile layout');

  await page.goto(`${origin}/`);
  await page.evaluate(() => localStorage.removeItem('lastHelpTimestamp'));
  await page.reload();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: /New Notes/ }).click();
  await page.getByRole('button', { name: 'Ask About This', exact: true }).click();
  await page.locator('.tutor-content').last().locator('.katex').nth(3).waitFor();
  console.log('PASS free-form chat math');

  // A board written while zoomed out spans a large page area; its snapshot must stay small.
  const wide = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  wide.on('pageerror', (error) => errors.push(error.message));
  const sent = [];
  await wide.route('**/api/tutor', (route) => {
    sent.push(route.request().postDataJSON());
    route.fulfill({ contentType: 'text/event-stream', body: frames });
  });
  await wide.goto(`${origin}/`);
  const canvas = wide.locator('.tl-canvas');
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  await wide.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 8; i += 1) {
    await wide.keyboard.down('Control');
    await wide.mouse.wheel(0, 100);
    await wide.keyboard.up('Control');
    await wide.waitForTimeout(150);
  }
  await wide.keyboard.press('d');
  for (const [x, y] of [[box.x + 60, box.y + 60], [box.x + box.width - 120, box.y + box.height - 120]]) {
    await wide.mouse.move(x, y);
    await wide.mouse.down();
    for (let i = 0; i < 10; i += 1) await wide.mouse.move(x + i * 5, y + Math.sin(i) * 10);
    await wide.mouse.up();
  }
  await wide.getByRole('button', { name: 'Ask for Help', exact: true }).click();
  await wide.locator('.tutor-content').last().locator('.katex').first().waitFor();
  const png = Buffer.from(sent.at(-1).canvasImage, 'base64');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.ok(Math.max(width, height) <= 2048 && width > 1000, `snapshot ${width}x${height}`);
  console.log(`PASS zoomed-out board snapshot is ${width}x${height}`);

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
}
