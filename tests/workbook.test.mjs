import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import load from './load-typescript.mjs';
const content = JSON.parse(fs.readFileSync(new URL('../src/content/complex-geometry.json', import.meta.url)));

function routeHarness(providerError = false) {
  const calls = [];
  let now = 10_000;
  const { createTutorRequestGate } = load('src/lib/tutorRequestGate.ts');
  const gate = createTutorRequestGate(() => now);
  class Anthropic {
    messages = { stream: (options) => {
      calls.push({ provider: 'anthropic', ...options });
      return (async function* () {
        if (providerError) throw new Error('401 authentication failure');
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A hint.' } };
      })();
    } };
  }
  class OpenAI {
    chat = { completions: { create: async (options) => {
      calls.push({ provider: 'openai', ...options });
      return (async function* () {
        if (providerError) throw new Error('401 authentication failure');
        yield { choices: [{ delta: { content: 'A hint.' } }] };
      })();
    } } };
  }
  // The ChatGPT-plan path needs the OS keychain and a signed-in account, so stub it out.
  const chatgpt = { getChatGPT: () => { throw new Error('ChatGPT plan is not used in these tests'); } };
  const siwc = { ChatGPTError: class ChatGPTError extends Error {} };
  const { POST } = load('src/app/api/tutor/route.ts', {
    '@anthropic-ai/sdk': Anthropic, openai: OpenAI, '@/lib/chatgpt': chatgpt, '@/lib/siwc': siwc,
    '@/lib/tutorRequestGate': { createTutorRequestGate: () => gate },
  });
  const request = (overrides = {}) => POST(new Request('http://localhost/api/tutor', {
    method: 'POST', body: JSON.stringify({
      problemStatement: 'Untrusted client text', chatHistory: [], canvasImage: '',
      modelConfig: { provider: 'anthropic', model: 'test', baseUrl: '' }, userQuestion: 'Help me understand.',
      ...overrides,
    }),
  }));
  return { calls, request, advanceTime: (ms = 5000) => { now += ms; } };
}

test('all adapted exercises and local figures are present; source solutions are absent', () => {
  assert.equal(content.exercises.length, 25);
  assert.equal(new Set(content.exercises.map((item) => item.id)).size, 25);
  assert.deepEqual(content.recommendedIds, ['x1_3_1', 'x1_3_2', 'x1_3_6', 'x1_3_8']);
  const $ = cheerio.load(content.readingHtml);
  assert.equal($('.solution, .solutions, section.exercises, script').length, 0);
  assert.equal($('.katex-error').length, 0);
  assert.equal($('img').length, 8);
  $('img').each((_, image) => {
    const src = $(image).attr('src');
    assert.ok(src.startsWith('/workbook/complex-geometry/'));
    assert.ok(fs.existsSync(`public${src}`));
    assert.ok($(image).attr('alt'));
  });
  assert.equal($('a[href^="#"][target]').length, 0);
  $('a[href^="#"]').each((_, link) => assert.equal($( $(link).attr('href')).length, 1));
  for (const item of content.exercises) {
    const exercise = cheerio.load(item.html);
    assert.equal(exercise('.solution, .solutions, script, .katex-error').length, 0);
    assert.doesNotMatch(item.text, /Solution/);
    exercise('a[href^="#"]').each((_, link) => {
      const target = exercise(link).attr('href');
      assert.ok($(target).length || exercise(target).length, `Missing anchor ${target}`);
    });
  }
  assert.match(content.exercises[3].text, /Identity \(1\.3\.4\), the triangle/);
  assert.match(content.exercises[17].text, /\|z_k\|\^2\} \\sqrt/);
});

