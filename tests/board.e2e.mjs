import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  // Arrive at the start in steps, so tldraw has the pointer there before it goes down (in CI a
  // stroke once began from where the pointer had been).
  await page.mouse.move(box.x + 40 + offset, box.y + 80, { steps: 4 });
  await page.waitForTimeout(50);
  await page.mouse.down();
  await page.mouse.move(box.x + 180 + offset, box.y + 160, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === 'Clear board' && !button.disabled));
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
const PROBLEM_PLACEHOLDER = "Type the math problem you're working on...";
const TOPIC_PLACEHOLDER = "Topic or concept you're studying...";
// The new board loads only once the open one is saved, and the editor's load wipes anything written
// before it (in CI a stroke drawn right after New vanished). So wait until the box and Clear show the
// empty board (which needs the open board to have something on it, or nothing tells them apart) and
// the canvas has applied the load (`data-loading` gone).
async function newBoard(type) {
  const showing = () => page.evaluate(([problem, topic]) => ({
    text: document.querySelector(`[placeholder="${problem}"], [placeholder="${topic}"]`)?.value ?? '',
    drawn: [...document.querySelectorAll('button')].some((button) => button.getAttribute('aria-label') === 'Clear board' && !button.disabled),
  }), [PROBLEM_PLACEHOLDER, TOPIC_PLACEHOLDER]);
  const before = await showing();
  assert.ok(before.text || before.drawn, 'newBoard is called with something on the open board');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: type === 'note' ? /New Notes/ : 'New Problem' }).click();
  await page.waitForFunction(([placeholder]) => {
    const box = document.querySelector(`[placeholder="${placeholder}"]`);
    const clear = [...document.querySelectorAll('button')].find((button) => button.getAttribute('aria-label') === 'Clear board');
    return box?.value === '' && clear?.disabled === true && !document.querySelector('[data-loading]');
  }, [type === 'note' ? TOPIC_PLACEHOLDER : PROBLEM_PLACEHOLDER]);
}
try {
  await openBrowser(); await waitProblem();
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.reload(); await waitProblem();

  // The native style controls start behind a 44px pen chip, with S/solid still the defaults.
  const penChip = () => page.getByRole('button', { name: /^Pen: / });
  await penChip().waitFor();
  assert.equal(await penChip().getAttribute('aria-label'), 'Pen: black, S');
  assert.equal(await penChip().getAttribute('title'), 'Pen: black, S');
  assert.ok((await penChip().boundingBox()).height >= 44);
  assert.equal(await page.getByTestId('style.panel').count(), 0);
  await penChip().click();
  assert.equal(await page.getByTestId('style.dash.solid').getAttribute('aria-checked'), 'true');
  await page.getByTestId('style.size.m').click();
  await page.getByRole('button', { name: 'Pen: black, M', exact: true }).waitFor();
  await page.getByTestId('style.color.blue').click();
  await page.getByRole('button', { name: 'Pen: blue, M', exact: true }).waitFor();
  assert.ok(await page.getByTestId('style.panel').isVisible(), 'two style changes leave the panel open');
  await page.reload(); await waitProblem();
  await page.getByTestId('style.panel').waitFor();
  assert.equal(await penChip().getAttribute('aria-expanded'), 'true', 'open is remembered on this device');
  assert.match(await penChip().getAttribute('aria-label'), /, S$/, 'a fresh board still starts at S');
  await page.keyboard.press('Escape');
  await page.getByTestId('style.panel').waitFor({ state: 'detached' });
  await page.reload(); await waitProblem();
  await penChip().waitFor();
  assert.equal(await penChip().getAttribute('aria-expanded'), 'false', 'collapsed is remembered too');
  if (process.env.STYLE_SCREENSHOT_DIR) {
    await mkdir(process.env.STYLE_SCREENSHOT_DIR, { recursive: true });
    for (const width of [1600, 700]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(process.env.STYLE_SCREENSHOT_DIR, `collapsed-${width}.png`) });
      await penChip().click();
      await page.getByTestId('style.panel').waitFor();
      await page.screenshot({ path: join(process.env.STYLE_SCREENSHOT_DIR, `open-${width}.png`) });
      await penChip().click();
    }
    await page.setViewportSize(launchOptions.viewport);
  }
  console.log('PASS pen chip defaults, native size/color controls, Escape, and remembered open/collapsed state');

  // A problem board asks for hints, never the answer.
  await problemBox().fill('Find a strategy for a quadratic.');
  await penChip().click();
  await draw();
  assert.equal(await penChip().getAttribute('aria-expanded'), 'false', 'starting a pen stroke collapses the panel');
  let request = await askTutor('Problem hint.');
  assert.match(request.messages[0].content, /The answer is theirs to find/);
  assert.match(JSON.stringify(request.messages), /Find a strategy for a quadratic/);
  console.log('PASS a problem board gets hints with its problem and board');
  // A problem board starts on blank paper; the choice is kept with the board.
  await page.locator('[data-paper="blank"]').waitFor();
  await page.getByRole('button', { name: 'Paper: Blank' }).click();
  await page.getByRole('menuitemradio', { name: 'Lined' }).click();
  await page.locator('[data-paper="lined"]').waitFor();
  await page.waitForTimeout(1200);
  await page.reload(); await waitProblem();
  await page.locator('[data-paper="lined"]').waitFor();
  await page.getByRole('button', { name: 'Paper: Lined' }).click();
  await page.getByRole('menuitemradio', { name: 'Blank' }).click();
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
  assert.ok(await page.getByRole('button', { name: 'Clear board', exact: true }).isEnabled());
  assert.ok(await page.getByText('Problem hint.', { exact: true }).first().isVisible());
  assert.equal(await problemBox().inputValue(), 'Find a strategy for a quadratic.');
  console.log('PASS immediate reload preserves board, conversation, problem and Solved');

  // Selecting shapes sends just those shapes, trimmed.
  // The shapes on screen, with where they are, to find the new stroke (and to report on failure).
  const shapesShown = () => page.locator('.tl-shape').evaluateAll((shapes) => shapes.map((shape) => {
    const { x, y, width, height } = shape.getBoundingClientRect();
    return { id: shape.dataset.shapeId ?? shape.id, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }));
  const earlier = new Set((await shapesShown()).map((shape) => shape.id));
  await draw(260);
  const drawn = (await shapesShown()).filter((shape) => !earlier.has(shape.id));
  assert.equal(drawn.length, 1, `one new stroke (${JSON.stringify(await shapesShown())}, board ${JSON.stringify(await board().boundingBox())})`);
  await page.locator('[data-testid="tools.select"]').first().click();
  // Click the new stroke where it is on screen, so the selection doesn't depend on the board's camera
  // or panels: just short of where it ends, the box's lower right corner (it runs down and right).
  await page.mouse.click(drawn[0].x + drawn[0].width - 4, drawn[0].y + drawn[0].height - 2.5);
  await page.waitForFunction(() => document.querySelector('[data-testid="quick-actions.delete"]')?.disabled === false, null, { timeout: 5000 })
    .catch(async () => assert.fail(`the stroke wasn't selected (${JSON.stringify(drawn[0])}; shapes ${JSON.stringify(await shapesShown())})`));
  assert.equal(await penChip().getAttribute('aria-expanded'), 'false', 'selecting does not open the style panel');
  await penChip().click();
  await page.getByTestId('style.size.m').click();
  await page.getByTestId('style.color.blue').click();
  await page.getByRole('button', { name: 'Pen: blue, M', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await penChip().getAttribute('aria-label'), 'Pen: blue, M', 'the collapsed chip reflects the restyled selection');
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
  assert.ok(imageOf(request)?.startsWith('data:image/png;base64,'), 'unchanged follow-up still carries the selected work');
  // Selecting more work changes no document records, but the next image must reflect it.
  await page.locator('[data-testid="tools.select"]').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  request = await ask('Check everything selected now.', 'Problem hint.');
  assert.notEqual(imageOf(request), image, 'a changed selection changes the capture without new ink');
  await draw(120);
  request = await ask('What about now?', 'Problem hint.');
  assert.ok(imageOf(request)?.startsWith('data:image/png;base64,'));
  console.log('PASS selected shapes reach the provider trimmed; every follow-up attaches the board; five-second limit rejects bursts');

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
  assert.ok(await page.getByRole('button', { name: 'Clear board', exact: true }).isEnabled());
  assert.ok(await page.getByText('Does this approach make sense?', { exact: true }).isVisible());
  console.log('PASS browser close/reopen and taking Solved back');

  // A new board starts empty, with its own conversation.
  await newBoard('problem'); await waitProblem();
  await problemBox().fill('Expand (x + 1)^2.');
  await openTutor();
  assert.ok(await page.getByRole('button', { name: 'Clear board', exact: true }).isDisabled());
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
  await history.getByRole('searchbox', { name: 'Search texts, problems and notes' }).fill('modulus');
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
  await history.getByRole('searchbox', { name: 'Search texts, problems and notes' }).fill('quadratic');
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
