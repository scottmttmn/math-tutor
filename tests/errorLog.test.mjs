import test from 'node:test';
import assert from 'node:assert/strict';
import load from './load-typescript.mjs';

const store = new Map();
const db = {
  getSetting: async (key) => store.get(key),
  setSetting: async (key, value) => (value === undefined ? store.delete(key) : store.set(key, value)),
};
const capacitor = { registerPlugin: () => ({}), Capacitor: { isNativePlatform: () => false } };
const { withEntry, parseNativeLog, recordError, listErrors, clearErrors, errorLogText, MAX_ERRORS, REPEAT_MS } = load('src/lib/errorLog.ts', {
  '@capacitor/core': capacitor,
  '@/lib/db': db,
  '@/lib/constants': { APP_BUILD: '300' },
});

const entry = (at, message, kind = 'error') => ({ at, kind, message });

test('entries are kept in time order, the newest MAX_ERRORS', () => {
  let log = [];
  for (let i = 0; i < MAX_ERRORS + 5; i++) log = withEntry(log, entry(i * REPEAT_MS, `e${i}`));
  assert.equal(log.length, MAX_ERRORS);
  assert.equal(log[0].message, 'e5');
  assert.equal(withEntry([entry(10, 'later')], entry(5, 'earlier'))[0].message, 'earlier');
});

test('the same error again soon after is left out, later it is kept', () => {
  const log = [entry(1000, 'Boom')];
  assert.equal(withEntry(log, entry(1000 + REPEAT_MS - 1, 'Boom')), log);
  assert.equal(withEntry(log, entry(1000 + 10, 'Boom', 'promise')).length, 2);
  assert.equal(withEntry(log, entry(1000 + REPEAT_MS, 'Boom')).length, 2);
  assert.equal(withEntry(log, entry(2000, 'ResizeObserver loop completed with undelivered notifications.')), log);
});

test('the native log is read line by line, skipping a cut-off line', () => {
  const lines = [
    JSON.stringify({ at: 5, kind: 'crash', message: 'java.lang.IllegalStateException: x', detail: 'at Foo', build: '299' }),
    '{"at": 6, "kind": "page-pro',
    JSON.stringify({ at: 7, kind: 'page-process', message: 'The page’s process crashed' }),
    '',
  ].join('\n');
  assert.deepEqual(parseNativeLog(lines), [
    { at: 5, kind: 'crash', message: 'java.lang.IllegalStateException: x', detail: 'at Foo', build: '299' },
    { at: 7, kind: 'page-process', message: 'The page’s process crashed' },
  ]);
});

test('recorded errors are stored with the build, and clear empties the log', async () => {
  await recordError({ kind: 'error', message: 'A', page: '/board' });
  await recordError({ kind: 'promise', message: 'B', detail: 'stack' });
  const log = await listErrors();
  assert.deepEqual(log.map((e) => [e.kind, e.message, e.build]), [['error', 'A', '300'], ['promise', 'B', '300']]);
  await clearErrors();
  assert.deepEqual(await listErrors(), []);
});

test('the text to send lists the newest first with build, page and detail', () => {
  const text = errorLogText(
    [{ at: 0, kind: 'crash', message: 'Old', build: '299' }, { at: 60000, kind: 'error', message: 'New', page: '/board', detail: 'at x' }],
    { build: '300', userAgent: 'Tablet', now: 120000 },
  );
  assert.match(text, /Build: 300\nDevice: Tablet\nEntries: 2/);
  assert.ok(text.indexOf('New') < text.indexOf('Old'));
  assert.match(text, /Page error \(error\): New\nPage: \/board\nat x/);
  assert.match(text, /App crashed \(crash\): Old\nBuild: 299/);
});
