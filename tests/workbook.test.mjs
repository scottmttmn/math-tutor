import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import load from './load-typescript.mjs';
const content = JSON.parse(fs.readFileSync(new URL('../src/content/complex-geometry.json', import.meta.url)));

test('Gemini quotas skip blocked models and reset daily quotas at Pacific midnight', () => {
  const { createGeminiFallback } = load('src/lib/geminiFallback.ts');
  let now = Date.parse('2026-09-30T06:59:00Z'); // 11:59pm Pacific.
  const router = createGeminiFallback(() => now);
  router.exhausted('gemini-3.8-flash', new Error('GenerateRequestsPerDayPerProjectPerModel'));
  assert.equal(router.candidates('gemini-3.8-flash')[0], 'gemini-3.7-flash');
  now += 60_000;
  assert.equal(router.candidates('gemini-3.8-flash')[0], 'gemini-3.8-flash');
  router.exhausted('gemini-3.8-flash', new Error('minute quota'));
  now += 59_999;
  assert.equal(router.candidates('gemini-3.8-flash')[0], 'gemini-3.7-flash');
  now += 1;
  assert.equal(router.candidates('gemini-3.8-flash')[0], 'gemini-3.8-flash');
  assert.deepEqual(router.candidates('my-custom-model'), ['my-custom-model']);
});

