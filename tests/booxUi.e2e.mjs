import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fakeBooxBridge } from './boox-bridge.mjs';

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const desktop = await browser.newPage();
  await desktop.goto(origin);
  assert.equal(await desktop.evaluate(() => getComputedStyle(document.documentElement).fontSize), '16px');
  await desktop.close();

  const page = await browser.newPage({ viewport: { width: 930, height: 1240 } });
  await page.addInitScript(fakeBooxBridge);
  await page.goto(`${origin}/board?new=problem`);
  await page.locator('[data-ink-board]').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '20px');
  for (const viewport of [{ width: 930, height: 1240 }, { width: 1240, height: 930 }]) {
    await page.setViewportSize(viewport);
    const controls = page.getByRole('group', { name: 'Board controls' });
    const sizes = await controls.getByRole('button').evaluateAll((buttons) => buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { name: button.getAttribute('aria-label'), height: box.height, width: box.width, left: box.left, right: box.right };
    }));
    assert.ok(sizes.every((size) => size.height >= 55 && size.width >= 55 && size.left >= 0 && size.right <= viewport.width), JSON.stringify(sizes));
    assert.equal(await controls.getByRole('button', { name: 'Ask tutor', exact: true }).evaluate((button) => getComputedStyle(button).fontSize), '17.5px');
    await page.getByRole('button', { name: 'Board menu', exact: true }).click();
    const menu = page.getByRole('menu', { name: 'Board menu' });
    const box = await menu.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height, 'large menus fit the viewport');
    await menu.getByRole('menuitem', { name: 'Save as PDF' }).scrollIntoViewIfNeeded();
    await page.keyboard.press('Escape');
    await controls.getByRole('button', { name: 'Ask tutor', exact: true }).click();
    await page.getByPlaceholder('Ask your own question…').fill('Keep my draft');
    await page.getByRole('button', { name: 'Close tutor' }).click();
    await controls.getByRole('button', { name: 'Ask tutor', exact: true }).click();
    assert.equal(await page.getByPlaceholder('Ask your own question…').inputValue(), 'Keep my draft');
    await page.getByRole('button', { name: 'Close tutor' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    const dialogBox = await dialog.boundingBox();
    assert.ok(dialogBox.y >= 0 && dialogBox.x >= 0 && dialogBox.y + dialogBox.height <= viewport.height && dialogBox.x + dialogBox.width <= viewport.width);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  }
  console.log('PASS BOOX sizing, portrait/landscape controls, scrollable menus, Settings, tutor drafts, and desktop sizing');
} finally {
  await browser.close();
}
