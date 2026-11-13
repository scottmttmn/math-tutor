import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Quiet checks: marking a problem solved has the tutor read its work once in the background; the
// verdict shows only on Home (the card and the Second look filter), never on the board or in the chat.
// A marked problem in notes is read alone; the tutor memory's switch turns it off, and reads
// problems solved meanwhile on request.

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
let slowQuiet = false;
let quietReply = 'Result: look\nWhere: the second line';
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  requests.push(body);
  const quiet = raw.includes('I marked this problem solved');
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  // A slow quiet read, for a question asked while it runs; the connection closing ends it.
  if (quiet && slowQuiet) {
    res.write(': waiting\n\n');
    await new Promise((resolve) => { const timer = setTimeout(resolve, 20_000); req.on('close', () => { clearTimeout(timer); resolve(); }); res.on('close', () => { clearTimeout(timer); resolve(); }); });
    if (res.destroyed || res.writableEnded) return;
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: quiet ? quietReply : 'A hint.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const profile = await mkdtemp(join(tmpdir(), 'quiet-check-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 1280, height: 1000 },
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = context.pages()[0] || await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const waitAttr = (name, value) => page.waitForFunction(([key, expected]) => document.querySelector('[data-ink-board]')?.getAttribute(`data-${key}`) === String(expected), [name, value]);
async function drag(points) {
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 10 });
  await page.mouse.up();
}
async function waitRequests(n) {
  for (let tries = 0; tries < 400 && requests.length < n; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, n);
}
const savedChecks = () => page.evaluate(async () => {
  const id = localStorage.getItem('math-tutor:currentSession');
  const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
  const found = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
  db.close();
  return found?.quietChecks ?? null;
});
async function waitCheck(key) {
  for (let tries = 0; tries < 100; tries++) {
    const checks = await savedChecks();
    if (checks?.[key]) return checks[key];
    await page.waitForTimeout(100);
  }
  throw new Error(`No quiet check saved for ${key}`);
}

