import { chooseTutor } from './tutor-ui.mjs';
// The Android app's bundle (out/, from `npm run build:android`) served the way the app serves it:
// Capacitor answers every path without an extension with index.html (Home), other paths with the file.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
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
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.getByRole('link', { name: /Tell the tutor what you know/ }).click();
  await page.getByRole('heading', { name: 'Tutor memory', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/memory');
  console.log('PASS Home opens and links work inside the bundle');

  // A full load of a page other than Home (a reload) shows that page, under its own address.
  await page.reload();
  await page.getByRole('heading', { name: 'Tutor memory', exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/memory');
  await page.goto(`${origin}/board?new=note`);
  await page.locator('.tl-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/board');
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).click();
  await page.getByTestId('notebook-paper').waitFor();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  assert.equal(await page.getByTestId('notebook-paper').getAttribute('data-page-width'), '960');
  await page.reload();
  await page.getByTestId('notebook-paper').waitFor();
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).click();
  await page.getByTestId('notebook-paper').waitFor({ state: 'detached' });
  // The app has no address bar: the pen test is reached from the Board menu.
  await page.getByRole('button', { name: 'Board menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Pen test…', exact: true }).click();
  await page.getByTestId('pen-test-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/pen-test');
  // ← Board goes back to the board it came from.
  await page.getByRole('button', { name: '← Board', exact: true }).click();
  await page.locator('.tl-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/board');
  await page.goto(`${origin}/pen-test`);
  await page.getByTestId('pen-test-canvas').waitFor();
  assert.equal(new URL(page.url()).pathname, '/pen-test');
  // A book's page keeps its query through the redirect to book.html.
  await page.goto(`${origin}/book?doc=missing`);
  await page.getByText('This text isn’t in your library.', { exact: false }).waitFor();
  assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, '/book?doc=missing');
  console.log('PASS reloading or opening a page directly shows that page');

  // Stand in for the native side: Capacitor sees an Android bridge and the app's plugins' headers.
  // Files go through Android's Save dialog (SaveFilePlugin), not a blob: download; API keys and
  // the ChatGPT connection are kept by DeviceKeysPlugin; Sign in with ChatGPT's callback comes to
  // ChatGPTSignInPlugin's listener, and its requests to auth.openai.com go through CapacitorHttp.
  const app = await browser.newPage({ viewport: { width: 1024, height: 1366 } });
  app.on('pageerror', (error) => errors.push(error.message));
  const issuer = 'https://auth.openai.com';
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const auth = { requests: [], nonce: undefined };
  await app.exposeFunction('openedForSignIn', (url) => { auth.authorization = new URL(url); auth.nonce = auth.authorization.searchParams.get('nonce'); });
  await app.exposeFunction('authServer', async ({ url, method, headers, data }) => {
    auth.requests.push({ url, method, headers, data });
    const json = (body) => ({ status: 200, headers: { 'Content-Type': 'application/json' }, data: JSON.stringify(body) });
    if (url === `${issuer}/.well-known/openid-configuration`) {
      return json({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/oauth/token`, revocation_endpoint: `${issuer}/oauth/revoke`, jwks_uri: `${issuer}/jwks` });
    }
    if (url === `${issuer}/jwks`) return json({ keys: [jwk] });
    if (url === `${issuer}/oauth/token`) {
      const idToken = await new SignJWT({ email: 'learner@example.com', nonce: auth.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer).setAudience('client-123').setSubject('user-1').setIssuedAt().setExpirationTime('1h').sign(privateKey);
      return json({ access_token: 'chatgpt-access-1', refresh_token: 'chatgpt-refresh-1', token_type: 'Bearer', expires_in: 3600,
        scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', id_token: idToken });
    }
    return { status: 404, headers: {}, data: '' };
  });
  await app.addInitScript(() => {
    window.saves = [];
    window.saveAnswers = [];
    window.deviceKeys = {};
    // The student picked the ChatGPT plan but hasn't signed in on the tablet yet.
    if (!localStorage.getItem('mathTutor_modelConfig')) localStorage.setItem('mathTutor_modelConfig', JSON.stringify({ provider: 'chatgpt', model: 'gpt-6.1-sol', baseUrl: '' }));
    let callback;
    window.androidBridge = { postMessage() {} };
    window.Capacitor = {
      PluginHeaders: [
        { name: 'SaveFile', methods: [{ name: 'save', rtype: 'promise' }] },
        { name: 'DeviceKeys', methods: ['get', 'set', 'remove'].map((name) => ({ name, rtype: 'promise' })) },
        { name: 'ChatGPTSignIn', methods: ['listen', 'waitForCallback', 'close', 'openBrowser'].map((name) => ({ name, rtype: 'promise' })) },
        { name: 'CapacitorHttp', methods: [{ name: 'request', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin, method, options) => {
        if (plugin === 'CapacitorHttp') return window.authServer(options);
        if (plugin === 'ChatGPTSignIn') {
          if (method === 'listen') {
            callback = { state: options.state };
            callback.done = new Promise((resolve) => { callback.resolve = resolve; });
            return { redirectUri: `http://127.0.0.1:${options.port}/auth/callback` };
          }
          if (method === 'waitForCallback') return callback.done;
          if (method === 'openBrowser') {
            // The student signs in, and the browser comes back to the listener with the code.
            await window.openedForSignIn(options.url);
            callback.resolve({ query: new URLSearchParams({ code: 'code-1', state: callback.state, client_id: 'client-123' }).toString() });
          }
          return {};
        }
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
      ['', { choices: [], usage: { prompt_tokens: 200, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 10 } } }],
      ['', '[DONE]'],
    ]) });
  });
  const askTutor = async () => {
    await app.waitForTimeout(5100); // The five-second spacing between tutor requests.
    await chooseTutor(app);
  };
  const openaiCalls = [];
  await app.route('https://api.openai.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
    openaiCalls.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    if (request.url().endsWith('/v1/models')) {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol', visibility: 'list' }] }) });
    }
    await route.fulfill({ status: 200, headers: { ...cors, 'Content-Type': 'text/event-stream' }, body: sseFrames([
      ['', { type: 'response.output_text.delta', delta: 'What is 2x on its own?' }],
      ['', { type: 'response.completed', response: { usage: { input_tokens: 120, output_tokens: 9, input_tokens_details: { cached_tokens: 80 } } } }],
    ]) });
  });
  await askTutor();
  await app.getByText('Sign in with ChatGPT to continue.').waitFor();
  const openTutorSettings = async () => {
    await app.getByRole('button', { name: 'Settings' }).click();
    await app.getByRole('tab', { name: 'Tutor' }).click();
  };
  const settings = app.getByRole('dialog', { name: 'Settings' });
  await openTutorSettings();
  await settings.getByRole('button', { name: 'Sign in with ChatGPT' }).click();
  await settings.getByText('Signed in as learner@example.com.').waitFor();
  const authorization = auth.authorization.searchParams;
  assert.equal(authorization.get('redirect_uri'), 'http://127.0.0.1:8791/auth/callback');
  assert.equal(authorization.get('code_challenge_method'), 'S256');
  const exchange = new URLSearchParams(auth.requests.find((request) => request.url.endsWith('/oauth/token')).data);
  assert.equal(exchange.get('code'), 'code-1');
  assert.equal(exchange.get('client_id'), 'client-123');
  // The connection is kept by DeviceKeys (encrypted there), never in the page's own storage.
  assert.match(await app.evaluate(() => window.deviceKeys.chatgpt), /chatgpt-access-1/);
  assert.ok(!(await app.evaluate(() => JSON.stringify({ ...localStorage }))).includes('chatgpt-access-1'));
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await askTutor();
  await app.getByText('What is 2x on its own?').waitFor();
  await app.getByText('120 input · 9 output', { exact: true }).waitFor();
  await app.getByText('Input includes 80 cached tokens', { exact: true }).waitFor();
  await app.getByRole('link', { name: 'Manage ChatGPT usage' }).waitFor();
  const reply = openaiCalls.find((call) => call.url.endsWith('/v1/responses'));
  assert.equal(reply.headers.authorization, 'Bearer chatgpt-access-1');
  assert.equal(reply.body.model, 'gpt-6.1-sol');
  assert.match(reply.body.instructions, /The answer is theirs to find/);
  assert.ok(reply.body.input[0].content.some((part) => part.type === 'input_image'));
  assert.equal(reply.body.prompt_cache_options, undefined);
  assert.doesNotMatch(JSON.stringify(reply.body.input), /prompt_cache_breakpoint/);
  await askTutor();
  await app.getByText('What is 2x on its own?').nth(1).waitFor();
  const repeated = openaiCalls.filter((call) => call.url.endsWith('/v1/responses'))[1];
  assert.deepEqual(repeated.body.input[0], reply.body.input[0], 'the same board remains a reusable prefix before the growing history');
  assert.ok(repeated.body.input.length > reply.body.input.length);
  console.log('PASS in the app, Sign in with ChatGPT comes back to the tablet and the tutor answers on the plan');

  await openTutorSettings();
  await settings.getByRole('combobox').first().selectOption({ label: 'Anthropic (Claude)' });
  await settings.getByRole('button', { name: 'Save', exact: true }).click();
  await askTutor();
  await app.getByText('Add your Anthropic API key in Settings → Tutor.').waitFor();
  assert.equal(providerCalls.length, 0);

  await openTutorSettings();
  await app.getByLabel('Anthropic API key').fill('sk-ant-test-key');
  await app.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await app.evaluate(() => window.deviceKeys.anthropic), 'sk-ant-test-key');
  assert.ok(!(await app.evaluate(() => JSON.stringify({ ...localStorage }))).includes('sk-ant-test-key'));
  await askTutor();
  await app.getByText('What could you subtract from both sides?').waitFor();
  await app.getByText('10 input · 8 output', { exact: true }).waitFor();
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
  await app.getByText('200 input · 30 output (including 10 reasoning)', { exact: true }).waitFor();
  assert.equal(providerCalls[1].headers.authorization, 'Bearer gemini-test-key');
  assert.match(providerCalls[1].url, /\/v1beta\/openai\/chat\/completions$/);
  assert.deepEqual(await app.evaluate(() => Object.keys(window.deviceKeys).sort()), ['anthropic', 'chatgpt', 'gemini']);
  console.log('PASS in the app, the tutor calls the provider directly with the key saved on the device');
  await app.getByRole('button', { name: 'Board menu' }).click();
  await app.getByRole('menuitem', { name: 'Save as PNG' }).click();
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