for (const scenario of ['quota', 'all exhausted', 'authentication', 'partial']) {
  test(`Gemini fallback: ${scenario}`, async () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    const failure = (status) => Object.assign(new Error('Provider error'), { status });
    try {
      const { request, calls, clients, advanceTime } = routeHarness(false, (options, attempt) => (async function* () {
        if (scenario === 'authentication') throw failure(401);
        if (scenario === 'partial') { yield { choices: [{ delta: { content: 'Partial' } }] }; throw failure(429); }
        if (scenario === 'all exhausted' || attempt === 1) throw failure(429);
        yield { choices: [{ delta: { content: 'Fallback hint.' } }] };
      })());
      const settings = { modelConfig: { provider: 'openai-compatible', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' }, workbookContext: { kind: 'exercise', sectionId: content.id, exerciseId: 'x1_3_8' }, canvasImage: 'fake-image' };
      const text = await (await request(settings)).text();
      assert.equal(clients[0].maxRetries, 0);
      if (scenario === 'quota') {
        assert.deepEqual(calls.map((call) => call.model), ['gemini-3.8-flash', 'gemini-3.7-flash']);
        assert.match(text, /"type":"model","model":"gemini-3.7-flash"/);
        assert.match(text, /message_stop/);
        assert.deepEqual(calls[0].messages, calls[1].messages);
        assert.match(calls[1].messages[0].content, /NEVER give the full solution/);
        advanceTime();
        await (await request(settings)).text();
        assert.equal(calls[2].model, 'gemini-3.7-flash');
      } else if (scenario === 'all exhausted') {
        assert.equal(calls.length, 6);
        assert.match(text, /Gemini quota is exhausted/);
        advanceTime();
        await (await request(settings)).text();
        assert.equal(calls.length, 6);
      } else {
        assert.equal(calls.length, 1);
        assert.match(text, /"type":"error"/);
        assert.doesNotMatch(text, /message_stop/);
      }
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previous;
    }
  });
}

function routeHarness(providerError = false, openAIStream) {
  const calls = [];
  const clients = [];
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
    constructor(options) { clients.push(options); }
    chat = { completions: { create: async (options) => {
      calls.push({ provider: 'openai', ...options });
      if (openAIStream) return openAIStream(options, calls.length);
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
  return { calls, clients, request, advanceTime: (ms = 5000) => { now += ms; } };
}

test('saved Gemini preset moves to the current model without changing custom choices', () => {
  const values = new Map();
  global.window = new EventTarget();
  global.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    const { getModelConfig, isGeminiEndpoint, GEMINI_BASE_URL } = load('src/lib/modelConfig.ts');
    const saved = { provider: 'openai-compatible', model: 'gemini-3-flash', baseUrl: GEMINI_BASE_URL };
    values.set('mathTutor_modelConfig', JSON.stringify(saved));
    assert.equal(getModelConfig().model, 'gemini-3.8-flash');
    values.set('mathTutor_modelConfig', JSON.stringify({ ...saved, model: 'gemini-custom' }));
    assert.equal(getModelConfig().model, 'gemini-custom');
    values.set('mathTutor_modelConfig', JSON.stringify({ ...saved, baseUrl: 'https://generativelanguage.googleapis.com.evil.test/v1beta/openai/' }));
    assert.equal(getModelConfig().model, 'gemini-3-flash');
    assert.equal(isGeminiEndpoint(GEMINI_BASE_URL), true);
  } finally {
    delete global.window;
    delete global.localStorage;
  }
});

test('Gemini uses its own key and request options; another compatible provider keeps its settings', async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.GEMINI_API_KEY = 'gemini-test-key';
  delete process.env.GOOGLE_API_KEY;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  try {
    const { request, calls, clients, advanceTime } = routeHarness();
    const response = await request({
      modelConfig: { provider: 'openai-compatible', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
      canvasImage: 'fake-image',
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /message_stop/);
    assert.equal(clients[0].apiKey, 'gemini-test-key');
    assert.equal(calls[0].model, 'gemini-3.8-flash');
    assert.equal(calls[0].reasoning_effort, 'low');
    assert.equal(calls[0].max_tokens, 2048);
    assert.match(JSON.stringify(calls[0].messages), /data:image\/png;base64,fake-image/);

    process.env.GOOGLE_API_KEY = 'google-test-key';
    advanceTime();
    await (await request({ modelConfig: { provider: 'openai-compatible', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' } })).text();
    assert.equal(clients[1].apiKey, 'google-test-key');

    advanceTime();
    await (await request({ modelConfig: { provider: 'openai-compatible', model: 'test', baseUrl: 'http://localhost/v1' } })).text();
    assert.equal(clients[2].apiKey, 'openai-test-key');
    assert.equal(calls[2].reasoning_effort, undefined);
    assert.equal(calls[2].max_tokens, 1024);
  } finally {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
    if (previousGoogle === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = previousGoogle;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
  }
});

test('Gemini reports a missing key instead of sending the OpenAI key', async () => {
  const previousGemini = process.env.GEMINI_API_KEY;
  const previousGoogle = process.env.GOOGLE_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.OPENAI_API_KEY = 'openai-test-key';
  try {
    const { request, calls, clients } = routeHarness();
    const response = await request({ modelConfig: { provider: 'openai-compatible', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/' } });
    assert.equal(response.status, 500);
    assert.match(await response.text(), /GEMINI_API_KEY/);
    assert.equal(clients.length, 0);
    assert.equal(calls.length, 0);
  } finally {
    if (previousGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = previousGemini;
    if (previousGoogle === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = previousGoogle;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
  }
});

test('all adapted exercises and local figures are present; source solutions are absent', () => {
  assert.equal(content.exercises.length, 25);
  assert.equal(new Set(content.exercises.map((item) => item.id)).size, 25);
  assert.deepEqual(content.recommendedIds, ['x1_3_1', 'x1_3_2', 'x1_3_6', 'x1_3_8']);
  const $ = cheerio.load(content.readingHtml);
  assert.equal($('.solution, .solutions, section.exercises, script').length, 0);
  assert.equal($('.katex-error').length, 0);
  assert.doesNotMatch(content.readingHtml, /\\amp\b/);
  assert.doesNotMatch(content.readingText, /\\amp\b/);
  for (const id of ['sec_geometry-1-20-1-1', 'sec_geometry-1-22-1']) {
    assert.equal($(`#${id} .katex-html .mtable`).length, 1, `Missing aligned proof in ${id}`);
    assert.equal($(`#${id} .katex-html [style*="color:#cc0000"]`).length, 0);
  }
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

test('a ChatGPT-plan request releases the server gate when it ends', async () => {
  const { request, advanceTime } = routeHarness();
  const chatgptConfig = { modelConfig: { provider: 'chatgpt', model: 'test', baseUrl: '' } };
  const first = await request(chatgptConfig);
  assert.equal(first.status, 200);
  await first.text();
  advanceTime();
  assert.equal((await request(chatgptConfig)).status, 200);
});

test('a cancelled ChatGPT-plan stream releases the server gate right away', async () => {
  let started;
  const chatgpt = { getChatGPT: () => ({ streamResponse: ({ signal }) => new Promise((_, reject) => {
    started = true;
    signal.addEventListener('abort', () => reject(new Error('cancelled')));
  }) }) };
  const { createTutorRequestGate } = load('src/lib/tutorRequestGate.ts');
  let now = 10_000;
  const gate = createTutorRequestGate(() => now);
  const { POST } = load('src/app/api/tutor/route.ts', {
    '@/lib/chatgpt': chatgpt, '@/lib/siwc': { ChatGPTError: class extends Error {} },
    '@/lib/tutorRequestGate': { createTutorRequestGate: () => gate },
  });
  const response = await POST(new Request('http://localhost/api/tutor', { method: 'POST', body: JSON.stringify({
    problemStatement: '', chatHistory: [], canvasImage: '', userQuestion: 'Help',
    modelConfig: { provider: 'chatgpt', model: 'test', baseUrl: '' },
  }) }));
  assert.ok(started);
  now += 5000;
  assert.equal(gate.acquire().accepted, false);
  await response.body.cancel();
  const next = gate.acquire();
  assert.equal(next.accepted, true);
  next.release();
});
