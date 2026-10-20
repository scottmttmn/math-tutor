import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
// Each request gets the next problem, sent in two pieces with the title line first.
const problems = [
  ['Title: A contour integral\n\nEvaluate \\(\\oint_{|z|=2} \\frac{e^z}{z^2+1}', '\\,dz\\), counterclockwise.'],
  ['Title: Residue at infinity\n\nFind the residue of \\(\\frac{z^3}{z^4-1}\\)', ' at \\(z = \\infty\\).'],
  ['Title: Sums of squares\n\nShow that no integer \\(n \\equiv 3 \\pmod 4\\)', ' is a sum of two squares.'],
];

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const content of problems[(requests.length - 1) % problems.length]) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));
const dialog = () => page.getByRole('dialog', { name: 'Problem from tutor' });
const shown = () => page.getByTestId('tutor-problem');
const askTutorForProblem = async (ask) => {
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('button', { name: 'Problem from tutor…' }).click();
  await dialog().getByRole('button', { name: "Tutor's choice" }).waitFor();
  if (ask) await dialog().getByLabel(/Anything else/).fill(ask);
  await dialog().getByRole('button', { name: 'Make problem' }).click();
};

try {
  await page.goto(`${origin}/board`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.goto(origin);

  // From Home: the form opens a new board, where the tutor writes the problem.
  await askTutorForProblem('something about residues');
  await page.waitForURL(/\/board$/);
  await shown().locator('.katex').first().waitFor({ timeout: 20_000 });
  assert.match(await shown().innerText(), /counterclockwise/);
  await page.getByRole('heading', { level: 1, name: 'A contour integral' }).waitFor();
  assert.equal(await page.getByPlaceholder("Type the math problem you're working on...").count(), 0);
  assert.equal(requests.length, 1);
  const [system, ...rest] = requests[0].messages;
  assert.match(system.content, /Write ONE problem/);
  assert.doesNotMatch(system.content, /The answer is theirs to find|TOPIC NOTES/);
  assert.match(JSON.stringify(rest), /Write me a problem. You choose the topic.\\nAlso: something about residues/);
  assert.doesNotMatch(JSON.stringify(rest), /image_url/);
  await page.getByText('Saved', { exact: true }).waitFor();
  console.log('PASS + New → Problem from tutor opens a board with the problem typeset');

  // Different problem replaces it while the board is empty, and tells the tutor what it already offered.
  await page.getByRole('button', { name: 'Different problem' }).click();
  await page.getByRole('heading', { level: 1, name: 'Residue at infinity' }).waitFor({ timeout: 20_000 });
  assert.match(await shown().innerText(), /residue of/);
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].messages), /Not one of these, which I was already offered:\\n- Evaluate/);
  console.log('PASS Different problem swaps in another one');

  // Once there is work on the board, the problem stays.
  const board = await page.locator('.tl-canvas').boundingBox();
  await page.mouse.move(board.x + 150, board.y + 150);
  await page.mouse.down();
  await page.mouse.move(board.x + 320, board.y + 220, { steps: 8 });
  await page.mouse.up();
  await page.getByRole('button', { name: 'Different problem' }).waitFor({ state: 'detached' });
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await shown().locator('.katex').first().waitFor();
  await page.getByRole('heading', { level: 1, name: 'Residue at infinity' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Different problem' }).count(), 0);
  console.log('PASS with work on the board the problem stays, and it is saved');

  // On a board, the form starts the new board in place; Home lists both by the tutor's titles.
  await askTutorForProblem('');
  await page.getByRole('heading', { level: 1, name: 'Sums of squares' }).waitFor({ timeout: 20_000 });
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Home' }).click();
  await page.getByText('Sums of squares').first().waitFor();
  await page.getByText('Residue at infinity').first().waitFor();
  console.log('PASS from a board too, and Home lists them by title');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  provider.close();
}
