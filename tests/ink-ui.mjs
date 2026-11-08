// Writing on the board in the browser tests: strokes are in CSS px from the board's top left.

export const inkBoard = (page) => page.locator('[data-ink-board]');

/** A pen stroke from (x0, y0) to (x1, y1), then a pause for the board to settle. */
export async function drawStroke(page, x0 = 40, y0 = 80, x1 = 180, y1 = 160) {
  const area = page.getByTestId('ink-board');
  await area.waitFor();
  const box = await area.boundingBox();
  const before = Number(await inkBoard(page).getAttribute('data-strokes'));
  await page.mouse.move(box.x + x0, box.y + y0);
  await page.mouse.down();
  await page.mouse.move(box.x + x1, box.y + y1, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction((count) => Number(document.querySelector('[data-ink-board]')?.getAttribute('data-strokes')) > count, before);
  await page.waitForTimeout(400); // the app mirrors the board once the pen rests
}
