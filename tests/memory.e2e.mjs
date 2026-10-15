import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const origin = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // The reply ends with a topic note, split across chunks the way a stream splits it.
  for (const content of ['Memory hint.', '\n\n<mem', 'ory>\nLimits | learning | medium | Mixed up left and', ' right limits\n</memory>']) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  }
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));

const profileSent = () => requests.at(-1).messages.find((message) => message.role === 'user' && typeof message.content === 'string' && message.content.includes('<learner_profile>'));
const rating = (topic, label) => page.getByRole('group', { name: topic, exact: true }).getByRole('button', { name: label, exact: true });

/** Waits until the saved tutor memory passes `check` (run here on the stored profile). */
async function waitForProfile(check, timeout = 10_000) {
  const read = () => page.evaluate(() => new Promise((resolve) => {
    const open = indexedDB.open('math-tutor');
    open.onsuccess = () => {
      const get = open.result.transaction('settings').objectStore('settings').get('learnerProfile');
      get.onsuccess = () => { open.result.close(); resolve(get.result ?? null); };
      get.onerror = () => { open.result.close(); resolve(null); };
    };
    open.onerror = () => resolve(null);
  }));
  for (const deadline = Date.now() + timeout; ;) {
    const profile = await read();
    if (profile && check(profile)) return;
    if (Date.now() > deadline) throw new Error(`Saved tutor memory never matched: ${JSON.stringify(profile)}`);
    await page.waitForTimeout(200);
  }
}

async function ask() {
  const before = requests.length;
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  // The board's earlier reply shows as soon as the drawer opens, so wait for the request itself.
  for (const deadline = Date.now() + 15_000; requests.length === before && Date.now() < deadline;) await page.waitForTimeout(100);
  assert.equal(requests.length, before + 1);
  await page.getByText('Memory hint.').last().waitFor();
}

try {
  await page.goto(`${origin}/`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.reload();

  // Home offers the tutor memory while it is empty.
  await page.getByRole('link', { name: /Tell the tutor what you know/ }).click();
  await page.getByRole('heading', { name: 'Tutor memory' }).waitFor();

  // About you, two catalog topics and one of the student's own.
  await page.getByRole('textbox', { name: 'About you' }).fill('Retired engineer relearning calculus for fun.');
  await page.getByText('Calculus', { exact: true }).click();
  await rating('Derivatives', 'Solid').click();
  await rating('Limits', 'Learning').click();
  await rating('Limits', 'Rusty').click();
  await page.getByLabel('New topic').fill('Fourier series');
  await page.getByRole('button', { name: 'Add topic' }).click();
  await rating('Fourier series', 'Never seen').click();
  // Tapping the chosen rating again clears it.
  await rating('Derivatives', 'Solid').click();
  assert.equal(await rating('Derivatives', 'Solid').getAttribute('aria-pressed'), 'false');
  await rating('Derivatives', 'Solid').click();
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByText('What the tutor reads').click();
  assert.equal(await page.getByTestId('tutor-reads').innerText(), [
    "About me (in the student's words): Retired engineer relearning calculus for fun.",
    'How they rate their own knowledge:',
    '- Solid: Derivatives',
    '- Rusty: Limits',
    '- Never seen: Fourier series',
  ].join('\n'));

  // It is kept: after a reload the ratings are still there, and the Calculus area opens by itself.
  await page.reload();
  assert.equal(await page.getByRole('textbox', { name: 'About you' }).inputValue(), 'Retired engineer relearning calculus for fun.');
  assert.equal(await rating('Limits', 'Rusty').getAttribute('aria-pressed'), 'true');
  assert.equal(await rating('Fourier series', 'Never seen').getAttribute('aria-pressed'), 'true');
  console.log('PASS the self-assessment and About you are saved and shown as the tutor reads them');

  // A question on a board carries the profile as information, ahead of the conversation.
  await page.goto(`${origin}/board`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Differentiate x^2 sin x');
  await page.locator('.tl-canvas').waitFor();
  await ask();
  const [system] = requests.at(-1).messages;
  assert.match(system.content, /LEARNER PROFILE/);
  assert.match(profileSent().content, /Retired engineer[\s\S]*- Solid: Derivatives[\s\S]*- Rusty: Limits/);
  console.log('PASS questions carry the tutor memory');

  // The tutor's topic note stays out of the chat and lands in the memory.
  assert.match(system.content, /TOPIC NOTES/);
  assert.doesNotMatch(await page.locator('body').innerText(), /Mixed up|memory>|<mem/);
  // The notes are saved once the reply ends; wait for that before opening the memory page.
  await waitForProfile((profile) => profile.topics.some((item) => item.name === 'Limits' && item.tutor));

  // Settings leads there too; the note shows under its topic, and the student can correct it.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /Tutor memory/ }).click();
  await page.getByRole('heading', { name: 'Tutor memory' }).waitFor();
  const note = page.getByTestId('tutor-note-Limits');
  assert.match(await note.innerText(), /Tutor: Learning, fairly sure[\s\S]*Mixed up left and right limits/);
  await page.getByRole('button', { name: "Change the tutor's note on Limits" }).click();
  await page.getByRole('menuitem', { name: "It's Rusty" }).click();
  assert.match(await note.innerText(), /Tutor: Rusty, set by you/);
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByText('What the tutor reads').click();
  assert.match(await page.getByTestId('tutor-reads').innerText(), /- Limits: Rusty \(set by the student\): Mixed up left and right limits/);
  console.log('PASS the tutor notes a topic out of sight of the chat; the student sees and corrects it');

  // With sharing off, nothing is sent and no notes are taken.
  await page.getByLabel('Share this with the tutor').uncheck();
  await waitForProfile((profile) => profile.shareWithTutor === false);
  await page.goto(`${origin}/board`);
  await page.locator('.tl-canvas').waitFor();
  // All tutor requests are at least five seconds apart.
  await page.waitForTimeout(5200);
  await ask();
  assert.equal(profileSent(), undefined);
  assert.doesNotMatch(requests.at(-1).messages[0].content, /LEARNER PROFILE|TOPIC NOTES/);
  await page.goto(`${origin}/memory`);
  await page.getByRole('heading', { name: 'Tutor memory' }).waitFor();
  assert.match(await page.getByTestId('tutor-note-Limits').innerText(), /Tutor: Rusty, set by you/);

  // Home no longer offers it once something is written.
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  assert.equal(await page.getByRole('link', { name: /Tell the tutor what you know/ }).count(), 0);
  console.log('PASS sharing off sends nothing; Home stops offering it');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  provider.close();
}
