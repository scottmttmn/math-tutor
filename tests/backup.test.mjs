import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const { crc32, writeZip, readZip } = load('src/lib/zip.ts');

// The database is replaced by a recorder: restore logic is tested on what it would write.
const written = [];
const db = {
  listSessions: async () => [], listShelf: async () => [],
  restoreRecords: async (sessions, shelf, profile) => {
    written.push({ sessions, shelf, profile });
    return { sessions: sessions.map((s) => s.id), shelf: shelf.filter((d) => d.file).map((d) => d.id), profile: Boolean(profile), skipped: 0, missingPdfs: shelf.filter((d) => !d.file).map((d) => d.title) };
  },
};
const backup = load('src/lib/backup.ts', { '@/lib/db': db });
const { backupDue } = load('src/lib/autoBackup.ts', { '@/lib/db': db, '@/lib/backup': backup });
const { jpegInfo, jpegToPdf, exportFileName } = load('src/lib/exportBoard.ts', { '@/lib/backup': {} });

const session = (overrides) => ({
  id: 'a', title: 'Untitled', problemStatement: '', problemImage: null, canvasStrokes: [], canvasDocument: null,
  canvasImageBlob: null, chatHistory: [], createdAt: 1, updatedAt: 1, ...overrides,
});
const shelfDocument = (overrides) => ({
  id: 'doc1', title: 'Book', file: new Blob(['%PDF-1.4 book'], { type: 'application/pdf' }), pageCount: 3, cover: null,
  lastPage: 2, exercises: [{ id: 'ex1', label: 'Exercise 1', page: 2, rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.1 }, createdAt: 5 }],
  createdAt: 1, updatedAt: 9, ...overrides,
});
const asFile = (blob, name, relativePath) => {
  const file = new File([blob], name);
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('a ZIP reads back the files written into it, names and bytes intact', async () => {
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7) & 0xff);
  const files = new Map([['backup.json', new Blob(['{"a":1}'])], ['pdfs/ünï.pdf', new Blob([bytes])], ['empty.txt', new Blob([])]]);
  const read = await readZip(await writeZip(files));
  assert.deepEqual([...read.keys()], [...files.keys()]);
  assert.equal(await read.get('backup.json').text(), '{"a":1}');
  assert.deepEqual(new Uint8Array(await read.get('pdfs/ünï.pdf').arrayBuffer()), bytes);
  assert.equal(read.get('empty.txt').size, 0);
  await assert.rejects(readZip(new Blob(['not a zip at all, just some text that is long enough'])), /Not a ZIP/);
});

test('a ZIP with a damaged entry is refused, not restored', async () => {
  const zip = new Uint8Array(await (await writeZip(new Map([['backup.json', new Blob(['{"sessions":[]}'])]]))).arrayBuffer());
  zip[30 + 'backup.json'.length + 3] ^= 0x01; // One flipped bit in the entry's contents.
  await assert.rejects(readZip(new Blob([zip])), /Damaged ZIP entry: backup.json/);
});

test('a backup carries every board and Shelf PDF, and restores them as they were', async () => {
  const thumbnail = new Blob([new Uint8Array([137, 80, 78, 71, 0, 255])], { type: 'image/png' });
  const cover = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
  const { manifest, pdfs } = await backup.buildBackup(
    [session({ id: 'board-1', canvasImageBlob: thumbnail, customTitle: 'Named' }), session({ id: 'shelf:doc1:ex1' })],
    [shelfDocument({ cover })],
  );
  assert.equal(manifest.app, 'math-tutor');
  assert.equal(manifest.sessions[0].canvasImage.startsWith('data:image/png;base64,'), true);
  assert.equal('canvasImageBlob' in manifest.sessions[0], false);
  assert.equal('file' in manifest.shelf[0], false);
  assert.deepEqual([...pdfs.keys()], ['pdfs/doc1.pdf']);

  // Through JSON and a ZIP, as a download would go.
  const zip = await writeZip(new Map([['backup.json', new Blob([JSON.stringify(manifest)])], ...pdfs]));
  written.length = 0;
  const result = await backup.restoreFromFiles([asFile(zip, 'math-tutor-backup-2026-10-14.zip')]);
  assert.deepEqual(result, { restoredSessions: 2, restoredShelf: 1, restoredProfile: false, skipped: 0, missingPdfs: [] });
  const [{ sessions, shelf }] = written;
  assert.equal(sessions[0].customTitle, 'Named');
  assert.deepEqual(new Uint8Array(await sessions[0].canvasImageBlob.arrayBuffer()), new Uint8Array(await thumbnail.arrayBuffer()));
  assert.equal(sessions[0].canvasImageBlob.type, 'image/png');
  assert.equal(sessions[1].canvasImageBlob, null);
  assert.equal(await shelf[0].file.text(), '%PDF-1.4 book');
  assert.equal(shelf[0].file.type, 'application/pdf');
  assert.deepEqual(shelf[0].exercises, shelfDocument({}).exercises);
  assert.deepEqual(new Uint8Array(await shelf[0].cover.arrayBuffer()), new Uint8Array([1, 2, 3]));
});

