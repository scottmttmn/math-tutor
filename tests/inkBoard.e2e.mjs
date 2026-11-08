import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { chooseTutor, openTutor } from './tutor-ui.mjs';
import { encodePoints } from './tldraw-points.mjs';

// The board: writing, erasing, undo, saving and reloading, paper, the tutor's picture, Save as,
// Put on board and Clear; and a board tldraw saved, converted as it opens.

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const requests = [];
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  requests.push(JSON.parse(raw));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Ink hint.' } }] })}\n\n`);
  res.end('data: [DONE]\n\n');
});
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
const model = { provider: 'openai-compatible', model: 'acceptance-test', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` };
const profile = await mkdtemp(join(tmpdir(), 'ink-board-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true, viewport: { width: 1440, height: 960 }, acceptDownloads: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
});
const page = context.pages()[0] || await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const problemBox = () => page.getByPlaceholder("Type the math problem you're working on...");
const ink = () => page.locator('[data-ink-board]');
const count = async (what) => Number(await ink().getAttribute(`data-${what}`));
const waitCount = (what, value) => page.waitForFunction(([name, expected]) => document.querySelector('[data-ink-board]')?.getAttribute(`data-${name}`) === String(expected), [what, value]);
const boardMenu = async (item) => {
  await page.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: item }).or(page.getByRole('menuitem', { name: item })).click();
};
async function stroke(x0, y0, x1, y1) {
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
  await page.mouse.up();
}
/** The open board as saved in IndexedDB, once the autosave has written `check` true of it. */
async function saved(check) {
  for (let tries = 0; tries < 50; tries++) {
    const session = await page.evaluate(async (test) => {
      const id = localStorage.getItem('math-tutor:currentSession');
      if (!id) return null;
      const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
      const found = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
      db.close();
      // A Blob doesn't come back to the test; say whether there is one.
      return found && new Function('session', `return ${test}`)(found) ? { ...found, canvasImageBlob: Boolean(found.canvasImageBlob) } : null;
    }, check);
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No saved board where ${check}`);
}

