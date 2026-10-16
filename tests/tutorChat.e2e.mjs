import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  const chat = () => page.locator('.tutor-content').last();
  await chat().locator('.katex').nth(3).waitFor();
  assert.equal(await chat().locator('.katex').count(), 4);
  assert.equal(await chat().locator('.katex-display').count(), 2);
  await page.getByText('Answered with gemini-3.7-flash after a quota limit').waitFor();

  const box = page.getByPlaceholder('Type or speak a follow-up...');
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
  await page.getByRole('button', { name: 'Tutor', exact: true }).click();
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
  await wide.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await wide.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  await wide.locator('.tutor-content').last().locator('.katex').first().waitFor();
  const png = Buffer.from(wideRequests.at(-1).canvasImage, 'base64');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.ok(Math.max(width, height) <= 2048 && width > 1000, `snapshot ${width}x${height}`);
  console.log(`PASS zoomed-out board snapshot is ${width}x${height}`);

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
}
