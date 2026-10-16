// The Android app's bundle (out/, from `npm run build:android`) served the way the app serves it:
// Capacitor answers every path without an extension with index.html (Home), other paths with the file.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const root = join(import.meta.dirname, '..', 'out');
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.txt': 'text/plain',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const last = path.split('/').pop();
  const file = path === '/' || !last.includes('.') ? '/index.html' : normalize(path);
  try {
    const body = await readFile(join(root, file));
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  await page.getByRole('link', { name: 'Shelf' }).first().click();
  await page.getByRole('heading', { name: 'Shelf', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/shelf');
  console.log('PASS Home opens and links work inside the bundle');

  // A full load of a page other than Home (a reload) shows that page, under its own address.
  await page.reload();
  await page.getByRole('heading', { name: 'Shelf', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/shelf');
  await page.goto(`${origin}/board?new=note`);
  await page.locator('.tl-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/board');
  await page.goto(`${origin}/pen-test`);
  await page.getByTestId('pen-test-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/pen-test');
  console.log('PASS reloading or opening a page directly shows that page');

  // Stand in for the native side: Capacitor sees an Android bridge and the app's plugins' headers.
  // Files go through Android's Save dialog (SaveFilePlugin), not a blob: download; API keys are
  // kept by DeviceKeysPlugin.
  const app = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
  app.on('pageerror', (error) => errors.push(error.message));
  await app.addInitScript(() => {
    window.saves = [];
    window.saveAnswers = [];
    window.deviceKeys = {};
    // A ChatGPT-plan choice saved by an earlier app, which the tablet app doesn't offer yet.
    if (!localStorage.getItem('mathTutor_modelConfig')) localStorage.setItem('mathTutor_modelConfig', JSON.stringify({ provider: 'chatgpt', model: 'sol', baseUrl: '' }));
    window.androidBridge = { postMessage() {} };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'SaveFile', methods: [{ name: 'save', rtype: 'promise' }] },
        { name: 'DeviceKeys', methods: ['get', 'set', 'remove'].map((name) => ({ name, rtype: 'promise' })) },
      ],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'DeviceKeys') {
          if (method === 'set') window.deviceKeys[options.name] = options.value;
          if (method === 'remove') delete window.deviceKeys[options.name];
          return method === 'get' && window.deviceKeys[options.name] ? { value: window.deviceKeys[options.name] } : {};
        }
        window.saves.push({ plugin, method, ...options });
        return { saved: window.saveAnswers.shift() ?? true };
      },
    };
  });
  await app.goto(`${origin}/board`);
  await app.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 7');
  await app.locator('.tl-canvas').waitFor();
  const board = await app.locator('.tl-canvas').boundingBox();
  await app.mouse.move(board.x + 120, board.y + 120);
  await app.mouse.down();
  await app.mouse.move(board.x + 300, board.y + 200, { steps: 8 });
  await app.mouse.up();
  await app.getByText('Saved', { exact: true }).waitFor();

  // The tutor: with no server, the app calls the provider itself with the key pasted into Settings.
  const providerCalls = [];
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const sseFrames = (events) => events.map(([event, data]) => `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`).join('');
  await app.route('https://api.anthropic.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    providerCalls.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    await route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: sseFrames([
      ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'What could you subtract ' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'from both sides?' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
      ['message_stop', { type: 'message_stop' }],
    ]) });
  });
  await app.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    providerCalls.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    await route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: sseFrames([
      ['', { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gemini-3.8-flash', choices: [{ index: 0, delta: { role: 'assistant', content: 'Look at the constant term.' }, finish_reason: null }] }],
      ['', { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gemini-3.8-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }],
      ['', '[DONE]'],
    ]) });
  });
  const askTutor = async () => {
    await app.waitForTimeout(5100); // The five-second spacing between tutor requests.
    await app.getByRole('button', { name: 'Ask tutor', exact: true }).click();
    await app.getByRole('menuitem').first().click();
  };
  await askTutor();
  await app.getByText("Sign in with ChatGPT isn't in the tablet app yet. Pick another provider in Settings → Tutor.").waitFor();
  const openTutorSettings = async () => {
    await app.getByRole('button', { name: 'Settings' }).click();
    await app.getByRole('tab', { name: 'Tutor' }).click();
  };
  await openTutorSettings();
  assert.equal(await app.locator('option', { hasText: 'ChatGPT' }).count(), 0);
  assert.equal(await app.getByRole('dialog', { name: 'Settings' }).getByRole('combobox').first().inputValue(), '0'); // Anthropic
  await app.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
  await askTutor();
  await app.getByText('Add your Anthropic API key in Settings → Tutor.').waitFor();
  assert.equal(providerCalls.length, 0);

  await openTutorSettings();
  await app.getByLabel('Anthropic API key').fill('sk-ant-test-key');
  await app.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
  assert.deepEqual(await app.evaluate(() => window.deviceKeys), { anthropic: 'sk-ant-test-key' });
  assert.ok(!(await app.evaluate(() => JSON.stringify({ ...localStorage }))).includes('sk-ant-test-key'));
  await askTutor();
  await app.getByText('What could you subtract from both sides?').waitFor();
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].headers['x-api-key'], 'sk-ant-test-key');
  assert.match(providerCalls[0].body.system, /The answer is theirs to find/);
  assert.equal(providerCalls[0].body.stream, true);
  assert.ok(providerCalls[0].body.messages.at(-1).content.some((part) => part.type === 'image'));

  // Another provider has its own key; the saved Anthropic one stays, shown as saved, never as text.
  await openTutorSettings();
  assert.equal(await app.getByLabel('Anthropic API key').inputValue(), '');
  assert.match(await app.getByLabel('Anthropic API key').getAttribute('placeholder'), /^Saved/);
  await app.getByRole('dialog', { name: 'Settings' }).getByRole('combobox').first().selectOption({ label: 'Google Gemini' });
  await app.getByLabel('Gemini API key').fill('gemini-test-key');
  await app.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
  await askTutor();
  await app.getByText('Look at the constant term.').waitFor();
  assert.equal(providerCalls[1].headers.authorization, 'Bearer gemini-test-key');
  assert.match(providerCalls[1].url, /\/v1beta\/openai\/chat\/completions$/);
  assert.deepEqual(await app.evaluate(() => window.deviceKeys), { anthropic: 'sk-ant-test-key', gemini: 'gemini-test-key' });
  console.log('PASS in the app, the tutor calls the provider directly with the key saved on the device');
  await app.getByRole('button', { name: 'Save board as' }).click();
  await app.getByRole('menuitem', { name: 'PNG picture' }).click();
  await app.waitForFunction(() => window.saves.length === 1);
  const png = await app.evaluate(() => window.saves[0]);
  assert.equal(png.plugin, 'SaveFile');
  assert.equal(png.name, 'Find x when 2x + 3 = 7.png');
  assert.equal(png.mimeType, 'image/png');
  assert.deepEqual([...Buffer.from(png.data, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);

  // A cancelled Save dialog is not a backup: the reminder stays until one is saved.
  await app.evaluate(() => window.saveAnswers.push(false));
  await app.getByRole('button', { name: 'Back up', exact: true }).click();
  await app.getByRole('button', { name: 'Download backup' }).click();
  await app.waitForFunction(() => window.saves.length === 2);
  assert.match((await app.evaluate(() => window.saves[1])).name, /^math-tutor-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  await app.waitForTimeout(300);
  assert.equal(await app.getByText(/Last downloaded/).count(), 0);
  await app.getByRole('button', { name: 'Download backup' }).click();
  await app.getByText(/Last downloaded just now/).waitFor();
  await app.getByRole('button', { name: 'Done' }).click();
  assert.equal(await app.getByRole('button', { name: 'Back up', exact: true }).count(), 0);
  console.log('PASS in the app, Save as and the backup go through the Save dialog; a cancelled one keeps the reminder');

  assert.deepEqual(errors, []);
  console.log('PASS no browser exceptions');
} finally {
  await browser.close();
  server.close();
}
