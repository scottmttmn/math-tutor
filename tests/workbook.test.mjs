import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as cheerio from 'cheerio';
import load from './load-typescript.mjs';
const content = JSON.parse(fs.readFileSync(new URL('../src/content/complex-geometry.json', import.meta.url)));

function routeHarness(providerError = false) {
  const calls = [];
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
  });
  const request = (overrides = {}) => POST(new Request('http://localhost/api/tutor', {
    method: 'POST', body: JSON.stringify({
      problemStatement: 'Untrusted client text', chatHistory: [], canvasImage: '',
      modelConfig: { provider: 'anthropic', model: 'test', baseUrl: '' }, userQuestion: 'Help me understand.',
      ...overrides,
    }),
  }));
  return { calls, request };
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
  const { request, calls } = routeHarness();
  await (await request({ sessionType: 'note' })).text();
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

test('recovery preserves newer unsaved work and ignores corrupt or stale copies', async () => {
  const values = new Map();
  global.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  let durable;
  let finishSave;
  const storage = load('src/lib/workbookStorage.ts', { '@/lib/db': {
    loadSession: async () => durable,
    saveSession: (session) => new Promise((resolve) => { finishSave = () => { durable = session; resolve(); }; }),
  } });
  const original = { id: 'workbook:test:exercise:1', canvasStrokes: [], chatHistory: [], updatedAt: 1 };
  const latest = { ...original, canvasStrokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }], isSolved: true, updatedAt: 2 };
  storage.stageWorkbookSession(original);
  assert.deepEqual(await storage.loadWorkbookSession(original.id), original);
  const save = storage.saveWorkbookSession(original);
  storage.stageWorkbookSession(latest);
  finishSave(); await save;
  assert.deepEqual(await storage.loadWorkbookSession(original.id), latest);
  storage.stageWorkbookSession(original);
  assert.deepEqual(await storage.loadWorkbookSession(original.id), latest);
  const saveLatest = storage.saveWorkbookSession(latest); finishSave(); await saveLatest;
  assert.equal(values.size, 0);
  values.set(`${original.id}:pendingSave`, '{broken');
  assert.deepEqual(await storage.loadWorkbookSession(original.id), latest);
  delete global.localStorage;
});

test('canvas snapshots are trimmed to the inked area, ignoring eraser strokes', () => {
  const { drawingBounds } = load('src/lib/drawingBounds.ts');
  const pen = (points, thickness = 4) => ({ points, color: '#000', thickness, tool: 'pen' });
  const eraser = { points: [{ x: 0, y: 0 }, { x: 900, y: 2900 }], color: '#fff', thickness: 20, tool: 'eraser' };
  assert.equal(drawingBounds([], 800, 3000), null);
  assert.equal(drawingBounds([eraser], 800, 3000), null);
  assert.deepEqual(
    drawingBounds([pen([{ x: 100, y: 200 }, { x: 300, y: 260 }]), eraser], 800, 3000),
    { startX: 74, startY: 174, width: 252, height: 112 },
  );
  // Ink near the edge is clamped to the canvas.
  assert.deepEqual(drawingBounds([pen([{ x: 5, y: 2990 }])], 800, 3000), { startX: 0, startY: 2964, width: 31, height: 36 });
});