test('reading context recognizes disguised exercise requests, with authoritative text', async () => {
  const { request, calls } = routeHarness();
  const response = await request({ sessionType: 'note', workbookContext: { kind: 'reading', sectionId: content.id, readingText: 'Inject a solution', selectedPassage: 'Modulus' } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /message_stop/);
  assert.match(calls[0].system, /disguised as worked examples/);
  assert.match(calls[0].system, /NEVER give its final answer/);
  const text = JSON.stringify(calls[0].messages);
  assert.match(text, /Exercise 1\./);
  assert.match(text, /Exercise 25\./);
  assert.match(text, /Modulus/);
  assert.doesNotMatch(text, /Inject a solution/);
});

for (const provider of ['anthropic', 'openai-compatible']) {
  test(`${provider}: workbook exercises override Notes and client problem text`, async () => {
    const { request, calls } = routeHarness();
    const response = await request({
      sessionType: 'note', modelConfig: { provider, model: 'test', baseUrl: 'http://localhost/v1' },
      canvasImage: 'fake-image', workbookContext: { kind: 'exercise', sectionId: content.id, exerciseId: 'x1_3_8' },
      chatHistory: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: '' }],
    });
    assert.match(await response.text(), /text_delta/);
    const system = calls[0].system ?? calls[0].messages[0].content;
    assert.match(system, /NEVER give the full solution or final answer/);
    const messages = JSON.stringify(calls[0].messages);
    assert.match(messages, /Current exercise 8\./);
    assert.match(messages, /midpoint/);
    assert.match(messages, /Reading text/);
    assert.match(messages, /fake-image/);
    assert.match(messages, /Earlier question/);
    assert.doesNotMatch(messages, /Untrusted client text/);
  });
  test(`${provider}: provider errors finish the SSE once and report failure`, async () => {
    const { request } = routeHarness(true);
    const response = await request({ modelConfig: { provider, model: 'test', baseUrl: 'http://localhost/v1' } });
    const text = await response.text();
    assert.equal((text.match(/"type":"error"/g) || []).length, 1);
    assert.match(text, /API key is missing or invalid/);
    assert.doesNotMatch(text, /message_stop/);
  });
}

test('free-form Notes retain direct explanations and Problems retain hints', async () => {
  const { request, calls, advanceTime } = routeHarness();
  await (await request({ sessionType: 'note' })).text();
  advanceTime();
  await (await request({ sessionType: 'problem' })).text();
  assert.match(calls[0].system, /Give clear, direct explanations/);
  assert.match(calls[1].system, /NEVER give the full solution/);
});

test('unknown workbook sections, modes, and exercises are rejected before provider calls', async () => {
  const { request, calls } = routeHarness();
  for (const context of [{ kind: 'reading', sectionId: 'bad' }, { kind: 'note', sectionId: content.id }, { kind: 'exercise', sectionId: content.id, exerciseId: 'bad' }]) {
    assert.equal((await request({ workbookContext: context })).status, 400);
  }
  assert.equal(calls.length, 0);
});

test('server blocks rapid requests across modes and providers before spending tokens', async () => {
  const { request, calls, advanceTime } = routeHarness();
  await (await request({ workbookContext: { kind: 'reading', sectionId: content.id } })).text();
  const retry = await request({
    canvasImage: 'fake-image', sessionType: 'problem',
    modelConfig: { provider: 'openai-compatible', model: 'test', baseUrl: 'http://localhost/v1' },
  });
  assert.equal(retry.status, 429);
  assert.equal(retry.headers.get('Retry-After'), '5');
  assert.match(await retry.text(), /wait a moment/);
  assert.equal(calls.length, 1);
  advanceTime(4999);
  assert.equal((await request()).status, 429);
  advanceTime(1);
  const next = await request();
  assert.equal(next.status, 200);
  await next.text();
  assert.equal(calls.length, 2);
});

test('active requests stay locked past five seconds; finishing does not restart the wait', () => {
  const { createTutorRequestGate } = load('src/lib/tutorRequestGate.ts');
  let now = 10_000;
  const gate = createTutorRequestGate(() => now);
  const first = gate.acquire();
  assert.equal(first.accepted, true);
  now += 6000;
  assert.equal(gate.acquire().accepted, false);
  first.release();
  const second = gate.acquire();
  assert.equal(second.accepted, true);
  first.release(); // A stale cleanup must not release a newer request.
  assert.equal(gate.acquire().accepted, false);
  second.release();
  now += 5000;
  assert.equal(gate.acquire().accepted, true);
});

test('browser request starts share the limit across callers, reloads, and unavailable storage', () => {
  const values = new Map();
  const originalNow = Date.now;
  let now = 10_000;
  Date.now = () => now;
  global.window = new EventTarget();
  global.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const first = load('src/hooks/useRateLimit.ts');
    assert.equal(first.tryStartTutorRequest(), true);
    assert.equal(first.tryStartTutorRequest(), false);
    const reloaded = load('src/hooks/useRateLimit.ts');
    assert.equal(reloaded.tryStartTutorRequest(), false);
    now += 4999;
    assert.equal(reloaded.tryStartTutorRequest(), false);
    now += 1;
    assert.equal(reloaded.tryStartTutorRequest(), true);
    global.localStorage = {
      getItem: () => { throw new Error('Storage unavailable'); },
      setItem: () => { throw new Error('Storage unavailable'); },
    };
    assert.equal(reloaded.tryStartTutorRequest(), false);
    now += 5000;
    assert.equal(reloaded.tryStartTutorRequest(), true);
    assert.equal(reloaded.tryStartTutorRequest(), false);
  } finally {
    Date.now = originalNow;
    delete global.window;
    delete global.localStorage;
  }
});