try {
  await page.goto(`${origin}/board`);
  await problemBox().waitFor();
  await page.evaluate((config) => localStorage.setItem('mathTutor_modelConfig', JSON.stringify(config)), model);

  // A board saved by tldraw opens converted: its ink, not its rectangle. Nothing is written until it changes.
  const shape = (id, type, rest) => [id, { id, typeName: 'shape', type, x: 0, y: 0, rotation: 0, index: 'a1', parentId: 'page:page', isLocked: false, opacity: 1, meta: {}, ...rest }];
  const tldrawBoard = {
    id: 'tldraw-board', title: 'Saved by tldraw', problemStatement: 'Saved by tldraw', problemImage: null, canvasStrokes: [], canvasImageBlob: null,
    chatHistory: [], createdAt: 1, updatedAt: 1, sessionType: 'problem',
    canvasDocument: { schema: {}, store: Object.fromEntries([
      ['page:page', { id: 'page:page', typeName: 'page', name: 'Page 1', index: 'a1', meta: {} }],
      shape('shape:line', 'draw', { x: 200, y: 200, props: { color: 'black', fill: 'none', dash: 'solid', size: 's', isComplete: true, isClosed: false, isPen: false, scale: 1, scaleX: 1, scaleY: 1,
        segments: [{ type: 'free', path: encodePoints([{ x: 0, y: 0 }, { x: 70, y: 40 }, { x: 140, y: 80 }]), dim: 3 }] } }),
      shape('shape:box', 'geo', { x: 400, y: 400, index: 'a2', props: { geo: 'rectangle', w: 100, h: 100 } }),
    ]) },
  };
  await page.evaluate(async (session) => {
    const db = await new Promise((resolve, reject) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); open.onerror = reject; });
    await new Promise((resolve, reject) => { const tx = db.transaction('sessions', 'readwrite'); tx.objectStore('sessions').put(session); tx.oncomplete = resolve; tx.onerror = reject; });
    db.close();
    localStorage.setItem('math-tutor:currentSession', session.id);
  }, tldrawBoard);
  await page.reload();
  await waitCount('strokes', 1);
  assert.equal(await problemBox().inputValue(), 'Saved by tldraw');
  await page.waitForTimeout(1200);
  const untouchedOld = await saved("session.id === 'tldraw-board'");
  assert.ok(untouchedOld.canvasDocument && !untouchedOld.ink, 'opening it writes nothing');
  await stroke(100, 500, 300, 500);
  const convertedSave = await saved("session.id === 'tldraw-board' && session.ink?.strokes?.length === 2");
  assert.equal(convertedSave.canvasDocument, null);
  const [line] = convertedSave.ink.strokes;
  assert.deepEqual([line.width, line.color, line.points.slice(0, 2), line.points.slice(-3, -1)], [3, 'black', [200, 200], [340, 280]]);
  console.log('PASS a board saved by tldraw opens converted, without its rectangle, and is saved as ink once it changes');

  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Problem' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-loading]') && document.querySelector('[data-ink-board]')?.getAttribute('data-strokes') === '0');

  // Writing, the highlighter, erasing and undo.
  await problemBox().fill('Ink board check.');
  await stroke(100, 200, 400, 230);
  await stroke(100, 300, 400, 330);
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await stroke(100, 420, 400, 420);
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await stroke(250, 280, 250, 350);
  await waitCount('strokes', 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitCount('strokes', 2);
  await page.keyboard.press('ControlOrMeta+z');
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  console.log('PASS pen, highlighter, eraser (between samples), undo, redo and Ctrl+Z');

  // Scratch out to erase: a scribble over a word takes the word, one undo step; over empty paper,
  // or with the choice off, it is ink.
  const scribble = async (x, y, width) => {
    const box = await page.getByTestId('ink-board').boundingBox();
    await page.mouse.move(box.x + x, box.y + y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(box.x + x + (i % 2 ? width : 0), box.y + y + i * 3, { steps: 10 });
    await page.mouse.up();
  };
  await stroke(120, 520, 150, 540);
  await stroke(160, 540, 190, 515);
  await waitCount('strokes', 5);
  await scribble(110, 515, 100);
  await waitCount('strokes', 3);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('strokes', 5);
  await scribble(600, 515, 100);
  await waitCount('strokes', 6);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('strokes', 5);
  await boardMenu('Scratch out to erase');
  await scribble(110, 515, 100);
  await waitCount('strokes', 6);
  await boardMenu('Scratch out to erase');
  for (let i = 0; i < 3; i += 1) await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('strokes', 3);
  console.log('PASS a scribble over writing scratches it out, one undo step; over empty paper or turned off it is ink');

  // Saved as ink (no tldraw document), and back after a reload.
  const session = await saved('session.ink?.strokes?.length === 3');
  assert.equal(session.canvasDocument, null);
  assert.deepEqual(session.ink.strokes.map((s) => s.tool), ['pen', 'pen', 'highlighter']);
  assert.ok(session.canvasImageBlob, 'Home gets a thumbnail');
  await page.reload();
  await ink().waitFor();
  await waitCount('strokes', 3);
  assert.equal(await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true, 'undo starts fresh on a reopened board');
  console.log('PASS the board saves as ink with a thumbnail and reopens as an ink board');

  // The lasso: circle a line, drag it, duplicate and delete; the tutor reads only the selection.
  const lasso = async (points) => {
    const area = await page.getByTestId('ink-board').boundingBox();
    await page.mouse.move(area.x + points[0][0], area.y + points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(area.x + x, area.y + y, { steps: 8 });
    await page.mouse.up();
  };
  // Each stroke's top, to see which one moved.
  const tops = (board) => board.strokes.map((s) => Math.min(...s.points.filter((_, i) => i % 3 === 1)));
  const startTops = tops((await saved('session.ink?.strokes?.length === 3')).ink);
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await lasso([[70, 170], [430, 170], [430, 260], [70, 260], [70, 170]]);
  await waitCount('selected', 1);
  await openTutor(page);
  const asked = requests.length;
  await chooseTutor(page);
  while (requests.length === asked) await new Promise((resolve) => setTimeout(resolve, 50));
  await page.getByText('Ink hint.', { exact: true }).last().waitFor();
  const selectedPng = Buffer.from(requests.at(-1).messages.at(-1).content.find((part) => part.type === 'image_url').image_url.url.split(',')[1], 'base64');
  assert.ok(selectedPng.readUInt32BE(20) < 260, `the tutor reads the selected line alone (${selectedPng.readUInt32BE(16)} × ${selectedPng.readUInt32BE(20)})`);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  await stroke(250, 215, 250, 275);
  const moved = await saved(`session.ink?.strokes?.length === 3 && session.ink.strokes.some((s, n) => Math.min(...s.points.filter((_, i) => i % 3 === 1)) > ${JSON.stringify(startTops)}[n] + 40)`);
  const shifts = tops(moved.ink).map((top, n) => top - startTops[n]);
  assert.equal(shifts.filter((shift) => shift > 40 && shift < 80).length, 1, `one line moved by the drag (${shifts})`);
  assert.equal(shifts.filter((shift) => shift === 0).length, 2, 'the others stayed');
  assert.equal(await count('selected'), 1, 'the moved ink stays selected');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await waitCount('strokes', 4);
  assert.equal(await count('selected'), 1, 'the copy is selected');
  await page.keyboard.press('Delete');
  await waitCount('strokes', 3);
  await waitCount('selected', 0);
  await page.keyboard.press('ControlOrMeta+z');
  await waitCount('strokes', 4);
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await waitCount('strokes', 3);
  await saved(`session.ink?.strokes?.length === 3 && session.ink.strokes.every((s, n) => Math.min(...s.points.filter((_, i) => i % 3 === 1)) === ${JSON.stringify(startTops)}[n])`);
  await lasso([[70, 170], [430, 170], [430, 260], [70, 260], [70, 170]]);
  await waitCount('selected', 1);
  await page.keyboard.press('Escape');
  await waitCount('selected', 0);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  console.log('PASS the lasso selects, moves, duplicates and deletes, one undo step each; the tutor reads the selection');

  // Paper, zoom and Fit width.
  await page.getByRole('button', { name: 'Paper: Blank' }).click();
  await page.getByRole('menuitemradio', { name: 'Lined' }).click();
  await saved("session.paper === 'lined'");
  const box = await page.getByTestId('ink-board').boundingBox();
  await page.mouse.move(box.x + 300, box.y + 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForFunction(() => Number(document.querySelector('[data-ink-board]').getAttribute('data-zoom')) > 1.2);
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-ink-board]').getAttribute('data-zoom') === '1');
  console.log('PASS lined paper is kept; Ctrl+wheel zooms and Fit width returns to writing scale');

  // The tutor gets a picture of the writing.
  await openTutor(page);
  const before = requests.length;
  await chooseTutor(page);
  while (requests.length === before) await new Promise((resolve) => setTimeout(resolve, 50));
  await page.getByText('Ink hint.', { exact: true }).last().waitFor();
  const content = requests.at(-1).messages.at(-1).content;
  const image = content.find((part) => part.type === 'image_url')?.image_url.url;
  assert.match(image, /^data:image\/png;base64,/);
  const png = Buffer.from(image.split(',')[1], 'base64');
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  // The writing spans about 300 by 220 screen px, about 270 by 200 board units at this width, sent at 2x with padding.
  assert.ok(width > 560 && width < 720 && height > 420 && height < 560, `tutor picture ${width} × ${height}`);
  await page.getByRole('button', { name: 'Ask tutor', exact: true }).click();
  console.log('PASS the tutor gets the writing, trimmed and at 2x');


  // Save as PNG.
  const [download] = await Promise.all([page.waitForEvent('download'), boardMenu('Save as PNG')]);
  const file = await readFile(await download.path());
  assert.equal(file.subarray(1, 4).toString(), 'PNG');
  console.log('PASS Save as PNG');

  // Put on board places the problem picture once, above the work; Clear leaves it.
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 160;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white'; context.fillRect(0, 0, 600, 160);
    context.fillStyle = 'black'; context.font = '48px serif'; context.fillText('Solve x + 2 = 5', 20, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Problem picture', { exact: true }).setInputFiles({ name: 'problem.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  await waitCount('images', 1);
  await page.getByRole('button', { name: 'Put on board', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(await count('images'), 1);
  const placed = await saved('session.ink?.images?.length === 1');
  const [problem] = placed.ink.images;
  assert.equal(problem.problem, true);
  assert.ok(problem.y + problem.h < Math.min(...placed.ink.strokes.flatMap((s) => s.points.filter((_, i) => i % 3 === 1))), 'the picture sits above the work');
  assert.ok(placed.ink.page.top <= problem.y, 'the page grows up to the picture');
  await page.getByRole('button', { name: 'Clear board' }).click();
  await waitCount('strokes', 0);
  assert.equal(await count('images'), 1);
  console.log('PASS Put on board places the picture once, above the work; Clear leaves it');

  // Board → Add picture… puts a picture below the work, chosen with the lasso: Delete takes it,
  // undo brings it back, and Clear takes it (only the problem picture is locked).
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000; canvas.height = 1500;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ddd'; context.fillRect(0, 0, 3000, 1500);
    context.fillStyle = 'black'; context.fillRect(200, 200, 800, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), boardMenu('Add picture…')]);
  await chooser.setFiles({ name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') });
  await waitCount('images', 2);
  assert.equal(await ink().getAttribute('data-selected'), '1', 'the new picture is chosen with the lasso');
  assert.equal(await page.getByRole('button', { name: 'Lasso', exact: true }).getAttribute('aria-pressed'), 'true');
  const withPicture = await saved('session.ink?.images?.length === 2');
  const added = withPicture.ink.images.find((item) => !item.problem);
  const own = withPicture.ink.images.find((item) => item.problem);
  assert.ok(added.y > own.y + own.h, 'the picture goes below the work');
  assert.ok(added.w <= withPicture.ink.page.width - 64 && Math.abs(added.w / added.h - 2) < 0.01, `picture ${added.w} × ${added.h}`);
  const stored = Buffer.from(added.src.split(',')[1], 'base64');
  assert.ok(stored.readUInt32BE(16) <= 1920, 'a large photo is stored at most 1920 px wide');
  // The selection's corner handle resizes it: dragged in by a quarter of its width plus height, half
  // the size, the same shape, one undo step, and still selected.
  // The handle's area (left to the page on a BOOX) is centered on the corner of the box, 8 px outside the picture.
  const handle = await page.getByTestId('resize-handle').boundingBox();
  const handleX = handle.x + handle.width / 2, handleY = handle.y + handle.height / 2;
  const boxArea = await page.locator('[data-ink-board] [data-pen-skip]').first().boundingBox();
  assert.ok(Math.abs(boxArea.x + boxArea.width - handleX) < 1 && Math.abs(boxArea.y + boxArea.height - handleY) < 1, 'the handle sits on the box corner');
  const inward = ((boxArea.width - 16) + (boxArea.height - 16)) / 4;
  await page.mouse.move(handleX, handleY);
  await page.mouse.down();
  await page.mouse.move(handleX - inward, handleY - inward, { steps: 10 });
  await page.mouse.up();
  const resized = (await saved(`session.ink?.images?.some((item) => !item.problem && item.w < ${added.w} * 0.75)`)).ink.images.find((item) => !item.problem);
  assert.ok(Math.abs(resized.w / added.w - 0.5) < 0.03 && Math.abs(resized.w / resized.h - 2) < 0.01, `resized to ${resized.w} × ${resized.h} from ${added.w} × ${added.h}`);
  assert.ok(Math.abs(resized.x - added.x) < 0.5 && Math.abs(resized.y - added.y) < 0.5, 'its top left stays put');
  assert.equal(await ink().getAttribute('data-selected'), '1', 'it stays selected');
  await page.keyboard.press('Delete');
  await waitCount('images', 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitCount('images', 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await saved(`session.ink?.images?.some((item) => !item.problem && item.w === ${added.w})`);
  await page.getByRole('button', { name: 'Clear board' }).click();
  await waitCount('images', 1);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  console.log('PASS Add picture puts it below the work, chosen with the lasso; the corner handle resizes it; Delete, undo and Clear');

  // Ctrl+V with a picture on the clipboard pastes it the same way.
  await page.evaluate(async (png) => {
    const blob = await (await fetch(`data:image/png;base64,${png}`)).blob();
    const data = new DataTransfer();
    data.items.add(new File([blob], 'pasted.png', { type: 'image/png' }));
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data }));
  }, photo);
  await waitCount('images', 2);
  assert.equal(await ink().getAttribute('data-selected'), '1', 'the pasted picture is chosen');
  await page.getByRole('button', { name: 'Clear board' }).click();
  await waitCount('images', 1);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  console.log('PASS Ctrl+V pastes a picture from the clipboard');

  // The controls are in a rail down the board's left, the tutor at its top; nothing sits below the board.
  {
    const controls = page.getByRole('group', { name: 'Board controls' });
    const railBox = await controls.boundingBox();
    const boardBox = await ink().boundingBox();
    assert.ok(railBox.x + railBox.width <= boardBox.x + 1 && railBox.height > railBox.width, 'a rail left of the board');
    const tutorBox = await controls.getByRole('button', { name: 'Ask tutor', exact: true }).boundingBox();
    const penBox = await controls.getByRole('button', { name: 'Pen', exact: true }).boundingBox();
    assert.ok(tutorBox.y < penBox.y, 'Ask tutor tops the rail');
    const viewport = page.viewportSize();
    assert.ok(boardBox.y + boardBox.height > viewport.height - 4, 'the board runs to the foot of the screen');
    // Full screen takes the header too; the rail's own button brings it back.
    await page.getByRole('button', { name: 'Full screen', exact: true }).click();
    await page.getByRole('button', { name: 'Mark solved', exact: true }).waitFor({ state: 'hidden' });
    await controls.getByRole('button', { name: 'Exit full screen' }).click();
    await page.getByRole('button', { name: 'Mark solved', exact: true }).waitFor();
    // The rail folds away; a tab at the edge brings it back.
    await boardMenu('Hide tool rail');
    await controls.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Show tools', exact: true }).click();
    await page.getByRole('button', { name: 'Pen', exact: true }).waitFor();
    // On a short screen the rail scrolls within the board, and its menus still open on screen.
    await page.setViewportSize({ width: 1000, height: 520 });
    const short = await controls.boundingBox();
    const shortBoard = await ink().boundingBox();
    assert.ok(Math.abs(short.y + short.height - (shortBoard.y + shortBoard.height)) < 2, 'the rail ends with the board');
    const menuButton = controls.getByRole('button', { name: 'Board menu' });
    await menuButton.scrollIntoViewIfNeeded();
    await menuButton.click();
    const menu = await page.getByRole('menu', { name: 'Board menu' }).boundingBox();
    assert.ok(menu.x >= short.x + short.width - 1 && menu.y >= 0 && menu.y + menu.height <= 520 + 1, 'the menu opens beside the rail, on screen');
    await page.keyboard.press('Escape');
    await page.setViewportSize(viewport);
  }
  console.log('PASS the ink board keeps its controls in a left rail that folds away; full screen hides the header');

  // A board with only its problem typed is saved with no drawing.
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByRole('menuitem', { name: 'New Problem' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-loading]') && document.querySelector('[data-ink-board]')?.getAttribute('data-strokes') === '0');
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
  await problemBox().fill('Nothing drawn yet.');
  const untouched = await saved("session.problemStatement === 'Nothing drawn yet.'");
  assert.equal(untouched.canvasDocument, null);
  assert.equal(untouched.ink, undefined);
  await page.reload();
  await ink().waitFor();
  assert.equal(await problemBox().inputValue(), 'Nothing drawn yet.');
  console.log('PASS a board saved with nothing drawn reopens empty');

  assert.deepEqual(errors, []);
} finally {
  await context.close();
  provider.close();
}
