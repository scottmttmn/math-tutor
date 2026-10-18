import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { makePdf } from './makePdf.mjs';
import load from './load-typescript.mjs';

const { readZip } = load('src/lib/zip.ts');

const origin = process.env.APP_TEST_URL || 'http://127.0.0.1:3100';
const browserErrors = [];
const folder = await mkdtemp(join(tmpdir(), 'backup-acceptance-'));
const pdfPath = join(folder, 'Geometry.pdf');
await writeFile(pdfPath, makePdf([['1. Prove the angles of a triangle add up to 180 degrees.']]));

const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });

// The folder picker can't be clicked through in a headless browser; the browser's private
// file system gives the same kind of folder handle, so the picker returns a folder there.
const fakePicker = () => {
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('Dropbox', { create: true });
};

async function openPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(fakePicker);
  const page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  return { context, page };
}

async function download(page, action) {
  const [file] = await Promise.all([page.waitForEvent('download'), action()]);
  const path = join(folder, file.suggestedFilename());
  await file.saveAs(path);
  return { name: file.suggestedFilename(), bytes: await readFile(path), path };
}

const readOpfs = (page, path) => page.evaluate(async (parts) => {
  let directory = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
  return file.type === 'application/json' || parts.at(-1).endsWith('.json') ? file.text() : file.size;
}, path.split('/'));

const lastModified = (page, path) => page.evaluate(async (parts) => {
  let directory = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  return (await (await directory.getFileHandle(parts.at(-1))).getFile()).lastModified;
}, path.split('/'));