test('a backup folder restores from its files: backup.json over the dated copies, PDFs from pdfs/', async () => {
  const { manifest } = await backup.buildBackup([session({ id: 'board-1', updatedAt: 2 })], [shelfDocument({})]);
  const older = { ...manifest, sessions: [] };
  written.length = 0;
  const result = await backup.restoreFromFiles([
    asFile(new Blob([JSON.stringify(older)]), 'backup-2026-10-13.json', 'Math Tutor backup/backup-2026-10-13.json'),
    asFile(new Blob([JSON.stringify(manifest)]), 'backup.json', 'Math Tutor backup/backup.json'),
    asFile(new Blob(['%PDF folder']), 'doc1.pdf', 'Math Tutor backup/pdfs/doc1.pdf'),
  ]);
  assert.equal(result.restoredSessions, 1);
  assert.equal(await written[0].shelf[0].file.text(), '%PDF folder');

  // backup.json alone: the PDF isn't there, so that Shelf entry can't come back on a new device.
  const alone = await backup.restoreFromFiles([asFile(new Blob([JSON.stringify(manifest)]), 'backup.json')]);
  assert.deepEqual(alone.missingPdfs, ['Book']);
});

test('the tutor memory goes into the backup and comes back; a malformed one is left out', async () => {
  const profile = { aboutMe: 'Self-taught', topics: [{ id: 'calculus/limits', name: 'Limits', area: 'Calculus', rating: 'solid' }], shareWithTutor: false, updatedAt: 7 };
  const { manifest } = await backup.buildBackup([], [], profile);
  assert.deepEqual(manifest.profile, profile);
  assert.equal((await backup.buildBackup([], [])).manifest.profile, undefined);
  written.length = 0;
  const result = await backup.restoreFromFiles([asFile(new Blob([JSON.stringify(manifest)]), 'backup.json')]);
  assert.equal(result.restoredProfile, true);
  assert.deepEqual(written[0].profile, profile);
  written.length = 0;
  await backup.restoreFromFiles([asFile(new Blob([JSON.stringify({ ...manifest, profile: { aboutMe: 3 } })]), 'backup.json')]);
  assert.equal(written[0].profile, undefined);
  // Malformed topics are dropped; the rest of the memory comes back.
  written.length = 0;
  await backup.restoreFromFiles([asFile(new Blob([JSON.stringify({ ...manifest, profile: { ...profile, topics: [null, { id: 1 }, { ...profile.topics[0], rating: 'great' }, ...profile.topics] } })]), 'backup.json')]);
  assert.deepEqual(written[0].profile, profile);
  // The tutor's notes come back too; a malformed note is dropped, not its topic.
  const note = { level: 'rusty', confidence: 'medium', note: 'Sign errors', updatedAt: 5, edited: true };
  const noted = { ...profile, topics: [{ ...profile.topics[0], tutor: note }, { id: 'calculus/derivatives', name: 'Derivatives', area: 'Calculus', rating: null, tutor: { ...note, confidence: 'very' } }] };
  written.length = 0;
  await backup.restoreFromFiles([asFile(new Blob([JSON.stringify({ ...manifest, profile: noted })]), 'backup.json')]);
  assert.deepEqual(written[0].profile.topics, [noted.topics[0], { id: 'calculus/derivatives', name: 'Derivatives', area: 'Calculus', rating: null }]);
  assert.notEqual(backup.backupFingerprint([], [], profile), backup.backupFingerprint([], [], { updatedAt: 8 }));
  assert.notEqual(backup.backupFingerprint([], [], profile), backup.backupFingerprint([], []));
});

