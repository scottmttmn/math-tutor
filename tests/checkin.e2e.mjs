import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
// The tutor's replies in turn: the first problem, then a verdict, the next problem and a settled topic.
const replies = [
  'Problem 1 (Limits): Find \\( \\lim_{x \\to 2} (3x + 1) \\).',
  'Right. Problem 2 (Integrals): Find \\( \\int_0^1 2x \\, dx \\).\n\n<memory>\nLimits | solid | medium | Evaluated a limit by substitution cleanly\n</memory>',
];

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const content = replies[Math.min(requests.length, replies.length) - 1];
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));

const rating = (topic, label) => page.getByRole('group', { name: topic, exact: true }).getByRole('button', { name: label, exact: true });
const lastUserText = () => JSON.stringify(requests.at(-1).messages.at(-1).content);

async function ask(text) {
  const before = requests.length;
  await page.getByRole('button', { name: /^(Start check-in|Hand in answer)$/ }).click();
  for (const deadline = Date.now() + 15_000; requests.length === before && Date.now() < deadline;) await page.waitForTimeout(100);
  assert.equal(requests.length, before + 1);
  await page.getByText(text).last().waitFor();
}

try {
  await page.goto(`${origin}/memory`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.reload();
  await page.getByRole('heading', { name: 'Tutor memory' }).waitFor();

  // Nothing uncertain yet, so nothing to check.
  await page.getByText('Nothing to check yet.').waitFor();
  await page.getByText('Calculus', { exact: true }).click();
  await rating('Limits', 'Rusty').click();
  await rating('Derivatives', 'Solid').click();
  await rating('Integrals', 'Learning').click();
  const topics = page.getByRole('group', { name: /Topics to check/ });
  assert.deepEqual(await topics.getByRole('checkbox').evaluateAll((boxes) => boxes.map((box) => [box.closest('label').innerText.split('\n')[0], box.checked])), [['Limits', true], ['Integrals', true]]);
  console.log('PASS the check-in offers the uncertain topics');

  await page.getByRole('button', { name: 'Start check-in (2 topics)' }).click();
  await page.waitForURL(`${origin}/board`);
  await page.getByRole('heading', { name: 'Skill check-in: Limits, Integrals' }).waitFor();
  await page.locator('.tl-canvas').waitFor();

  // Ask tutor fetches the first problem from the check-in prompt. The server keeps tutor requests
  // five seconds apart, also across test files run back to back.
  await page.waitForTimeout(5200);
  // Ask tutor fetches the first problem from the check-in prompt.
  await ask('Problem 1 (Limits)');
  const [system] = requests[0].messages;
  assert.match(system.content, /SKILL CHECK-IN/);
  assert.match(system.content, /TOPIC NOTES/);
  assert.match(JSON.stringify(requests[0].messages), /CHECK-IN TOPICS[^"]*- Limits\\n- Integrals/);
  assert.match(lastUserText(), /Start the check-in\./);
  assert.doesNotMatch(lastUserText(), /problem I'm working on/);
  console.log('PASS the first problem comes from the check-in prompt');

  // Re-reading the problem after closing must not hand in an answer, even during the limit.
  const beforeReopen = requests.length;
  await page.getByRole('button', { name: 'Close tutor' }).click();
  const showProblem = page.getByRole('button', { name: 'Show check-in problem', exact: true });
  assert.ok(await showProblem.isEnabled());
  await showProblem.click();
  await page.getByRole('complementary', { name: 'Tutor' }).getByText('Problem 1 (Limits)', { exact: false }).waitFor();
  assert.equal(requests.length, beforeReopen, 'showing the current problem sends no request');
  assert.equal(await page.getByRole('group', { name: 'Tutor choices' }).count(), 0);
  console.log('PASS a closed check-in problem reopens without submitting the board');

  // The answer goes in by hand; the tutor's verdict settles Limits in the memory.
  await page.waitForTimeout(5200);
  await ask('Problem 2 (Integrals)');
  assert.match(lastUserText(), /Here is my answer\./);
  assert.doesNotMatch(await page.locator('body').innerText(), /Evaluated a limit|memory>/);

  // The note is saved once the reply ends.
  for (const deadline = Date.now() + 10_000; ;) {
    const noted = await page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open('math-tutor');
      open.onsuccess = () => {
        const get = open.result.transaction('settings').objectStore('settings').get('learnerProfile');
        get.onsuccess = () => { open.result.close(); resolve(Boolean(get.result?.topics.some((topic) => topic.name === 'Limits' && topic.tutor))); };
      };
    }));
    if (noted) break;
    assert.ok(Date.now() < deadline, 'the check-in note was never saved');
    await page.waitForTimeout(200);
  }

  // Home lists the check-in board.
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.getByText('Skill check-in: Limits, Integrals').first().waitFor();

  await page.goto(`${origin}/memory`);
  await page.getByRole('heading', { name: 'Tutor memory' }).waitFor();
  assert.match(await page.getByTestId('tutor-note-Limits').innerText(), /Tutor: Solid, fairly sure[\s\S]*Evaluated a limit by substitution/);
  console.log('PASS answers are handed in from the board and the result lands in the tutor memory');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  provider.close();
}
