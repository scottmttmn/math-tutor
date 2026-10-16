import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
const profile = await mkdtemp(join(tmpdir(), 'board-acceptance-'));
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  requests.push(body);
  const system = body.messages[0].content;
  const reply = system.includes('Give clear, direct explanations') ? 'Notes explanation.' : 'Problem hint.';
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  if (JSON.stringify(body.messages.at(-1)).includes('Long response safety check')) {
    setTimeout(() => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    }, 7000);
    return;
  }
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
  await page.goto(`${origin}/board`);
}
const problemBox = () => page.getByPlaceholder("Type the math problem you're working on...");
const waitProblem = () => problemBox().waitFor();
// The tutor is a drawer on every board, closed until asked.
async function openTutor() {
  const closed = page.getByRole('button', { name: 'Tutor', exact: true, pressed: false });
  if (await closed.count()) await closed.click();
}
const followUp = () => page.getByPlaceholder('Type or speak a follow-up...');
async function ask(question, reply) {
  const before = requests.length;
  await openTutor();
  await followUp().fill(question);
  const responseReady = page.waitForResponse((response) => response.url() === `${origin}/api/tutor`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const response = await responseReady;
  assert.equal(response.status(), 200, await response.text());
  await response.finished();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await page.getByText(reply, { exact: true }).last().waitFor();
  assert.equal(requests.length, before + 1);
  return requests.at(-1);
}
const board = () => page.locator('.tl-canvas').first();
async function draw(offset = 0) {
  await board().waitFor();
  const box = await board().boundingBox();
  await page.locator('[data-testid="tools.draw"]').first().click();
  await page.mouse.move(box.x + 40 + offset, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 180 + offset, box.y + 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Clear' && !button.disabled));
  await page.waitForTimeout(400); // the app mirrors tldraw's document once the pen rests
}
const imageOf = (request) => {
  const content = request.messages.at(-1).content;
  return Array.isArray(content) ? content.find((part) => part.type === 'image_url')?.image_url.url : undefined;
};
async function waitForTutorReady() {
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) =>
    button.textContent === 'Ask tutor' && !button.disabled));
}
async function askTutor(reply) {
  const before = requests.length;
  await waitForTutorReady();
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  // The board export is async, so wait for the request rather than the busy flag.
  while (requests.length === before) await new Promise((resolve) => setTimeout(resolve, 50));
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await page.getByText(reply, { exact: true }).last().waitFor();
  return requests.at(-1);
}
async function newBoard(type) {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: type === 'note' ? /New Notes/ : 'New Problem' }).click();
}
try {
  await openBrowser(); await waitProblem();
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.reload(); await waitProblem();

  // A problem board asks for hints, never the answer.
  await problemBox().fill('Find a strategy for a quadratic.');
  await draw();
  let request = await askTutor('Problem hint.');
  assert.match(request.messages[0].content, /The answer is theirs to find/);
  assert.match(JSON.stringify(request.messages), /Find a strategy for a quadratic/);
  console.log('PASS a problem board gets hints with its problem and board');
  // A problem board starts on blank paper; the choice is kept with the board.
  await page.locator('[data-paper="blank"]').waitFor();
  await page.getByRole('button', { name: 'Paper: Blank' }).click();
  await page.getByRole('menuitem', { name: 'Lined' }).click();
  await page.locator('[data-paper="lined"]').waitFor();
  await page.waitForTimeout(1200);
  await page.reload(); await waitProblem();
  await page.locator('[data-paper="lined"]').waitFor();
  await page.getByRole('button', { name: 'Paper: Lined' }).click();
  await page.getByRole('menuitem', { name: 'Blank' }).click();
  await page.locator('[data-paper="blank"]').waitFor();
  await page.getByRole('button', { name: 'Tutor', exact: true }).click(); // The reload closed it.
  console.log('PASS board paper: blank by default, changed and kept');

  // One request at a time: a long reply blocks others past five seconds, then a follow-up can go at once.
  await waitForTutorReady();
  await followUp().fill('Long response safety check');
  const longResponseReady = page.waitForResponse((response) => response.url() === `${origin}/api/tutor`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"]'));
  await page.waitForTimeout(5500); // Exercise the active-request lock after the five-second interval expires.
  const duringStream = await page.evaluate(async (modelConfig) => {
    const response = await fetch('/api/tutor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelConfig, chatHistory: [], problemStatement: '', canvasImage: '', userQuestion: 'Concurrent request' }),
    });
    return { status: response.status, message: await response.text() };
  }, model);
  assert.equal(duringStream.status, 429);
  assert.match(duringStream.message, /already answering/);
  await (await longResponseReady).finished();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await followUp().fill('Follow up immediately after the long reply');
  assert.ok(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled());
  await ask('Follow up immediately after the long reply', 'Problem hint.');
  console.log('PASS active stream blocks concurrent calls after five seconds, then allows an immediate follow-up');

  // A reload straight after marking it solved keeps the board, the conversation and Solved.
  await page.getByRole('button', { name: 'Mark solved', exact: true }).click();
  await page.reload(); await waitProblem(); await openTutor();
  assert.ok(await page.getByRole('button', { name: 'Solved', exact: true }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isEnabled());
  assert.ok(await page.getByText('Problem hint.', { exact: true }).first().isVisible());
  assert.equal(await problemBox().inputValue(), 'Find a strategy for a quadratic.');
  console.log('PASS immediate reload preserves board, conversation, problem and Solved');

  // Selecting shapes sends just those shapes, trimmed.
  await draw(260);
  const box = await board().boundingBox();
  await page.locator('[data-testid="tools.select"]').first().click();
  // Click the new stroke's middle (it runs straight from 300,80 to 440,160): a hit on the line
  // selects it wherever tldraw's panels sit, which a drag box didn't. Delete turns on once it holds a shape.
  await page.mouse.click(box.x + 370, box.y + 120);
  await page.waitForFunction(() => document.querySelector('[data-testid="quick-actions.delete"]')?.disabled === false);
  request = await askTutor('Problem hint.');
  // Whether the stroke is still selected after asking, for the message if the size check fails.
  const stillSelected = await page.evaluate(() => document.querySelector('[data-testid="quick-actions.delete"]')?.disabled === false);
  const image = imageOf(request);
  assert.ok(image?.startsWith('data:image/png;base64,'));
  const [width, height] = await page.evaluate(async (src) => {
    const image = new Image(); image.src = src; await image.decode(); return [image.naturalWidth, image.naturalHeight];
  }, image);
  // One ~140x80 stroke at 2x with padding, not both strokes and not the whole board.
  assert.ok(width > 200 && width < 450 && height > 120 && height < 330, `unexpected image size ${width}x${height} (still selected after asking: ${stillSelected})`);
  // The shared five-second limit: no countdown, and direct API bursts never reach the provider.
  assert.ok(await page.getByRole('button', { name: 'Ask tutor', exact: true }).isDisabled());
  assert.equal(await page.getByRole('button', { name: /^Wait / }).count(), 0);
  const beforeBurst = requests.length;
  const rejected = await page.evaluate(async (modelConfig) => {
    const response = await fetch('/api/tutor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelConfig, chatHistory: [], problemStatement: '', canvasImage: '', userQuestion: 'Rapid follow-up' }),
    });
    return { status: response.status, retryAfter: response.headers.get('Retry-After') };
  }, model);
  assert.equal(rejected.status, 429);
  assert.ok(Number(rejected.retryAfter) > 0);
  assert.equal(requests.length, beforeBurst);
  request = await ask('Does this approach make sense?', 'Problem hint.');
  assert.equal(imageOf(request), undefined);
  await draw(120);
  request = await ask('What about now?', 'Problem hint.');
  assert.ok(imageOf(request)?.startsWith('data:image/png;base64,'));
  console.log('PASS selected shapes reach the provider trimmed; follow-ups attach the board only after it changes; five-second limit rejects bursts');

  // Full screen hides the bar, problem and tutor; the board keeps its strokes.
  await page.getByRole('button', { name: 'Full screen' }).click();
  await page.getByRole('link', { name: 'Home', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('complementary', { name: 'Tutor' }).count(), 0);
  assert.equal(await page.getByRole('region', { name: 'Problem' }).count(), 0);
  await page.locator('.tl-shape').first().waitFor();
  // Tutor in full screen leaves it and shows the conversation.
  await page.getByRole('button', { name: 'Tutor', exact: true }).click();
  await page.getByRole('button', { name: 'Full screen' }).waitFor();
  await page.getByRole('complementary', { name: 'Tutor' }).waitFor();
  // The open tutor stands in the problem's place; Show problem closes it.
  await page.getByRole('button', { name: 'Show problem' }).click(); await waitProblem();
  assert.equal(await page.getByRole('complementary', { name: 'Tutor' }).count(), 0);
  // The problem can give the board its room, and comes back.
  await page.getByRole('button', { name: 'Hide problem' }).click();
  assert.equal(await page.getByRole('region', { name: 'Problem' }).count(), 0);
  await page.getByRole('button', { name: 'Show problem' }).click(); await waitProblem();
  console.log('PASS full screen and the problem/tutor toggles');

  // Closing the browser and coming back reopens the same board; Solved can be taken back.
  await page.getByRole('button', { name: 'Solved', exact: true }).click();
  await page.getByRole('button', { name: 'Mark solved', exact: true }).waitFor();
  await page.waitForTimeout(1200); // past the autosave delay
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await context.close(); await openBrowser(); await waitProblem(); await openTutor();
  assert.ok(await page.getByRole('button', { name: 'Mark solved', exact: true }).isVisible());
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isEnabled());
  assert.ok(await page.getByText('Does this approach make sense?', { exact: true }).isVisible());
  console.log('PASS browser close/reopen and taking Solved back');

  // A new board starts empty, with its own conversation.
  await newBoard('problem'); await waitProblem();
  await problemBox().fill('Expand (x + 1)^2.');
  await openTutor();
  assert.ok(await page.getByRole('button', { name: 'Clear', exact: true }).isDisabled());
  assert.equal(await page.getByText('Problem hint.', { exact: true }).count(), 0);
  request = await askTutor('Problem hint.');
  assert.doesNotMatch(JSON.stringify(request.messages), /Does this approach make sense/);
  console.log('PASS a new board keeps its board and conversation separate');

  // Stream errors are visible and still consume the short request interval.
  await waitForTutorReady();
  await page.route('**/api/tutor', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"error","error":"Simulated provider failure"}\n\n' }), { times: 1 });
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem').first().click(); // Hint, or Explain this on notes
  await page.getByText('Error: Simulated provider failure', { exact: true }).waitFor();
  assert.ok(await page.evaluate(() => Number(localStorage.getItem('lastHelpTimestamp')) > 0));
  await page.route('**/api/tutor', (route) => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"text_delta","content":"Partial reply"}\n\n' }), { times: 1 });
  await followUp().fill('Follow up after the error.'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText(/The tutor response was interrupted/).waitFor();
  await followUp().fill('Hold this reply while I reload.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.waitForFunction(() => !!document.querySelector('[aria-busy="true"]'));
  await page.reload(); await waitProblem(); await openTutor();
  await page.getByText('The tutor response was interrupted. Ask again to continue.', { exact: true }).last().waitFor();
  assert.equal(await page.locator('.animate-bounce').count(), 0);
  console.log('PASS SSE failures and reload during streaming recover without a stuck typing indicator');

  // Ask tutor says what is wanted: Check my work asks for a verdict; Ask… opens the chat box first.
  await newBoard('problem');
  await problemBox().fill('Show that the sum of two odd numbers is even.');
  await draw();
  await waitForTutorReady();
  let asked = requests.length;
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Hint', 'Check my work', 'Feedback', 'Ask…']);
  await page.getByRole('menuitem', { name: 'Check my work' }).click();
  while (requests.length === asked) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.match(JSON.stringify(requests.at(-1).messages.at(-1)), /Is my work right\? Please check it\./);
  await page.getByText('Problem hint.', { exact: true }).last().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await newBoard('problem');
  await problemBox().fill('Factor x^2 - 1.');
  await draw();
  await waitForTutorReady();
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Ask…' }).click();
  await page.waitForFunction(() => document.activeElement?.id === 'tutor-question');
  asked = requests.length;
  await page.getByPlaceholder('Type or speak a question about your board...').fill('Is difference of squares the right idea?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  while (requests.length === asked) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(imageOf(requests.at(-1)), 'a question that opens the conversation takes the board');
  await page.getByText('Problem hint.', { exact: true }).last().waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  console.log('PASS Ask tutor offers Hint, Check my work, Feedback and Ask…');

  // A Notes board explains directly; dictated follow-ups land in the box.
  await newBoard('note');
  await page.locator('[data-paper="lined"]').waitFor(); // Notes start on lined paper.
  await page.getByPlaceholder("Topic or concept you're studying...").fill('Complex modulus');
  request = await askTutor('Notes explanation.');
  assert.match(request.messages[0].content, /Give clear, direct explanations/);
  await page.getByTitle('Speak a question', { exact: true }).click();
  await page.evaluate(() => window.__testRecognition.onresult({ results: [[{ transcript: 'Explain conjugation' }]] }));
  await page.waitForFunction(() => document.querySelector('textarea[placeholder="Type or speak a follow-up..."]').value === 'Explain conjugation');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Notes explanation.', { exact: true }).last().waitFor();
  assert.equal(await followUp().inputValue(), '');

  // Home lists every board, offers the last one first, and searches, filters and renames.
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  const history = page.getByRole('main');
  await history.getByText('Complex modulus', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Continue Complex modulus' }).waitFor();
  assert.ok(await history.getByText('Find a strategy for a quadratic.', { exact: true }).count() > 0);
  await history.getByRole('button', { name: 'Problems', exact: true }).click();
  assert.equal(await history.getByText('Complex modulus', { exact: true }).count(), 1, 'only in Continue');
  await history.getByRole('button', { name: 'All', exact: true }).click();
  await history.getByRole('searchbox', { name: 'Search problems and notes' }).fill('modulus');
  assert.equal(await page.locator('[aria-labelledby="boards-heading"] li').count(), 1);
  // A name given in History survives the open session's next autosave.
  await history.getByRole('button', { name: /^More for / }).click();
  // The menu draws over the card's edge rather than being clipped by it.
  const deleteItem = history.getByRole('menuitem', { name: 'Delete' });
  const deleteBox = await deleteItem.boundingBox();
  assert.ok(await deleteItem.evaluate((element, [x, y]) => element.contains(document.elementFromPoint(x, y)), [deleteBox.x + deleteBox.width / 2, deleteBox.y + deleteBox.height / 2]), 'Delete is reachable');
  await history.getByRole('menuitem', { name: 'Rename' }).click();
  await history.getByRole('textbox', { name: 'Name' }).fill('Modulus notes');
  await history.getByRole('textbox', { name: 'Name' }).press('Enter');
  await history.getByRole('button', { name: 'Open Modulus notes' }).waitFor();
  await history.getByRole('button', { name: 'Open Modulus notes' }).click();
  await page.waitForURL(`${origin}/board`);
  // Leaving straight after an edit, inside the autosave delay, still saves before Home lists it.
  await page.getByPlaceholder("Topic or concept you're studying...").fill('Complex modulus and argument');
  await page.getByRole('link', { name: 'Home', exact: true }).click();
  await history.getByRole('button', { name: 'Open Modulus notes' }).waitFor();
  await history.getByText('Complex modulus and argument').first().waitFor();
  console.log('PASS free-form Notes policy, dictated follow-ups, and Home search, filter and rename');

  // Opening an older board from Home brings back its conversation.
  await history.getByRole('searchbox', { name: 'Search problems and notes' }).fill('quadratic');
  await history.getByRole('button', { name: 'Open Find a strategy for a quadratic.' }).click();
  await page.waitForURL(`${origin}/board`); await waitProblem(); await openTutor();
  assert.ok(await page.getByText('Does this approach make sense?', { exact: true }).isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.getByRole('button', { name: 'Mark solved', exact: true }).isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(browserErrors, []);
  console.log('PASS reopening from Home, mobile layout, and no browser exceptions');
} catch (error) {
  if (page) await page.screenshot({ path: join(tmpdir(), 'board-acceptance-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await new Promise((resolve) => provider.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