test('restore refuses files that are not a backup', async () => {
  await assert.rejects(backup.restoreFromFiles([asFile(new Blob(['{"hello":1}']), 'notes.json')]), /not a Math Tutor backup/);
  await assert.rejects(backup.restoreFromFiles([asFile(new Blob(['nope']), 'backup.json')]), /damaged/);
  await assert.rejects(backup.restoreFromFiles([asFile(new Blob(['x']), 'picture.png')]), /Pick the backup ZIP/);
  const zipWithout = await writeZip(new Map([['other.txt', new Blob(['x'])]]));
  await assert.rejects(backup.restoreFromFiles([asFile(zipWithout, 'other.zip')]), /not a Math Tutor backup/);
});

test('the fingerprint changes with any change, a rename included', () => {
  const base = backup.backupFingerprint([session({ id: 'a' }), session({ id: 'b' })], [shelfDocument({})]);
  assert.equal(backup.backupFingerprint([session({ id: 'b' }), session({ id: 'a' })], [shelfDocument({})]), base);
  assert.notEqual(backup.backupFingerprint([session({ id: 'a', customTitle: 'x' }), session({ id: 'b' })], [shelfDocument({})]), base);
  assert.notEqual(backup.backupFingerprint([session({ id: 'a', updatedAt: 2 }), session({ id: 'b' })], [shelfDocument({})]), base);
  assert.notEqual(backup.backupFingerprint([session({ id: 'a' })], [shelfDocument({})]), base);
  assert.notEqual(backup.backupFingerprint([session({ id: 'a' }), session({ id: 'b' })], []), base);
});

test('a backup is suggested only when there is work and none was backed up in the last week', () => {
  const day = 24 * 60 * 60 * 1000;
  const status = { hasWork: true, state: 'off', lastBackupAt: null, lastDownloadAt: null };
  const now = 100 * day;
  assert.equal(backupDue(status, now), true);
  assert.equal(backupDue({ ...status, hasWork: false }, now), false);
  assert.equal(backupDue({ ...status, lastDownloadAt: now - 2 * day }, now), false);
  assert.equal(backupDue({ ...status, lastDownloadAt: now - 8 * day }, now), true);
  assert.equal(backupDue({ ...status, state: 'ok' }, now), false);
});

// A JPEG's headers only (no image data): enough for the PDF writer, which never decodes it.
function jpegHeader(width, height) {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  ]);
}

test('the PDF of a board is one page the size of the picture, with a valid cross-reference table', async () => {
  const jpeg = jpegHeader(1600, 900);
  assert.deepEqual(jpegInfo(jpeg), { width: 1600, height: 900, components: 3 });
  const pdf = jpegToPdf(jpeg, 2);
  assert.equal(pdf.type, 'application/pdf');
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  assert.match(text, /^%PDF-1\.4/);
  // 800 x 450 CSS pixels at 0.75 points each.
  assert.match(text, /\/MediaBox \[0 0 600 337\.5\]/);
  assert.match(text, /\/Width 1600 \/Height 900 \/ColorSpace \/DeviceRGB/);
  const xrefAt = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(xrefAt, xrefAt + 4), 'xref');
  const offsets = [...text.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((match) => Number(match[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, index) => assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`));
  // The image stream holds the JPEG byte for byte.
  const start = text.indexOf('stream\n', text.indexOf('4 0 obj')) + 'stream\n'.length;
  assert.deepEqual(bytes.slice(start, start + jpeg.length), jpeg);
  assert.throws(() => jpegInfo(new Uint8Array([1, 2, 3])), /Not a JPEG/);
});

test('saved board files are named after the board', () => {
  assert.equal(exportFileName('Find x: 2x + 3 = 7\nmore', 'png'), 'Find x 2x + 3 = 7.png');
  assert.equal(exportFileName('  ', 'pdf'), 'Board.pdf');
  assert.equal(exportFileName('a/b\\c', 'pdf'), 'a b c.pdf');
});
