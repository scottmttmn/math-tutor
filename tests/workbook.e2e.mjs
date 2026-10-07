import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
const profile = await mkdtemp(join(tmpdir(), 'workbook-acceptance-'));
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  requests.push(body);
  const system = body.messages[0].content;
  const reply = system.includes('accompanying a student') ? 'Reading explanation.'
    : system.includes('Give clear, direct explanations') ? 'Notes explanation.' : 'Exercise hint.';
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (JSON.stringify(body.messages.at(-1)).includes('Hold this reply')) {
    res.write(': pending\n\n');
    setTimeout(() => res.end('data: [DONE]\n\n'), 1500);
    return;
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const launchOptions = { headless: true, viewport: { width: 1440, height: 960 }, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined };
let context;
let page;
async function openBrowser() {
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await context.addInitScript(() => {
    window.SpeechRecognition = class {
      constructor() { window.__testRecognition = this; }
      start() {}
      stop() {
        this.onend?.();
        this.onresult?.({ results: [[{ transcript: 'Late transcript after sending' }]] });
      }
    };
  });
  page = context.pages()[0] || await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(`${origin}/workbook`);
}
const waitReading = () => page.getByRole('heading', { name: 'Reading tutor', exact: true }).waitFor();
const waitExercise = () => page.getByRole('heading', { name: 'Problem tutor', exact: true }).waitFor();
const exerciseButton = (number) => page.getByRole('button', { name: new RegExp(`^Exercise ${number}\\.`) });
async function ask(question, reply) {
  const before = requests.length;
  await page.getByRole('textbox').fill(question);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await page.getByText(reply, { exact: true }).last().waitFor();
  assert.equal(requests.length, before + 1);
  return requests.at(-1);
}
async function draw() {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Clear' && !button.disabled));
}
async function clearCooldown() {
  await page.evaluate(() => { localStorage.removeItem('lastHelpTimestamp'); window.dispatchEvent(new Event('mathTutor:helpUsage')); });
  await page.getByRole('button', { name: /^(Ask for Help|Ask About This)$/ }).waitFor();
}
try {
  await openBrowser(); await waitReading();
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  assert.equal(await page.getByRole('button', { name: /^Exercise / }).count(), 25);
  await page.waitForFunction(() => [...document.querySelectorAll('main img')].every((image) => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator('.katex-error, .solution, .solutions').count(), 0);
  assert.ok(await page.getByText('CC BY 4.0', { exact: true }).isVisible());
  await page.screenshot({ path: join(tmpdir(), 'workbook-reading-verified.png') });
  console.log('PASS reading, attribution, all 25 exercises, and eight diagrams');

  await page.locator('main .para').first().evaluate((element) => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Clear selected passage' }).waitFor();
  let request = await ask('What does this passage mean?', 'Reading explanation.');
  assert.match(JSON.stringify(request.messages), /Selected passage.*Complex numbers are ordered pairs/);
  assert.match(JSON.stringify(request.messages), /Exercise 25\./);
  await page.getByRole('button', { name: 'Clear selected passage' }).click();
  await page.locator('main > div').evaluate((reader) => { reader.scrollTop = 730; });
  await exerciseButton(1).scrollIntoViewIfNeeded();
  const readingPosition = await page.locator('main > div').evaluate((reader) => reader.scrollTop);
  console.log('PASS selected passage and server-resolved reading/exercise context');

  await exerciseButton(1).click(); await waitExercise();
  request = await ask('Where should I start?', 'Exercise hint.');
  assert.match(JSON.stringify(request.messages), /Current exercise 1\./);
  assert.match(JSON.stringify(request.messages), /Reading text/);
  assert.doesNotMatch(JSON.stringify(request.messages), /Reading explanation/);
  await draw();
  await page.getByRole('button', { name: 'Mark attempt complete', exact: true }).click();
  await page.reload(); await waitExercise();
  assert.ok(await page.getByRole('button', { name: 'Attempt complete', exact: true }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isEnabled());
  assert.ok(await page.getByText('Exercise hint.', { exact: true }).isVisible());
  console.log('PASS immediate reload preserves whiteboard, conversation, active exercise, and completion');

  // Selection review sends the selected pixels and does not leak to another exercise.
  await page.getByTitle('Select Region', { exact: true }).click();
  const box = await page.locator('canvas').last().boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 160, { steps: 5 }); await page.mouse.up();
  await page.getByText('Region selected', { exact: true }).waitFor();
  await clearCooldown();
  await page.getByRole('button', { name: 'Ask for Help', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  request = requests.at(-1);
  const parts = request.messages.at(-1).content;
  const image = parts.find((part) => part.type === 'image_url')?.image_url.url;
  assert.ok(image?.startsWith('data:image/png;base64,'));
  const dimensions = await page.evaluate(async (src) => {
    const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight];
  }, image);
  assert.deepEqual(dimensions, [200, 140]);
  await page.getByRole('button', { name: /^Wait / }).waitFor();
  assert.ok(await page.getByRole('button', { name: /^Wait / }).isDisabled());
  await ask('Does this approach make sense?', 'Exercise hint.');
  console.log('PASS selected whiteboard image reaches provider; review cooldown and text follow-up availability');

  await page.getByRole('button', { name: 'Back to reading' }).click(); await waitReading();
  assert.ok(await page.getByText('Reading explanation.', { exact: true }).isVisible());
  assert.equal(await page.locator('main > div').evaluate((reader) => reader.scrollTop), readingPosition);
  assert.match(await exerciseButton(1).innerText(), /Complete/);
  await exerciseButton(2).click(); await waitExercise();
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isDisabled());
  assert.equal(await page.getByText('Region selected', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Exercise hint.', { exact: true }).count(), 0);
  request = await ask('How should I plot these vectors?', 'Exercise hint.');
  assert.match(JSON.stringify(request.messages), /Current exercise 2\./);
  assert.doesNotMatch(JSON.stringify(request.messages), /Does this approach make sense/);
  await page.getByRole('button', { name: 'Back to reading' }).click(); await waitReading();
  await exerciseButton(1).click(); await waitExercise();
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isEnabled());
  assert.ok(await page.getByText('Does this approach make sense?', { exact: true }).isVisible());
  console.log('PASS switching keeps boards and conversations separate and restores the reading position');

  await page.getByRole('button', { name: 'Attempt complete', exact: true }).click();
  await context.close(); await openBrowser(); await waitExercise();
  assert.ok(await page.getByRole('button', { name: 'Mark attempt complete', exact: true }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isEnabled());
  await page.getByRole('button', { name: 'Back to reading' }).click(); await waitReading();
  assert.doesNotMatch(await exerciseButton(1).innerText(), /Complete/);
  assert.ok(await page.getByText('Reading explanation.', { exact: true }).isVisible());
  await ask('Explain the modulus definition again.', 'Reading explanation.');
  console.log('PASS browser close/reopen, completion reversal, and reading questions during cooldown');

  await exerciseButton(4).click(); await waitExercise();
  await page.getByRole('link', { name: '(1.3.4)', exact: true }).click(); await waitReading();
  const targetVisible = await page.locator('#TriangleIneq').evaluate((element) => {
    const rect = element.getBoundingClientRect(); return rect.top >= 60 && rect.top < window.innerHeight;
  });
  assert.ok(targetVisible);
  console.log('PASS exercise identity links return to their reading passage');

  await exerciseButton(8).click(); await waitExercise();
  // Stream errors are visible and do not spend the review wait.
  await clearCooldown();
  await page.route('**/api/tutor', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"error","error":"Simulated provider failure"}\n\n' }), { times: 1 });
  await page.getByRole('button', { name: 'Ask for Help', exact: true }).click();
  await page.getByText('Error: Simulated provider failure', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('lastHelpTimestamp')), null);
  await page.route('**/api/tutor', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"text_delta","content":"Partial reply"}\n\n' }), { times: 1 });
  await page.getByRole('textbox').fill('Follow up after the error.'); await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByText(/The tutor response was interrupted/).waitFor();
  await page.getByRole('textbox').fill('Hold this reply while I reload.');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"]'));
  await page.reload(); await waitExercise();
  await page.getByText('The tutor response was interrupted. Ask again to continue.', { exact: true }).waitFor();
  assert.equal(await page.locator('.animate-bounce').count(), 0);
  console.log('PASS SSE failures and reload during streaming recover without a stuck typing indicator');

  await page.getByRole('link', { name: 'Math Tutor', exact: true }).click();
  await page.getByPlaceholder("Type the math problem you're working on...").waitFor();
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Find a strategy for a quadratic.');
  await draw();
  await clearCooldown(); await page.getByRole('button', { name: 'Ask for Help', exact: true }).click();
  await page.getByText('Exercise hint.', { exact: true }).waitFor();
  assert.match(requests.at(-1).messages[0].content, /NEVER give the full solution/);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: /New Notes/ }).click();
  await page.getByPlaceholder("Topic or concept you're studying...").fill('Complex modulus');
  await clearCooldown(); await page.getByRole('button', { name: 'Ask About This', exact: true }).click();
  await page.getByText('Notes explanation.', { exact: true }).waitFor();
  assert.match(requests.at(-1).messages[0].content, /Give clear, direct explanations/);
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /Current exercise/);
  await page.getByTitle('Speak a question', { exact: true }).click();
  await page.evaluate(() => window.__testRecognition.onresult({ results: [[{ transcript: 'Explain conjugation' }]] }));
  await page.waitForFunction(() => document.querySelector('input[placeholder="Type or speak a follow-up..."]').value === 'Explain conjugation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Notes explanation.', { exact: true }).last().waitFor();
  assert.equal(await page.getByPlaceholder('Type or speak a follow-up...').inputValue(), '');
  await page.getByRole('button', { name: 'Load', exact: true }).click();
  assert.equal(await page.getByText(/Complex Analysis 1\.3 ·/).count(), 0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  console.log('PASS free-form Problem/Notes policies, saving, dictated follow-ups, and workbook-session isolation');

  await page.getByRole('link', { name: 'Workbook', exact: true }).click(); await waitExercise();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.getByRole('button', { name: 'Mark attempt complete', exact: true }).isVisible());
  await page.getByRole('button', { name: 'Back to reading' }).click(); await waitReading();
  assert.ok(await page.getByRole('textbox').isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(browserErrors, []);
  console.log('PASS mobile controls, reading navigation, and no browser exceptions');
} catch (error) {
  if (page) await page.screenshot({ path: join(tmpdir(), 'workbook-acceptance-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => provider.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
