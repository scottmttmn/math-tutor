import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// The BOOX pen on a board, with the Android app's native bridge stood in for: the page believes
// it runs in the app on a BOOX tablet, records each BooxPen call, and the test hands it strokes
// as the SDK would. What the SDK itself does on the e-ink screen can only be judged on the device.
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

function fakeBooxBridge() {
  const methods = ['status', 'start', 'setRegion', 'pause', 'resume', 'refresh', 'stop'];
  const calls = [];
  const listeners = new Map();
  let nextId = 1;
  window.__boox = {
    calls,
    emit(event, points) {
      for (const callback of listeners.get(event) ?? []) callback({ points });
    },
  };
  window.androidBridge = { postMessage() {} };
  window.Capacitor = {
    PluginHeaders: [{
      name: 'BooxPen',
      methods: [
        ...methods.map((name) => ({ name, rtype: 'promise' })),
        { name: 'addListener', rtype: 'callback' },
        { name: 'removeListener', rtype: 'callback' },
      ],
    }],
    async nativePromise(plugin, method, options) {
      if (plugin !== 'BooxPen') throw new Error(`${plugin} is not stood in for`);
      calls.push({ method, options });
      if (method === 'start' && window.__failStart) throw new Error('The BOOX pen couldn\'t start.');
      return method === 'status' ? { onyx: true, active: false } : undefined;
    },
    nativeCallback(plugin, method, options, callback) {
      const id = String(nextId++);
      if (method === 'addListener') {
        const list = listeners.get(options.eventName) ?? [];
        list.push(callback);
        listeners.set(options.eventName, list);
      }
      return Promise.resolve(id);
    },
  };
}

