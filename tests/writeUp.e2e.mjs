import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const origin = process.env.WORKBOOK_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const browserErrors = [];
// The model's write-up, in a code fence with a preamble it was told not to add, in two pieces.
const reply = [
  '```latex\n\\documentclass{article}\n\\begin{document}\n\\textbf{Problem.} Find $x$ when $2x + 3 = 7$.\n\n\\textbf{Solution.}\n',
  '\\begin{align*}\n2x + 3 &= 7 \\\\\n2x &= 4 \\\\\nx &= 2\n\\end{align*}\n\\end{document}\n```',
];

const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const content of reply) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(error.message));
const dialog = () => page.getByRole('dialog', { name: 'TeX write-up' });

try {
  await page.goto(`${origin}/board`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 7');
  await page.locator('.tl-canvas').waitFor();
  const board = await page.locator('.tl-canvas').boundingBox();
  await page.mouse.move(board.x + 120, board.y + 120);
  await page.mouse.down();
  await page.mouse.move(board.x + 300, board.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.getByText('Saved', { exact: true }).waitFor();

  // The server keeps tutor requests five seconds apart, also across test files run back to back;
  // the write-up waits that out by itself.
  await page.getByRole('button', { name: 'TeX write-up' }).click();
  await dialog().getByRole('button', { name: 'Write up the board' }).click();
  await dialog().getByTestId('write-up-preview').locator('.katex').first().waitFor({ timeout: 15_000 });
  await dialog().getByRole('button', { name: 'Write up again' }).waitFor();
  assert.equal(requests.length, 1);
  const [system, ...rest] = requests[0].messages;
  assert.match(system.content, /Transcribe, don't solve/);
  assert.doesNotMatch(system.content, /NEVER give the full solution|TOPIC NOTES/);
  assert.match(JSON.stringify(rest), /Write up the handwritten work on my board in LaTeX/);
  assert.match(JSON.stringify(rest), /image_url/);
  const editor = dialog().getByRole('textbox', { name: 'LaTeX' });
  const tex = await editor.inputValue();
  assert.match(tex, /^\\textbf\{Problem\.\} Find \$x\$/);
  assert.doesNotMatch(tex, /```|documentclass|begin\{document\}/);
  assert.match(await dialog().getByTestId('write-up-preview').innerText(), /Problem\.[\s\S]*Solution\./);
  console.log('PASS the board is written up as LaTeX, shown beside a preview');

  // An edit shows in the preview and in the downloaded file.
  await editor.fill(`${tex}\n\n\\section*{Check}\nIndeed $2 \\cdot 2 + 3 = 7$.`);
  await dialog().getByRole('heading', { name: 'Check' }).waitFor();
  const [file] = await Promise.all([page.waitForEvent('download'), dialog().getByRole('button', { name: 'Download .tex' }).click()]);
  assert.equal(file.suggestedFilename(), 'Find x when 2x + 3 = 7.tex');
  const downloaded = await readFile(await file.path(), 'utf8');
  assert.match(downloaded, /^\\documentclass\{article\}\n\\usepackage\{amsmath,amssymb\}\n\\title\{Find x when 2x \+ 3 = 7\}/);
  assert.match(downloaded, /\\begin\{document\}\n\\maketitle\n\n\\textbf\{Problem\.\}[\s\S]*\\section\*\{Check\}\nIndeed[\s\S]*\\end\{document\}\n$/);
  console.log('PASS edits show in the preview and the .tex downloads');

  // The write-up is saved with the board.
  await dialog().getByRole('button', { name: 'Close' }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.waitForTimeout(1200);
  await page.reload();
  await page.locator('.tl-canvas').waitFor();
  await page.getByRole('button', { name: 'TeX write-up' }).click();
  assert.match(await dialog().getByRole('textbox', { name: 'LaTeX' }).inputValue(), /\\section\*\{Check\}/);
  console.log('PASS the write-up is saved with the board');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  provider.close();
}