const { context, page } = await openPage();
try {
  // Some work: a PDF in the library and a board with a problem and a stroke.
  await page.goto(`${origin}/`);
  await page.locator('input[aria-label="Add a PDF"]').setInputFiles(pdfPath);
  await page.getByRole('heading', { name: 'Geometry', exact: true }).waitFor();

  await page.goto(`${origin}/board`);
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 7');
  await page.locator('.tl-canvas').waitFor();
  const board = await page.locator('.tl-canvas').boundingBox();
  await page.mouse.move(board.x + 120, board.y + 120);
  await page.mouse.down();
  await page.mouse.move(board.x + 300, board.y + 200, { steps: 8 });
  await page.mouse.up();
  await page.getByText('Saved', { exact: true }).waitFor();

  // Save the board as a picture and as a PDF.
  await page.getByRole('button', { name: 'Board menu' }).click();
  const png = await download(page, () => page.getByRole('menuitem', { name: 'Save as PNG' }).click());
  assert.equal(png.name, 'Find x when 2x + 3 = 7.png');
  assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  await page.getByRole('button', { name: 'Board menu' }).click();
  const pdf = await download(page, () => page.getByRole('menuitem', { name: 'Save as PDF' }).click());
  assert.equal(pdf.name, 'Find x when 2x + 3 = 7.pdf');
  assert.equal(pdf.bytes.subarray(0, 8).toString('latin1'), '%PDF-1.4');
  console.log('PASS a board saves as a PNG and a PDF');

  // Nothing is backed up yet, so the bar suggests it; it opens the Backup settings. An edit made
  // just before (still inside the autosave pause) is in the backup: the board is saved first.
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 7 (check it)');
  await page.getByRole('button', { name: 'Back up', exact: true }).click();
  await page.getByRole('tab', { name: 'Backup', selected: true }).waitFor();
  const zip = await download(page, () => page.getByRole('button', { name: 'Download backup' }).click());
  assert.match(zip.name, /^math-tutor-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const zipEntries = await readZip(new Blob([zip.bytes]));
  const zipped = JSON.parse(await zipEntries.get('backup.json').text());
  assert.equal(zipped.boards.length, 1);
  assert.equal(JSON.parse(await zipEntries.get(zipped.boards[0].file).text()).problemStatement, 'Find x when 2x + 3 = 7 (check it)');
  await page.getByText(/Last downloaded just now/).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
  assert.equal(await page.getByRole('button', { name: 'Back up', exact: true }).count(), 0);
  console.log('PASS the backup downloads as one ZIP and the reminder goes away');

  // Back up to a folder: the files appear there at once.
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).click();
  await page.getByText(/Backing up to Dropbox\/Math Tutor backup\. Last backup just now\./).waitFor();
  const manifest = JSON.parse(await readOpfs(page, 'Dropbox/Math Tutor backup/backup.json'));
  assert.equal(manifest.boards.length, 1);
  const boardFile = `Dropbox/Math Tutor backup/${manifest.boards[0].file}`;
  assert.equal(JSON.parse(await readOpfs(page, boardFile)).problemStatement, 'Find x when 2x + 3 = 7 (check it)');
  assert.equal(manifest.shelf[0].title, 'Geometry');
  // The book's own folder goes with it.
  assert.deepEqual(manifest.folders.map((entry) => [entry.id, entry.name]), [[manifest.shelf[0].folderId, 'Geometry']]);
  assert.ok(await readOpfs(page, `Dropbox/Math Tutor backup/pdfs/${manifest.shelf[0].id}.pdf`) > 0);
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  assert.equal(JSON.parse(await readOpfs(page, `Dropbox/Math Tutor backup/backup-${day}.json`)).boards.length, 1);
  // The day's copy of the board, for going back to an earlier day.
  const historyFile = `Dropbox/Math Tutor backup/history/${day}/${manifest.boards[0].file.slice('boards/'.length)}`;
  assert.equal(JSON.parse(await readOpfs(page, historyFile)).problemStatement, 'Find x when 2x + 3 = 7 (check it)');

  // Backing up again rewrites backup.json but not a board that didn't change; a changed one is rewritten.
  const written = await lastModified(page, boardFile);
  await page.waitForTimeout(50);
  await page.getByRole('button', { name: 'Back up now' }).click();
  for (let tries = 0; JSON.parse(await readOpfs(page, 'Dropbox/Math Tutor backup/backup.json')).createdAt === manifest.createdAt; tries += 1) {
    assert.ok(tries < 50, 'Back up now wrote backup.json again');
    await page.waitForTimeout(100);
  }
  assert.equal(await lastModified(page, boardFile), written);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByPlaceholder("Type the math problem you're working on...").fill('Find x when 2x + 3 = 9');
  await page.getByText('Saved', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  await page.getByRole('button', { name: 'Back up now' }).click();
  await page.waitForFunction(async (path) => {
    let directory = await navigator.storage.getDirectory();
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    return (await (await directory.getFileHandle(parts.at(-1))).getFile()).text().then((text) => text.includes('2x + 3 = 9'));
  }, boardFile);
  await page.getByRole('button', { name: 'Done' }).click();

  // The folder is remembered across visits.
  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Backup' }).click();
  await page.getByText(/Backing up to Dropbox\/Math Tutor backup/).waitFor();
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByRole('button', { name: 'Choose folder…' }).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
  console.log('PASS automatic backup writes backup.json, each board, a dated copy and the PDFs to the chosen folder, and rewrites only changed boards');

  // A new device (an empty browser): restoring the ZIP brings the board and the PDF back. The page
  // reloads so it can't save what it showed before over the restored work, then shows the result.
  const fresh = await openPage();
  try {
    await fresh.page.goto(`${origin}/`);
    await fresh.page.getByRole('button', { name: 'Settings' }).click();
    await fresh.page.getByRole('tab', { name: 'Backup' }).click();
    await fresh.page.getByTestId('restore-file').setInputFiles(zip.path);
    await fresh.page.getByText('Restored 1 board, 1 PDF and 1 folder.').waitFor();
    await fresh.page.getByTestId('restore-file').setInputFiles(zip.path);
    await fresh.page.getByText('Nothing to restore: this device already has everything in the backup.').waitFor();

    // A backup folder with dated copies asks which day to restore it as.
    const backupDir = join(folder, 'Math Tutor backup');
    await mkdir(join(backupDir, 'boards'), { recursive: true });
    for (const [path, blob] of zipEntries) {
      if (path.startsWith('pdfs/')) continue;
      await writeFile(join(backupDir, path), Buffer.from(await blob.arrayBuffer()));
    }
    await writeFile(join(backupDir, 'backup-2026-10-14.json'), Buffer.from(await zipEntries.get('backup.json').arrayBuffer()));
    await fresh.page.getByTestId('restore-folder').setInputFiles(backupDir);
    const dayChoice = fresh.page.getByLabel('Restore this folder as it was');
    assert.deepEqual(await dayChoice.locator('option').allInnerTexts(), ['At its latest backup', `At the end of ${new Date('2026-10-14T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`]);
    await dayChoice.selectOption('2026-10-14');
    await fresh.page.getByRole('button', { name: 'Restore', exact: true }).click();
    await fresh.page.getByText('Nothing to restore: this device already has everything in the backup.').waitFor();
    await fresh.page.getByRole('button', { name: 'Done' }).click();
    await fresh.page.reload();
    await fresh.page.getByText('Find x when 2x + 3 = 7 (check it)').first().waitFor();
    await fresh.page.goto(`${origin}/`);
    await fresh.page.getByRole('link', { name: 'Open Geometry' }).click();
    await fresh.page.getByRole('link', { name: 'Start reading' }).click();
    await fresh.page.getByRole('button', { name: 'Page 1 of 1. Go to a page', exact: true }).waitFor();

    // The saved board PDF is a real PDF: it goes in the library like any other.
    await fresh.page.goto(`${origin}/`);
    await fresh.page.locator('input[aria-label="Add a PDF"]').setInputFiles(pdf.path);
    await fresh.page.getByRole('heading', { name: 'Find x when 2x + 3 = 7', exact: true }).waitFor();
    await fresh.page.getByText(/1 page$/).waitFor();
  } finally {
    await fresh.context.close();
  }
  console.log('PASS restoring the ZIP on an empty browser brings back the board and the PDF; a backup folder asks which day');

  assert.deepEqual(browserErrors, []);
  console.log('PASS no browser exceptions');
} finally {
  await context.close();
  await browser.close();
  await rm(folder, { recursive: true, force: true });
}
