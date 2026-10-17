import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/board?new=problem`);
  await page.locator('.tl-canvas').waitFor();
  const controls = page.getByRole('group', { name: 'Board controls' });
  const clear = controls.getByRole('button', { name: 'Clear board', exact: true });
  await clear.and(page.locator(':disabled')).waitFor();
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Solve 2x + 3 = 7');
  await controls.getByRole('button', { name: 'Board menu' }).click();
  assert.ok(await page.getByRole('menuitem', { name: 'Save as PNG' }).isDisabled());
  assert.ok(await page.getByRole('menuitem', { name: 'Save as PDF' }).isDisabled());
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Hide drawing tools' }).getAttribute('aria-checked'), 'false');
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: 'Paper: Blank' }).click();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Blank' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemradio', { name: 'Lined' }).click();
  await page.locator('[data-paper="lined"]').waitFor();
  const box = await page.locator('.tl-canvas').boundingBox();
  await page.locator('[data-testid="tools.draw"]').click();
  await page.mouse.move(box.x + 100, box.y + 150, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 210, { steps: 12 });
  await page.mouse.up();
  await clear.and(page.locator(':enabled')).waitFor();
  await clear.click();
  await clear.and(page.locator(':disabled')).waitFor();
  await page.locator('[data-testid="quick-actions.undo"]').click();
  await clear.and(page.locator(':enabled')).waitFor();
  await controls.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Hide drawing tools' }).click();
  await page.locator('.tlui-layout').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Show tools', exact: true }).click();
  await page.locator('.tlui-layout').waitFor();
  await controls.getByRole('button', { name: 'Favorite', exact: true }).and(page.locator(':enabled')).waitFor();

  for (const width of [1600, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(200);
    const buttons = await controls.locator('button').evaluateAll((buttons) => buttons.map((button) => ({
      name: button.getAttribute('aria-label') || button.textContent.trim(),
      title: button.title, x: button.getBoundingClientRect().x, y: button.getBoundingClientRect().y,
      w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height,
    })));
    assert.ok(buttons.every((button) => button.h >= 44 && button.w >= 44), JSON.stringify(buttons));
    assert.equal(new Set(buttons.map((button) => button.y)).size, 1, `one toolbar row at ${width}px: ${JSON.stringify(buttons)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const name of ['Full screen', 'Paper: Lined', 'Clear board', 'Board menu']) {
      assert.equal(buttons.find((button) => button.name === name)?.title, name);
    }
    if (process.env.BOARD_SCREENSHOT_DIR) {
      await mkdir(process.env.BOARD_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.BOARD_SCREENSHOT_DIR, `toolbar-${width}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS toolbar swatches, disabled exports, undoable sweep, Show tools chip, and 44px controls on one row at 700px and desktop');
} finally {
  await browser.close();
}
