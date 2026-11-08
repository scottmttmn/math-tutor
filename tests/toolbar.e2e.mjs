import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { drawStroke } from './ink-ui.mjs';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const requests = [];
  await page.route('**/api/tutor', (route) => { requests.push(route.request()); return route.abort(); });
  await page.goto(`${origin}/board?new=problem`);
  await page.getByTestId('ink-board').waitFor();
  const controls = page.getByRole('group', { name: 'Board controls' });
  const clear = controls.getByRole('button', { name: 'Clear board', exact: true });
  await clear.and(page.locator(':disabled')).waitFor();
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Solve 2x + 3 = 7');
  await controls.getByRole('button', { name: 'Board menu' }).click();
  assert.ok(await page.getByRole('menuitem', { name: 'Save as PNG' }).isDisabled());
  assert.ok(await page.getByRole('menuitem', { name: 'Save as PDF' }).isDisabled());
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Hide tool rail' }).getAttribute('aria-checked'), 'false');
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: 'Paper: Blank' }).click();
  assert.equal(await page.getByRole('menuitemradio', { name: 'Blank' }).getAttribute('aria-checked'), 'true');
  await page.getByRole('menuitemradio', { name: 'Lined' }).click();
  await page.locator('[data-paper="lined"]').waitFor();
  await drawStroke(page, 100, 150, 280, 210);
  await clear.and(page.locator(':enabled')).waitFor();
  await clear.click();
  await clear.and(page.locator(':disabled')).waitFor();
  await controls.getByRole('button', { name: 'Undo', exact: true }).click();
  await clear.and(page.locator(':enabled')).waitFor();
  await controls.getByRole('button', { name: 'Board menu' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Hide tool rail' }).click();
  await controls.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Show tools', exact: true }).click();
  await controls.getByRole('button', { name: 'Pen', exact: true }).waitFor();
  // Favorite, Mark solved and Full screen are in the board's header, away from the writing hand.
  await page.getByRole('button', { name: 'Favorite', exact: true }).and(page.locator(':enabled')).waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Favorite', exact: true }).count(), 0);

  const ask = controls.getByRole('button', { name: 'Ask tutor', exact: true });
  assert.equal(await ask.getAttribute('aria-pressed'), 'false');
  await ask.click();
  await page.getByRole('complementary', { name: 'Tutor' }).waitFor();
  assert.equal(await ask.getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.getByRole('button', { name: 'Tutor', exact: true }).count(), 0);
  assert.deepEqual(await page.getByRole('group', { name: 'Tutor choices' }).getByRole('button').allTextContents(), ['Hint', 'Check my work', 'Feedback']);
  const question = page.getByPlaceholder('Ask your own question…');
  await question.fill('Keep this draft.');
  await ask.click();
  assert.equal(await page.getByRole('complementary', { name: 'Tutor' }).count(), 0);
  await ask.click();
  assert.equal(await question.inputValue(), 'Keep this draft.');
  assert.equal(requests.length, 0, 'opening and closing the drawer sends no tutor request');
  await question.fill('');

  for (const width of [1600, 700]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(200);
    const buttons = await controls.locator('button').evaluateAll((buttons) => buttons.map((button) => ({
      name: button.getAttribute('aria-label') || button.textContent.trim(),
      title: button.title, x: button.getBoundingClientRect().x, y: button.getBoundingClientRect().y,
      w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height,
    })));
    assert.ok(buttons.every((button) => button.h >= 44 && button.w >= 44), JSON.stringify(buttons));
    assert.equal(new Set(buttons.map((button) => Math.round(button.x))).size, 1, `one rail column at ${width}px: ${JSON.stringify(buttons)}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const name of ['Paper: Lined', 'Clear board', 'Board menu']) {
      assert.equal(buttons.find((button) => button.name === name)?.title, name);
    }
    if (process.env.BOARD_SCREENSHOT_DIR) {
      await mkdir(process.env.BOARD_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.BOARD_SCREENSHOT_DIR, `toolbar-${width}.png`) });
    }
  }
  assert.deepEqual(errors, []);
  console.log('PASS paper, disabled exports, undoable sweep, the rail folding away, and 44px controls in one column at 700px and desktop');
} finally {
  await browser.close();
}
