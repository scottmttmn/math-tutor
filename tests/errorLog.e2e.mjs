import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Settings → Errors: the page's uncaught errors and rejections are kept on the device, and in the
// Android app what CrashLogPlugin recorded natively joins them (the bridge is stood in for here).
const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

function fakeCrashLog() {
  window.androidBridge = { postMessage() {} };
  let lines = [
    JSON.stringify({ at: Date.now() - 3_600_000, kind: 'page-process', message: 'Android stopped the page’s process, most likely to free memory', detail: 'Renderer priority at exit: 2' }),
    JSON.stringify({ at: Date.now() - 7_200_000, kind: 'crash', message: 'java.lang.IllegalStateException: test', detail: 'at com.scottmttmn.mathtutor.Test', build: '41' }),
  ].join('\n');
  window.Capacitor = {
    PluginHeaders: [{ name: 'CrashLog', methods: [{ name: 'read', rtype: 'promise' }, { name: 'clear', rtype: 'promise' }] }],
    async nativePromise(plugin, method, options) {
      if (plugin === 'CrashLog' && method === 'read') return { lines, size: new TextEncoder().encode(lines).length };
      if (plugin === 'CrashLog' && method === 'clear') {
        window.crashLogCleared = options.size;
        lines = new TextDecoder().decode(new TextEncoder().encode(lines).slice(options.size));
        return {};
      }
      if (plugin === 'BooxPen' && method === 'status') return { onyx: false, active: false };
      throw new Error(`${plugin}.${method} is not stood in for`);
    },
    nativeCallback() { return Promise.resolve('1'); },
  };
}

async function openErrors(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Errors' }).click();
}

try {
  // In a browser: page errors.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Settings' }).waitFor();
    await openErrors(page);
    await page.getByTestId('error-log-empty').waitFor();
    await page.getByRole('button', { name: 'Done' }).click();

    await page.evaluate(() => {
      setTimeout(() => { throw new Error('Test thrown error'); });
      void Promise.reject(new Error('Test rejection'));
      // The same error again at once is one entry.
      setTimeout(() => { throw new Error('Test thrown error'); });
    });
    await page.waitForTimeout(500);
    await page.reload();
    await openErrors(page);
    const entries = page.getByTestId('error-entry');
    await entries.first().waitFor();
    assert.equal(await entries.count(), 2);
    assert.match(await entries.nth(0).innerText(), /Page error\s+Error: Test rejection/);
    assert.match(await entries.nth(1).innerText(), /Page error\s+Error: Test thrown error[\s\S]*\/$/m);
    await entries.nth(1).locator('summary').click();
    await entries.nth(1).locator('pre').filter({ hasText: 'Test thrown error' }).waitFor();

    await page.getByRole('button', { name: 'Clear…' }).click();
    await page.getByRole('button', { name: 'Clear the log' }).click();
    await page.getByTestId('error-log-empty').waitFor();
    await context.close();
  }
  console.log('PASS page errors and rejections are listed under Settings → Errors, a quick repeat once, and Clear empties it');

  // In the Android app: the native log is taken in once, oldest first in storage, newest shown first.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    await context.addInitScript(fakeCrashLog);
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await openErrors(page);
    const entries = page.getByTestId('error-entry');
    await entries.nth(1).waitFor();
    assert.equal(await entries.count(), 2);
    assert.match(await entries.nth(0).innerText(), /Page stopped\s+Android stopped the page’s process/);
    assert.match(await entries.nth(1).innerText(), /App crashed\s+java\.lang\.IllegalStateException: test[\s\S]*build 41/);
    // Cleared natively once stored, all of it.
    assert.ok(await page.evaluate(() => window.crashLogCleared) > 0);
    await page.getByRole('button', { name: 'Done' }).click();
    // Taken once: a reload doesn't add them again.
    await page.reload();
    await openErrors(page);
    await entries.nth(1).waitFor();
    assert.equal(await entries.count(), 2);
    await context.close();
  }
  console.log('PASS the Android app\'s native crash log joins the list once');
} finally {
  await browser.close();
}
