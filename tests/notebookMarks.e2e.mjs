import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// A problem marked in notes: the lasso's Mark problem names it (with a book), its tag shows above the
// work, its menu marks it solved, stars it, asks the tutor about it as a problem, renames and unmarks it;
// Home finds it by search and filter and opens its notebook at it.

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Mark reply.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const profile = await mkdtemp(join(tmpdir(), 'notebook-marks-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 820, height: 1180 },
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
async function saved(check) {
  for (let tries = 0; tries < 50; tries++) {
    const session = await page.evaluate(async (test) => {
      const id = localStorage.getItem('math-tutor:currentSession');
      if (!id) return null;
      const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
      const found = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
      db.close();
      return found && new Function('session', `return ${test}`)(found) ? { ...found, canvasImageBlob: null } : null;
    }, check);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No saved board where ${check}`);
}
const favorites = () => page.evaluate(() => new Promise((resolve) => {
  const open = indexedDB.open('math-tutor');
  open.onsuccess = () => {
    const get = open.result.transaction('settings').objectStore('settings').get('learnerProfile');
    get.onsuccess = () => { open.result.close(); resolve((get.result?.favorites ?? []).map((item) => item.id)); };
  };
}));
const tag = () => page.getByTestId('mark-tag');
const openTag = async () => { await tag().click(); await page.getByTestId('mark-menu').waitFor(); };

try {
  await page.goto(`${origin}/board?new=note`);
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);
  await waitAttr('pages', 1);
  // Two lines of work for the problem, and one more apart from it.
  await drag([[100, 200], [400, 210]]);
  await drag([[100, 260], [380, 270]]);
  await drag([[100, 600], [400, 610]]);
  await waitAttr('strokes', 3);

  // Lasso the problem's work; the menu offers Mark problem.
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await drag([[60, 160], [460, 160], [460, 310], [60, 310], [60, 160]]);
  await waitAttr('selected', 2);
  await page.getByTestId('selection-menu').getByRole('button', { name: 'Mark problem' }).click();
  const form = page.getByRole('form', { name: 'Mark as a problem' });
  await form.getByLabel('Name').fill('#55');
  await form.getByLabel('Book (optional)').fill('Stewart 4.2');
  await form.getByRole('button', { name: 'Mark', exact: true }).click();
  await waitAttr('selected', 0);
  assert.equal((await tag().textContent()).trim(), '#55 · Stewart 4.2');
  const marked = await saved('session.ink?.marks?.length === 1');
  const mark = marked.ink.marks[0];
  assert.equal(mark.label, '#55');
  assert.equal(mark.book, 'Stewart 4.2');
  assert.equal(mark.items.length, 2);
  // The tag sits above the work.
  const tagBox = await tag().boundingBox();
  const boardBox = await page.getByTestId('ink-board').boundingBox();
  assert.ok(tagBox.y - boardBox.y < 200 && tagBox.y + tagBox.height - boardBox.y <= 200, `the tag is above the work (${tagBox.y - boardBox.y})`);
  console.log('PASS the lasso marks a problem with a name and book; its tag shows above the work');

  // Moving the work moves its tag.
  await drag([[60, 160], [460, 160], [460, 310], [60, 310], [60, 160]]);
  await waitAttr('selected', 2);
  await drag([[200, 205], [200, 405]]);
  await page.waitForFunction((before) => {
    const box = document.querySelector('[data-testid="mark-tag"]')?.getBoundingClientRect();
    return box && box.y > before + 150;
  }, tagBox.y);
  await page.keyboard.press('Escape');
  console.log('PASS the tag follows its work when the lasso moves it');

  // Mark solved and Favorite from the tag's menu.
  await openTag();
  await page.getByRole('menuitem', { name: 'Mark solved' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mark-tag"]')?.textContent.includes('Solved'));
  await saved('session.ink?.marks?.[0]?.solved === true');
  await openTag();
  await page.getByRole('menuitemcheckbox', { name: 'Favorite' }).click();
  for (let tries = 0; tries < 50 && !(await favorites()).includes(`${marked.id}#${mark.id}`); tries++) await page.waitForTimeout(100);
  assert.ok((await favorites()).includes(`${marked.id}#${mark.id}`), 'the mark is starred in the tutor memory');
  console.log('PASS a mark is marked solved and starred from its tag');

  // Hint asks about the marked work alone, as a problem.
  await openTag();
  await page.getByRole('menuitem', { name: 'Hint' }).click();
  for (let tries = 0; tries < 100 && requests.length === 0; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, 1);
  const sent = JSON.stringify(requests[0].messages);
  assert.ok(sent.includes('#55 · Stewart 4.2'), 'the tutor is told the problem is the mark');
  assert.ok(!sent.includes('helping a student understand concepts'), 'asked as a problem, not with the notes prompt');
  const image = requests[0].messages.at(-1).content.find((part) => part.type === 'image_url').image_url.url.split(',')[1];
  const height = Buffer.from(image, 'base64').readUInt32BE(20);
  assert.ok(height < 300, `only the marked work is pictured (${height} px)`);
  await page.getByText('Mark reply.').waitFor();
  console.log('PASS Hint on a mark sends only its work, as a marked problem');

  // A follow-up stays on the marked problem: its work alone, asked as a problem.
  await page.waitForTimeout(5200);
  await page.getByPlaceholder('Ask your own question…').fill('What about the second line?');
  await page.getByPlaceholder('Ask your own question…').press('Enter');
  for (let tries = 0; tries < 100 && requests.length < 2; tries++) await page.waitForTimeout(100);
  assert.equal(requests.length, 2);
  const followUp = JSON.stringify(requests[1].messages);
  assert.ok(followUp.includes('#55 · Stewart 4.2') && !followUp.includes('helping a student understand concepts'), 'the follow-up is about the mark, as a problem');
  const followImage = requests[1].messages.at(-1).content.find((part) => part.type === 'image_url').image_url.url.split(',')[1];
  assert.ok(Buffer.from(followImage, 'base64').readUInt32BE(20) < 300, 'the follow-up pictures only the marked work');
  await page.getByText('Mark reply.').nth(1).waitFor();
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  console.log('PASS a follow-up keeps asking about the mark');

  // Home: browsing lists the notebook only; a search and the Solved filter find the mark, which opens the notebook at it.
  await saved('session.ink?.marks?.[0]?.solved === true');
  await page.goto(`${origin}/`);
  await page.getByRole('heading', { name: 'Problems and notes' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Open #55 · Stewart 4.2' }).count(), 0);
  await page.getByRole('searchbox').fill('stewart');
  await page.getByRole('button', { name: 'Open #55 · Stewart 4.2' }).waitFor();
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Solved', exact: true }).click();
  const card = page.getByRole('button', { name: 'Open #55 · Stewart 4.2' });
  await card.waitFor();
  assert.ok((await card.textContent()).includes('Solved'));
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await card.waitFor();
  // Rename on Home starts from the mark's own name, not its title with the book.
  await page.getByRole('button', { name: 'More for #55 · Stewart 4.2' }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Name' }).inputValue(), '#55');
  await page.getByRole('textbox', { name: 'Name' }).press('Enter');
  await card.waitFor();
  await card.click();
  await page.waitForURL(/\/board$/);
  await tag().waitFor();
  await page.waitForFunction(() => document.querySelector('[data-ink-board]') && !document.querySelector('[data-loading]'));
  console.log('PASS Home finds a mark by search, Solved and Favorites, and opens its notebook at it');

  // Rename from the tag, then unmark: the writing stays.
  await openTag();
  await page.getByRole('menuitem', { name: 'Rename…' }).click();
  const rename = page.getByRole('form', { name: 'Rename' });
  await rename.getByLabel('Name').fill('#56');
  await rename.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelector('[data-testid="mark-tag"]')?.textContent.includes('#56 · Stewart 4.2'));
  await openTag();
  await page.getByRole('menuitem', { name: /Unmark/ }).click();
  await tag().waitFor({ state: 'detached' });
  await waitAttr('strokes', 3);
  await saved('!session.ink?.marks && session.ink.strokes.length === 3');
  // Undo brings the mark back.
  await page.keyboard.press('ControlOrMeta+z');
  await tag().waitFor();
  console.log('PASS a mark is renamed and unmarked from its tag, and undo brings it back');

  // Problem boards have no Mark problem.
  await page.goto(`${origin}/board?new=problem`);
  await page.getByPlaceholder("Type the math problem you're working on...").waitFor();
  await page.waitForFunction(() => document.querySelector('[data-ink-board]')?.getAttribute('data-strokes') === '0' && !document.querySelector('[data-loading]'));
  await drag([[100, 200], [400, 210]]);
  await waitAttr('strokes', 1);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await drag([[60, 160], [460, 160], [460, 260], [60, 260], [60, 160]]);
  await waitAttr('selected', 1);
  assert.equal(await page.getByTestId('selection-menu').getByRole('button', { name: 'Mark problem' }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS problem boards have no Mark problem; no browser exceptions');
} finally {
  await context.close();
  provider.close();
}