try {
  await page.goto(`${origin}/board?new=problem`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Solve x^2 - 5x + 6 = 0');
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  await drag([[100, 200], [400, 210]]);
  await drag([[100, 260], [380, 270]]);
  await waitAttr('strokes', 2);
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();

  await page.getByRole('button', { name: 'Mark solved' }).click();
  await waitRequests(1);
  const sent = JSON.stringify(requests[0].messages);
  assert.ok(sent.includes('quietly read') && sent.includes('Solve x^2 - 5x + 6 = 0'), 'the tutor reads the problem and the work quietly');
  const check = await waitCheck('board');
  assert.equal(check.result, 'look');
  assert.equal(check.where, 'the second line');
  // Nothing on the board: no tutor, no chat, no words of the verdict.
  assert.equal(await page.getByText('the second line').count(), 0);
  assert.equal(await page.getByText('Take another look').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Ask tutor', exact: true }).getAttribute('aria-pressed'), 'false');
  // Not solved and solved again with the same work: not read twice.
  await page.getByRole('button', { name: 'Solved' }).click();
  await page.getByRole('button', { name: 'Mark solved' }).click();
  await page.waitForTimeout(1500);
  assert.equal(requests.length, 1);
  console.log('PASS Mark solved reads the work once, quietly, with nothing shown on the board');

  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  await page.getByRole('button', { name: 'Second look', exact: true }).click();
  const card = page.getByRole('listitem').filter({ hasText: 'Take another look' });
  await card.waitFor();
  assert.ok((await card.textContent()).includes('Take another look: the second line'));
  console.log('PASS Home shows the verdict on the card and lists it under Second look');

  // A marked problem in notes: its work alone.
  await page.goto(`${origin}/board?new=note`);
  await waitAttr('pages', 1);
  await drag([[100, 200], [400, 210]]);
  await drag([[100, 600], [400, 610]]);
  await waitAttr('strokes', 2);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await drag([[60, 160], [460, 160], [460, 260], [60, 260], [60, 160]]);
  await waitAttr('selected', 1);
  await page.getByTestId('selection-menu').getByRole('button', { name: 'Mark problem' }).click();
  await page.getByRole('form', { name: 'Mark as a problem' }).getByLabel('Name').fill('#7');
  await page.getByRole('form', { name: 'Mark as a problem' }).getByRole('button', { name: 'Mark', exact: true }).click();
  await page.getByTestId('mark-tag').waitFor();
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await page.getByTestId('mark-tag').click();
  await page.getByRole('menuitem', { name: 'Mark solved' }).click();
  // It waits until the tutor has been idle a while (20 s after the last read).
  await waitRequests(2);
  assert.ok(JSON.stringify(requests[1].messages).includes('#7'), 'the marked problem is named');
  const image = requests[1].messages.at(-1).content.find((part) => part.type === 'image_url').image_url.url.split(',')[1];
  assert.ok(Buffer.from(image, 'base64').readUInt32BE(20) < 300, 'only the marked work is read');
  for (let tries = 0; tries < 100 && !Object.keys(await savedChecks() ?? {}).length; tries++) await page.waitForTimeout(100);
  assert.equal(Object.keys(await savedChecks()).length, 1);
  console.log('PASS a marked problem marked solved is read alone');

  // Off in the tutor memory: nothing is read.
  await page.goto(`${origin}/memory`);
  const toggle = page.getByRole('checkbox', { name: /Read my work when I mark a problem solved/ });
  await toggle.uncheck();
  await page.waitForTimeout(1500);
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Another one');
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  await drag([[100, 200], [400, 210]]);
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mark solved' }).click();
  await page.waitForTimeout(2000);
  assert.equal(requests.length, 2);
  console.log('PASS the tutor memory turns quiet checks off');

  // Back on, the problem solved meanwhile can be read from the tutor memory.
  await page.goto(`${origin}/memory`);
  await page.getByRole('checkbox', { name: /Read my work when I mark a problem solved/ }).check();
  await page.getByTestId('unread-solved').getByText('1 solved problem not read yet').waitFor();
  await page.getByRole('button', { name: 'Read them' }).click();
  await page.getByText('Read 1. See Second look on Home.').waitFor({ timeout: 20_000 });
  assert.equal(requests.length, 3);
  assert.ok(JSON.stringify(requests[2].messages).includes('Another one'), 'the solved problem is read');
  assert.equal(await page.getByRole('button', { name: 'Read them' }).count(), 0);
  console.log('PASS solved problems not read yet are read on request');

  // Marked solved offline: nothing is sent; back online, it is read quietly once the tutor is idle.
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Offline one');
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  await drag([[100, 200], [400, 210]]);
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Mark solved' }).click();
  await page.waitForTimeout(2000);
  assert.equal(requests.length, 3, 'nothing is sent offline');
  await context.setOffline(false);
  for (let tries = 0; tries < 450 && requests.length < 4; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, 4, 'read once back online');
  assert.ok(JSON.stringify(requests[3].messages).includes('Offline one'));
  assert.equal((await waitCheck('board')).result, 'look');
  console.log('PASS a problem marked solved offline is read once back online');

  // A question asked while a quiet read runs goes first: the read is cancelled and done later.
  slowQuiet = true;
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Interrupted one');
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  await drag([[100, 200], [400, 210]]);
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Mark solved' }).click();
  for (let tries = 0; tries < 450 && requests.length < 5; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, 5, 'the quiet read started');
  await page.waitForTimeout(5200);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  await page.getByText('A hint.').waitFor({ timeout: 15_000 });
  assert.equal(requests.length, 6);
  assert.equal(await savedChecks(), null, 'the cancelled read saved nothing');
  slowQuiet = false;
  for (let tries = 0; tries < 450 && requests.length < 7; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, 7, 'read again once the tutor was idle');
  assert.equal((await waitCheck('board')).result, 'look');
  console.log('PASS a question goes before a quiet read, which is read again later');

  // Check again on Home: unchanged work isn't sent; corrected work is read once more, on request only.
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  await page.getByRole('button', { name: 'Second look', exact: true }).click();
  let flagged = page.getByRole('listitem').filter({ hasText: 'Interrupted one' });
  await flagged.getByRole('button', { name: 'Check again' }).click();
  await flagged.getByText('Nothing has changed since the tutor read it.').waitFor();
  assert.equal(requests.length, 7, 'unchanged work is not read again');
  // Corrected: nothing is read until asked.
  await page.goto(`${origin}/board`);
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  await waitAttr('strokes', 1);
  await drag([[100, 300], [400, 310]]);
  await waitAttr('strokes', 2);
  await page.getByRole('status').getByText('Saved', { exact: true }).waitFor();
  await page.waitForTimeout(1500);
  assert.equal(requests.length, 7, 'a correction alone sends nothing');
  quietReply = 'Result: right';
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  await page.getByRole('button', { name: 'Second look', exact: true }).click();
  flagged = page.getByRole('listitem').filter({ hasText: 'Interrupted one' });
  await flagged.getByRole('button', { name: 'Check again' }).click();
  await flagged.waitFor({ state: 'detached', timeout: 20_000 });
  assert.equal(requests.length, 8, 'read once more');
  await page.getByRole('button', { name: 'Solved', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: 'Interrupted one' }).getByText('Tutor agrees').waitFor();
  assert.deepEqual(errors, []);
  console.log('PASS Check again reads corrected work once more and leaves unchanged work alone; no browser exceptions');
} finally {
  await context.close();
  provider.close();
}
