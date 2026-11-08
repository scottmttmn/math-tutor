import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fakeBooxBridge } from './boox-bridge.mjs';

// The ink board on a BOOX tablet, with the native bridge stood in for (tests/boox-bridge.mjs):
// Onyx's pen draws the pen tool's strokes, which become ink; the eraser end takes strokes; the
// highlighter is the SDK's with a marker tip; the eraser tool and finger gestures use fast screen
// updates; menus pause the pen.
// How it all looks and feels on the e-ink screen can only be judged on the device.
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

try {
  // Leave room for the 25% larger BOOX controls and all pen/gesture sample paths below.
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(fakeBooxBridge);
  await page.goto(`${origin}/board?new=problem`);
  const board = page.locator('[data-ink-board]');
  await board.waitFor();
  const calls = (method) => page.evaluate((name) => window.__boox.calls.filter((call) => call.method === name), method);
  const waitLast = (method, test) => page.waitForFunction(([name, check]) => {
    const options = window.__boox.calls.filter((call) => call.method === name).at(-1)?.options;
    return options && new Function('options', `return ${check}`)(options);
  }, [method, test]);
  const strokes = async () => Number(await board.getAttribute('data-strokes'));
  const waitStrokes = (count) => page.waitForFunction((n) => document.querySelector('[data-ink-board]')?.getAttribute('data-strokes') === String(n), count);

  // The pen tool is the SDK's from the start, over the board less its toolbar.
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  const [{ options: start }] = await calls('start');
  const box = await board.boundingBox();
  assert.ok(box.width > 650 && box.height > 550, 'all input paths stay inside the visible board');
  assert.ok(Math.abs(start.region.w - box.width) < 2 && Math.abs(start.region.h - box.height) < 2, 'the pen draws over the board');
  const penButton = await page.getByRole('button', { name: 'Pen', exact: true }).boundingBox();
  const inside = (rect, x, y) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
  // The ink tools are in the rail beside the board, outside the pen's region.
  assert.ok(penButton.x + penButton.width <= start.region.x + 1, 'the ink tools stay tappable');
  assert.ok(!inside(start.region, penButton.x + penButton.width / 2, penButton.y + penButton.height / 2), 'the rail is not the pen\'s');
  assert.ok(!start.exclude.some((rect) => inside(rect, box.x + box.width / 2, box.y + box.height / 2)), 'the page stays writable');
  // Size S at the page's writing scale (set again once the SDK is up), black.
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'setWidth'));
  assert.ok(start.width > 1 && start.width < 4, `preview width ${start.width}`);
  assert.equal(start.color, '#111827');

  // A stroke from the SDK becomes one undoable ink stroke where it was drawn; the screen is let through.
  const flat = [];
  for (let i = 0; i <= 20; i += 1) flat.push(box.x + 200 + i * 15, box.y + 300 + i * 4, 0.6, i * 8);
  await page.evaluate((points) => window.__boox.emit('stroke', points), flat);
  await waitStrokes(1);
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'refresh'));
  // Pen events the WebView still hears are not drawn a second time.
  const blocked = await page.getByTestId('ink-board').evaluate((canvas) => {
    const { left, top } = canvas.getBoundingClientRect();
    const options = { pointerType: 'pen', bubbles: true, cancelable: true, clientX: left + 300, clientY: top + 500, button: 0, buttons: 1 };
    const down = new PointerEvent('pointerdown', options);
    canvas.dispatchEvent(down);
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...options, clientX: left + 500 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, clientX: left + 500, buttons: 0 }));
    return down.defaultPrevented;
  });
  assert.equal(blocked, true);
  await page.waitForTimeout(300);
  assert.equal(await strokes(), 1, 'the page does not draw the pen itself');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitStrokes(0);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await waitStrokes(1);

  // The eraser end takes the stroke it crosses, even between two far-apart samples.
  const midX = box.x + 200 + 150, midY = box.y + 300 + 40;
  await page.evaluate(([x, y]) => window.__boox.emit('erase', [x, y - 80, 0.5, 0, x, y + 80, 0.5, 8]), [midX, midY]);
  await waitStrokes(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await waitStrokes(1);

  // Size and ink change the preview without restarting the pen.
  const starts = (await calls('start')).length;
  const small = (await calls('setWidth')).at(-1).options.width;
  // The pen's sizes and inks open from its button (it is already chosen) and sit outside the pen's region.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('button', { name: 'Size M' }).click();
  await waitLast('setWidth', `Math.abs(options.width - ${small * 1.5}) < 0.01`);
  await page.getByRole('button', { name: 'Gray' }).click();
  await waitLast('setWidth', "options.color === '#6b7280'");
  assert.equal((await calls('start')).length, starts);
  await page.evaluate((points) => window.__boox.emit('stroke', points), flat.map((value, i) => (i % 4 === 1 ? value + 100 : value)));
  await waitStrokes(2);

  // Zooming in widens the preview with the ink.
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  // Wheel frames come at the panel's pace on a BOOX, so the zoom shows a moment later.
  await page.waitForFunction(() => Number(document.querySelector('[data-ink-board]').getAttribute('data-zoom')) > 1.2);
  const zoomed = Number(await board.getAttribute('data-zoom'));
  assert.ok(zoomed > 1.2);
  await waitLast('setWidth', `options.width > ${small * 1.5 * 1.2}`);
  // The wheel used fast screen updates, released once it rested.
  await waitLast('interaction', 'options.active === false');
  assert.ok((await calls('interaction')).some((call) => call.options.active), 'the wheel used fast mode');
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();

  // An open menu over the board takes the pen back; closing it gives it to the SDK again.
  await page.getByRole('button', { name: 'Board menu' }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'pause'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'resume'));
  // + New's menu hangs over the board too: the pen must be able to tap its items.
  const paused = (await calls('pause')).length;
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction((count) => window.__boox.calls.filter((call) => call.method === 'pause').length > count, paused);
  const resumed = (await calls('resume')).length;
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.waitForFunction((count) => window.__boox.calls.filter((call) => call.method === 'resume').length > count, resumed);

  // The highlighter is the SDK's too, previewed with a flat marker tip in the highlight's look on
  // white, without restarting the pen; its stroke becomes a highlight.
  await page.getByRole('button', { name: 'Highlight', exact: true }).click();
  await waitLast('setWidth', "options.marker === true && options.color === '#dadcdf'");
  assert.equal((await calls('start')).length, starts, 'the highlighter keeps the running pen');
  const highlight = [];
  for (let i = 0; i <= 20; i += 1) highlight.push(box.x + 200 + i * 15, box.y + 500, 0.5, i * 8);
  await page.evaluate((points) => window.__boox.emit('stroke', points), highlight);
  await waitStrokes(3);
  let saved = null;
  for (let tries = 0; tries < 50 && !saved; tries++) {
    saved = await page.evaluate(async () => {
      const id = localStorage.getItem('math-tutor:currentSession');
      if (!id) return null;
      const db = await new Promise((resolve) => { const open = indexedDB.open('math-tutor'); open.onsuccess = () => resolve(open.result); });
      const session = await new Promise((resolve) => { const get = db.transaction('sessions').objectStore('sessions').get(id); get.onsuccess = () => resolve(get.result); });
      db.close();
      const strokes = session?.ink?.strokes ?? [];
      return strokes.length === 3 ? strokes.at(-1) : null;
    });
    if (!saved) await page.waitForTimeout(200);
  }
  assert.equal(saved?.tool, 'highlighter');
  assert.equal(saved.color, 'gray');
  assert.equal(saved.width, 20);

  // The eraser is the page's, drawn with fast screen updates.
  await page.getByRole('button', { name: 'Eraser', exact: true }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'stop'));
  await waitLast('interaction', 'options.active === true');
  await page.mouse.move(box.x + 350, box.y + 470);
  await page.mouse.down();
  await page.mouse.move(box.x + 350, box.y + 530, { steps: 8 });
  await page.mouse.up();
  await waitStrokes(2);
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await waitLast('interaction', 'options.active === false');
  await page.waitForFunction((count) => window.__boox.calls.filter((call) => call.method === 'start').length > count, starts);
  await waitLast('setWidth', 'options.marker === false');

  // Two fingers pan in fast mode, released after the last one lifts.
  const touch = await page.context().newCDPSession(page);
  await touch.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const before = (await calls('interaction')).length;
  const finger = { id: 1, x: box.x + 400, y: box.y + 500 };
  const pair = (dy) => [{ ...finger, y: finger.y - dy }, { ...finger, id: 2, x: finger.x + 100, y: finger.y - dy }];
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(0) });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(120) });
  await waitLast('interaction', 'options.active === true');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await waitLast('interaction', 'options.active === false');
  assert.ok((await calls('interaction')).length > before);

  // A fast drag is painted at the panel's pace, not every frame, and ends where the finger stopped.
  await page.evaluate(() => {
    window.__paints = 0;
    new MutationObserver(() => { window.__paints += 1; }).observe(document.querySelector('[data-ink-board]'), { attributeFilter: ['data-view-y'] });
  });
  const startY = Number(await board.getAttribute('data-view-y'));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pair(0) });
  for (let step = 1; step <= 30; step += 1) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pair(step * 4) });
    await page.waitForTimeout(10);
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
  const paints = await page.evaluate(() => window.__paints);
  assert.ok(paints >= 1 && paints <= 8, `a fast drag painted ${paints} times`);
  const endY = Number(await board.getAttribute('data-view-y'));
  // The last move is painted once the drag ends: the view moved the whole 120 px (fit zoom is near 1 here).
  assert.ok(endY - startY > 80, `the view followed the finger (${startY} to ${endY})`);

  // Palm rejection: a hand resting as the pen hovers, just after a stroke, or as wide as a palm
  // doesn't scroll; two fingers a moment later still do, and one finger never does.
  const viewY = async () => Number(await board.getAttribute('data-view-y'));
  const drag = async (radius = 5, count = 2) => {
    const start = await viewY();
    const at = (dy) => [{ id: 3, x: box.x + 600, y: box.y + 500 - dy, radiusX: radius, radiusY: radius }, { id: 6, x: box.x + 700, y: box.y + 500 - dy, radiusX: radius, radiusY: radius }].slice(0, count);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
    for (let step = 1; step <= 4; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(step * 40) });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    return (await viewY()) - start;
  };
  await page.waitForTimeout(900);
  const pen = await page.context().newCDPSession(page);
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + 300, y: box.y + 300, pointerType: 'pen' });
  assert.equal(await drag(), 0, 'a palm as the pen hovers');
  await page.waitForTimeout(900);
  await page.evaluate((points) => window.__boox.emit('stroke', points), flat.map((value, i) => (i % 4 === 1 ? value + 200 : value)));
  assert.equal(await drag(), 0, 'a palm just after a stroke');
  await page.waitForTimeout(900);
  assert.equal(await drag(40), 0, 'a contact as wide as a palm');
  assert.ok((await drag()) > 0, 'two fingers a moment later scroll');
  assert.equal(await drag(5, 1), 0, 'one finger never scrolls; it takes two, as in BOOX Notes');

  // A hand settling contact by contact, or two fingers resting and drifting, neither zooms nor
  // scrolls; a deliberate pinch still zooms.
  await page.waitForTimeout(300);
  const zoomNow = async () => Number(await board.getAttribute('data-zoom'));
  const twoFingers = async ({ gap, spread }) => {
    const before = { zoom: await zoomNow(), y: await viewY() };
    const a = { id: 4, x: box.x + 450, y: box.y + 450, radiusX: 5, radiusY: 5 };
    const b = { id: 5, x: box.x + 550, y: box.y + 450, radiusX: 5, radiusY: 5 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
    await page.waitForTimeout(gap);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
    for (let step = 1; step <= 5; step++) {
      const out = (spread * step) / 5;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x - out, y: a.y - step * 10 }, { ...b, x: b.x + out, y: b.y - step * 10 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    return { zoom: (await zoomNow()) / before.zoom, moved: (await viewY()) - before.y };
  };
  const settling = await twoFingers({ gap: 400, spread: 40 });
  assert.equal(settling.zoom, 1, 'a hand settling contact by contact does not zoom');
  assert.equal(settling.moved, 0, 'a hand settling contact by contact does not scroll');
  assert.equal((await twoFingers({ gap: 20, spread: 4 })).zoom, 1, 'two resting fingers drifting do not zoom');
  const scroll = await twoFingers({ gap: 20, spread: 0 });
  assert.ok(scroll.moved > 0 && scroll.zoom === 1, 'two fingers scroll without zooming');
  // A long scroll whose fingers drift apart once it is under way stays a scroll.
  {
    const before = { zoom: await zoomNow(), y: await viewY() };
    const a = { id: 7, x: box.x + 450, y: box.y + 600, radiusX: 5, radiusY: 5 };
    const b = { id: 8, x: box.x + 550, y: box.y + 600, radiusX: 5, radiusY: 5 };
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
    for (let step = 1; step <= 10; step++) {
      const out = step > 4 ? (step - 4) * 8 : 0;
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x - out, y: a.y - step * 15 }, { ...b, x: b.x + out, y: b.y - step * 15 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(400);
    assert.equal((await zoomNow()) / before.zoom, 1, 'fingers spreading during a scroll do not zoom');
    assert.ok((await viewY()) - before.y > 0, 'the drifting scroll still scrolls');
  }
  assert.ok((await twoFingers({ gap: 20, spread: 60 })).zoom > 1.2, 'a pinch zooms');
  await pen.detach();
  await touch.detach();

  // The lasso on a BOOX: its loop and a dragged selection come at the panel's pace, and the board
  // under a drag is painted only as it starts and ends.
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await page.waitForTimeout(400);
  const lineY = box.y + 260;
  const line = [];
  for (let i = 0; i <= 20; i += 1) line.push(box.x + 120 + i * 12, lineY, 0.5, i * 8);
  const strokesBefore = await strokes();
  await page.evaluate((points) => window.__boox.emit('stroke', points), line);
  await waitStrokes(strokesBefore + 1);
  // The loop is Onyx's pen's too (drawn at once, thin and gray); the selection box is left to the
  // page, so the pen drags it there.
  await page.getByRole('button', { name: 'Lasso', exact: true }).click();
  await waitLast('setWidth', "options.color === '#6b7280' && options.dash === true");
  const loopPoints = [[box.x + 100, lineY - 30], [box.x + 400, lineY - 30], [box.x + 400, lineY + 30], [box.x + 100, lineY + 30], [box.x + 100, lineY - 30]];
  await page.evaluate((points) => window.__boox.emit('stroke', points.flatMap(([x, y], i) => [x, y, 0.5, i * 20])), loopPoints);
  await page.waitForFunction(() => document.querySelector('[data-ink-board]')?.getAttribute('data-selected') === '1');
  await page.waitForFunction(([x, y]) => {
    const exclude = window.__boox.calls.filter((call) => call.method === 'setRegion' || call.method === 'start').at(-1)?.options.exclude ?? [];
    return exclude.some((rect) => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h);
  }, [box.x + 250, lineY]);
  await page.evaluate(() => { window.__paints = 0; });
  const lastHold = () => page.evaluate(() => window.__boox.calls.filter((call) => call.method === 'pause' || call.method === 'resume').at(-1)?.method);
  await page.mouse.move(box.x + 250, lineY);
  await page.mouse.down();
  // The SDK lets go of the pen at once for the drag, or it would take it outside the box.
  assert.equal(await lastHold(), 'pause', 'the SDK pauses as a drag starts');
  for (let step = 1; step <= 30; step += 1) {
    await page.mouse.move(box.x + 250, lineY + step * 4);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  const lassoPaints = await page.evaluate(() => window.__paints);
  assert.equal(await lastHold(), 'resume', 'the SDK takes the pen back as the drag ends');
  assert.ok(lassoPaints >= 2 && lassoPaints <= 3, `the board under a drag painted ${lassoPaints} times`);
  assert.equal(await board.getAttribute('data-selected'), '1', 'the moved ink stays selected');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('button', { name: 'Pen', exact: true }).click();

  // Scratch out on a BOOX: Onyx's pen scribbles over a word and the word goes.
  {
    const count = await strokes();
    const word = [[box.x + 200, box.y + 700], [box.x + 230, box.y + 720], [box.x + 260, box.y + 700]];
    await page.evaluate((points) => window.__boox.emit('stroke', points.flatMap(([x, y], i) => [x, y, 0.5, i * 20])), word);
    await waitStrokes(count + 1);
    const zig = [];
    for (let i = 0; i <= 6; i += 1) zig.push([box.x + (i % 2 ? 290 : 190), box.y + 695 + i * 4]);
    const dense = [];
    for (let i = 1; i < zig.length; i += 1) for (let s = 0; s < 10; s += 1) dense.push([zig[i - 1][0] + ((zig[i][0] - zig[i - 1][0]) * s) / 10, zig[i - 1][1] + ((zig[i][1] - zig[i - 1][1]) * s) / 10]);
    await page.evaluate((points) => window.__boox.emit('stroke', points.flatMap(([x, y], i) => [x, y, 0.5, i * 5])), dense);
    await waitStrokes(count);
  }

  // Leaving for Home stops the pen and releases fast mode.
  await page.getByRole('link', { name: 'Home' }).click();
  await page.waitForURL(`${origin}/`);
  await page.waitForFunction(() => window.__boox.calls.at(-1)?.method === 'stop' || window.__boox.calls.filter((call) => call.method === 'stop').length >= 2);

  assert.deepEqual(errors, []);
  console.log('PASS BOOX ink board: the SDK draws the pen and highlighter into ink, erases, previews tool/size/ink/zoom, pauses under menus, fast mode for the eraser and fingers, palms rejected (pinches too)');
} finally {
  await browser.close();
}