/** Whether a pen pointerdown on the canvas is stopped before tldraw sees it. */
function penEventBlocked(target) {
  return target.evaluate(() => {
    const canvas = document.querySelector('.tl-canvas');
    const { left, top } = canvas.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', { pointerType: 'pen', bubbles: true, cancelable: true, clientX: left + 50, clientY: top + 50 });
    canvas.dispatchEvent(event);
    canvas.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'pen', bubbles: true, cancelable: true, clientX: left + 50, clientY: top + 50 }));
    return event.defaultPrevented;
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(fakeBooxBridge);
  await page.goto(`${origin}/board?new=problem`);
  const canvas = page.locator('.tl-canvas');
  await canvas.waitFor();
  const controls = page.getByRole('group', { name: 'Board controls' });
  const calls = (method) => page.evaluate((name) => window.__boox.calls.filter((call) => call.method === name), method);
  const drawShapes = () => page.locator('[data-shape-type="draw"]').count();

  // Off until chosen, and offered only because the page thinks it is on a BOOX.
  await controls.getByRole('button', { name: 'Board menu' }).click();
  const item = page.getByRole('menuitemcheckbox', { name: 'BOOX pen (experiment)', exact: true });
  assert.equal(await item.getAttribute('aria-checked'), 'false');
  await item.click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  const [{ options: start }] = await calls('start');
  const box = await canvas.boundingBox();
  assert.ok(Math.abs(start.region.w - box.width) < 2 && Math.abs(start.region.h - box.height) < 2, 'the pen draws over the canvas');
  assert.ok(start.exclude.length > 0, "tldraw's controls stay tappable");

  // A stroke from the SDK becomes ink where it was drawn, and the screen is let through.
  const flat = [];
  for (let i = 0; i <= 20; i += 1) flat.push(box.x + 200 + i * 10, box.y + 200 + i * 4, 0.6, i * 8);
  await page.evaluate((points) => window.__boox.emit('stroke', points), flat);
  await page.locator('[data-shape-type="draw"]').first().waitFor();
  assert.equal(await drawShapes(), 1);
  const shape = await page.locator('[data-shape-type="draw"]').first().boundingBox();
  assert.ok(shape.x < box.x + 210 && shape.x + shape.width > box.x + 390, 'the ink sits where the pen wrote');
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'refresh'));

  // An open menu over the board takes the pen back; closing it gives the pen to the SDK again.
  await controls.getByRole('button', { name: 'Board menu' }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'pause'));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'resume'));

  // While the SDK has the pen, pen events the WebView still hears don't reach tldraw.
  assert.equal(await penEventBlocked(page), true);

  // The eraser end erases the stroke it crosses, even between two far-apart samples; undo brings it back.
  await page.evaluate(([x, y]) => window.__boox.emit('erase', [x, y - 80, 0.5, 0, x, y + 80, 0.5, 8]), [box.x + 300, box.y + 240]);
  await page.waitForFunction(() => document.querySelectorAll('[data-shape-type="draw"]').length === 0);
  await page.keyboard.press('Control+z');
  await page.locator('[data-shape-type="draw"]').first().waitFor();

  // Another tool hands the pen back to tldraw.
  await page.getByTestId('tools.select').click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'stop'));

  // The pen test can hand the pen to the SDK too, to compare it with the browser's own drawing.
  await page.goto(`${origin}/pen-test`);
  await page.getByRole('button', { name: 'BOOX pen SDK' }).click();
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  const testCanvas = await page.getByTestId('pen-test-canvas').boundingBox();
  const testStroke = [];
  for (let i = 0; i <= 30; i += 1) testStroke.push(testCanvas.x + 100 + i * 6, testCanvas.y + 100, 0.5, i * 4);
  await page.evaluate((points) => window.__boox.emit('stroke', points), testStroke);
  await page.getByText(/Last stroke: \d+ samples\/s · drawn by the BOOX pen SDK · longest gap 4 ms/).waitFor();
  // A rotation resizes the canvas without reloading the app, so the SDK's region follows it.
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'setRegion' && call.options.region.w < 800));

  // If the SDK can't start on a tablet, the pen stays tldraw's instead of drawing nothing.
  const failing = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  // tldraw gets the made-up pen event here and can't capture its pointer, which is fine.
  failing.on('pageerror', (error) => { if (!error.message.includes('setPointerCapture')) errors.push(error.message); });
  await failing.addInitScript(fakeBooxBridge);
  await failing.addInitScript(() => { window.__failStart = true; });
  await failing.goto(`${origin}/board?new=problem`);
  await failing.locator('.tl-canvas').waitFor();
  await failing.getByRole('group', { name: 'Board controls' }).getByRole('button', { name: 'Board menu' }).click();
  await failing.getByRole('menuitemcheckbox', { name: 'BOOX pen (experiment)', exact: true }).click();
  await failing.waitForFunction(() => window.__boox.calls.some((call) => call.method === 'start'));
  await failing.waitForTimeout(200);
  assert.equal(await penEventBlocked(failing), false);
  assert.equal((await failing.evaluate(() => window.__boox.calls.filter((call) => call.method === 'start').length)), 1, 'a failed start is not retried on every change');

  // Anywhere else (a browser, or the app on another tablet) it isn't offered.
  const plain = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  plain.on('pageerror', (error) => errors.push(error.message));
  await plain.goto(`${origin}/board?new=problem`);
  await plain.locator('.tl-canvas').waitFor();
  await plain.getByRole('group', { name: 'Board controls' }).getByRole('button', { name: 'Board menu' }).click();
  await plain.getByRole('menuitemcheckbox', { name: 'Notebook mode (experiment)', exact: true }).waitFor();
  assert.equal(await plain.getByRole('menuitemcheckbox', { name: 'BOOX pen (experiment)' }).count(), 0);
  await plain.goto(`${origin}/pen-test`);
  await plain.getByRole('button', { name: 'Clear' }).waitFor();
  assert.equal(await plain.getByRole('button', { name: 'BOOX pen SDK' }).count(), 0);

  assert.deepEqual(errors, []);
  console.log('PASS BOOX pen: offered only on BOOX, strokes become ink, erases, pauses under menus, stops for other tools, pen test');
} finally {
  await browser.close();
}