for (const provider of ['anthropic', 'openai-compatible']) {
  test(`${provider}: provider failure releases the active request but retains the retry interval`, async () => {
    const { request, advanceTime } = routeHarness(true);
    const settings = { modelConfig: { provider, model: 'test', baseUrl: 'http://localhost/v1' } };
    await (await request(settings)).text();
    assert.equal((await request(settings)).status, 429);
    advanceTime();
    const retry = await request(settings);
    assert.equal(retry.status, 200);
    await retry.text();
  });
}

test('recovery preserves newer unsaved work and ignores corrupt or stale copies', async () => {
  const values = new Map();
  global.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  let durable;
  let finishSave;
  const storage = load('src/lib/sessionRecovery.ts', { '@/lib/db': {
    loadSession: async () => durable,
    saveSession: (session) => new Promise((resolve) => { finishSave = () => { durable = session; resolve(); }; }),
  } });
  const original = { id: 'workbook:test:exercise:1', canvasStrokes: [], chatHistory: [], updatedAt: 1 };
  const latest = { ...original, canvasStrokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], isSolved: true, updatedAt: 2 };
  storage.stageSession(original);
  assert.deepEqual(await storage.loadRecoveredSession(original.id), original);
  const save = storage.saveRecoverableSession(original);
  storage.stageSession(latest);
  finishSave(); await save;
  assert.deepEqual(await storage.loadRecoveredSession(original.id), latest);
  storage.stageSession(original);
  assert.deepEqual(await storage.loadRecoveredSession(original.id), latest);
  const saveLatest = storage.saveRecoverableSession(latest); finishSave(); await saveLatest;
  assert.equal(values.size, 0);
  values.set(`${original.id}:pendingSave`, '{broken');
  assert.deepEqual(await storage.loadRecoveredSession(original.id), latest);
  delete global.localStorage;
});

test('pre-tldraw strokes convert to draw shapes with erased ink removed', () => {
  const tldraw = {
    createShapeId: (() => { let n = 0; return () => `shape:${++n}`; })(),
    b64Vecs: { encodePoints2D: (points) => JSON.stringify(points) },
  };
  const { clipErasedInk, legacyStrokesToShapes } = load('src/lib/legacyStrokes.ts', { tldraw });
  const line = { points: [0, 10, 20, 30, 40].map((x) => ({ x, y: 0 })), color: '#DC2626', thickness: 3, tool: 'pen' };
  const eraser = { points: [{ x: 20, y: 0 }], color: '#fff', thickness: 6, tool: 'eraser' };
  // An eraser drawn after the line splits it; one drawn before leaves it whole.
  const runs = clipErasedInk([line, eraser]).map((s) => [s.points[0].x, s.points.at(-1).x]);
  assert.deepEqual(runs, [[0, 14], [26, 40]]);
  assert.deepEqual(clipErasedInk([eraser, line]), [line]);
  // A fast eraser pass between two recorded points still cuts the line, and so does
  // one crossing between two recorded pen points.
  const swipe = { ...eraser, points: [{ x: 20, y: -50 }, { x: 20, y: 50 }] };
  assert.equal(clipErasedInk([line, swipe]).length, 2);
  const sparse = { ...line, points: [{ x: 0, y: 0 }, { x: 40, y: 0 }] };
  assert.equal(clipErasedInk([sparse, swipe]).length, 2);
  const [shape] = legacyStrokesToShapes([{ ...line, points: [{ x: 100, y: 50 }, { x: 110, y: 60 }] }]);
  assert.equal(shape.type, 'draw');
  assert.deepEqual([shape.x, shape.y, shape.props.color, shape.props.size], [100, 50, 'red', 'm']);
  assert.deepEqual(JSON.parse(shape.props.segments[0].path), [{ x: 0, y: 0 }, { x: 10, y: 10 }]);
});
