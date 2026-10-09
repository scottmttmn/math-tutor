// Handwriting test: sends each handwritten page to each model, asks for a LaTeX
// transcription, and scores it against the answer key.
//
//   node scripts/handwriting/run.mjs [--pages <dir with pages.json>] [--images <dir>] \
//     [--models anthropic:claude-sonnet-5-5,gemini:gemini-3.8-flash,chatgpt:luna] [--out <dir>] \
//     [--app http://localhost:3000]
//
// --pages defaults to tests/handwriting, Scott's handwritten set. Images are <page-id>.png in
// --images (default <pages>/wacom). Keys come from .env.local, as for the app.
// ChatGPT-plan models (chatgpt for the plan's default, or chatgpt:<slug or name>) go through the
// running app's /api/transcribe, so start the app (--app) and sign in with ChatGPT first.
// Writes results.json and summary.md to --out (default <pages>/results/<time>).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { scorePage, transcriptionLines } from './score.mjs';

const PROMPT = `Transcribe the handwritten math in this image into LaTeX.
- One output line per equation or statement, top to bottom, in the order written. A matrix,
  cases block or fraction that spans several rows is still one line.
- Output only the LaTeX lines: no $ or \\[ delimiters, no code fences, no commentary.
- Write words as \\text{...}. Leave out anything crossed out.
- If the page has a drawing, add one last line starting with "DIAGRAM:" that describes it.`;

const OPENAI_COMPATIBLE = {
  openai: { baseURL: 'https://api.openai.com/v1', keys: ['OPENAI_API_KEY'] },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  ollama: { baseURL: process.env.NEXT_PUBLIC_OLLAMA_BASE_URL ?? 'http://localhost:11434/v1', keys: [], fallbackKey: 'ollama' },
};

const DEFAULT_MODELS = [
  'anthropic:claude-sonnet-5-5', 'anthropic:claude-opus-5-5', 'gemini:gemini-3.8-flash', 'openai:gpt-4o',
  'chatgpt:luna', 'chatgpt:sol-6.1',
].join(',');

// Thinking models (Gemini 3.x) spend part of this on reasoning, so leave plenty for the answer.
const MAX_TOKENS = 8192;

/** Why a provider can't run here, or null when it can (Ollama needs no key). */
async function unavailable(provider, app) {
  if (provider === 'anthropic') return process.env.ANTHROPIC_API_KEY ? null : 'no ANTHROPIC_API_KEY in .env.local';
  if (provider === 'chatgpt') {
    try {
      const status = await (await fetch(`${app}/api/chatgpt`)).json();
      return status.status === 'connected' && status.sharing ? null : `not signed in with ChatGPT at ${app}`;
    } catch {
      return `the app isn't running at ${app}`;
    }
  }
  const settings = OPENAI_COMPATIBLE[provider];
  if (!settings || settings.fallbackKey || settings.keys.some((name) => process.env[name])) return null;
  return `no ${settings.keys.join(' or ')} in .env.local`;
}

async function transcribe(provider, model, base64, app) {
  if (provider === 'chatgpt') {
    const response = await fetch(`${app}/api/transcribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: base64, prompt: PROMPT, ...(model ? { model } : {}) }),
    });
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status, code: body.code });
    return { text: body.text, cutOff: body.cutOff, served: body.model };
  }
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const reply = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
        { type: 'text', text: PROMPT },
      ] }],
    });
    const text = reply.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    return { text, cutOff: reply.stop_reason === 'max_tokens' };
  }
  const settings = OPENAI_COMPATIBLE[provider];
  if (!settings) throw new Error(`Unknown provider "${provider}" (use anthropic, ${Object.keys(OPENAI_COMPATIBLE).join(', ')})`);
  const apiKey = settings.keys.map((name) => process.env[name]).find(Boolean) ?? settings.fallbackKey;
  if (!apiKey) throw new Error(`Missing ${settings.keys.join(' or ')} in .env.local`);
  const client = new OpenAI({ apiKey, baseURL: settings.baseURL });
  const reply = await client.chat.completions.create({
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      { type: 'text', text: PROMPT },
    ] }],
  });
  const choice = reply.choices[0];
  return { text: choice?.message?.content ?? '', cutOff: choice?.finish_reason === 'length' };
}

// A rate limit (429) or an overloaded model (503) is waited out and retried; a daily quota or the ChatGPT plan's usage cap ends
// that model's run.
const RETRY_WAITS_MS = [60_000, 120_000];
const isDailyQuota = (error) => /usage_limit/.test(error?.code ?? '')
  || /perday|per.day|daily|\bRPD\b/i.test(`${error?.message ?? ''}${JSON.stringify(error?.error ?? '')}`);

async function transcribeWithRetry(provider, model, base64, app, name) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await transcribe(provider, model, base64, app);
    } catch (error) {
      const wait = RETRY_WAITS_MS[attempt];
      const retryable = error?.status === 503 || (error?.status === 429 && !isDailyQuota(error));
      if (!retryable || wait === undefined) throw error;
      console.log(`${name}  ${error.status === 503 ? 'overloaded' : 'rate limited'}, waiting ${wait / 1000}s`);
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

const percent = (x) => `${Math.round(x * 100)}%`;
// Table cells: LaTeX's | would end the cell.
const code = (latex) => `\`${latex.replaceAll('|', '\\|').replaceAll('\n', ' ')}\``;

async function main() {
  const { values } = parseArgs({ options: {
    pages: { type: 'string', default: 'tests/handwriting' },
    images: { type: 'string' },
    models: { type: 'string', default: DEFAULT_MODELS },
    out: { type: 'string' },
    app: { type: 'string', default: 'http://localhost:3000' },
  } });
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');

  const pagesDir = resolve(values.pages);
  const imagesDir = resolve(values.images ?? join(pagesDir, 'wacom'));
  const outDir = resolve(values.out ?? join(pagesDir, 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const { pages } = JSON.parse(readFileSync(join(pagesDir, 'pages.json'), 'utf8'));
  const present = pages.filter((page) => existsSync(join(imagesDir, `${page.id}.png`)));
  if (present.length === 0) throw new Error(`No <page-id>.png images in ${imagesDir}`);
  const requested = values.models.split(',').map((entry) => {
    const [provider, ...rest] = entry.trim().split(':');
    return { provider, model: rest.join(':') };
  });
  // A model that can't run here (no key, app not running) is skipped and noted, rather than scored 0%.
  const reasons = await Promise.all(requested.map(({ provider }) => unavailable(provider, values.app)));
  const skipped = requested
    .map(({ provider, model }, i) => ({ name: `${provider}:${model}`, reason: reasons[i] }))
    .filter((m) => m.reason);
  for (const m of skipped) console.log(`Skipping ${m.name}: ${m.reason}`);
  const models = requested.filter((_, i) => !reasons[i]);
  if (models.length === 0) throw new Error('None of the models can run: add keys to .env.local or start the app');

  const results = [];
  for (const { provider, model } of models) {
    const name = `${provider}:${model}`;
    let stopped = null;
    for (const page of present) {
      if (stopped) {
        results.push({ model: name, page: page.id, error: stopped });
        continue;
      }
      const base64 = readFileSync(join(imagesDir, `${page.id}.png`)).toString('base64');
      const started = Date.now();
      try {
        const { text, cutOff, served } = await transcribeWithRetry(provider, model, base64, values.app, name);
        const scored = scorePage(page.lines, transcriptionLines(text));
        const diagram = text.split('\n').find((line) => /^\s*DIAGRAM:/i.test(line))?.trim() ?? null;
        results.push({ model: name, page: page.id, ms: Date.now() - started, ...scored, cutOff, served, diagram, raw: text });
        console.log(`${name}${served && served !== model ? ` (${served})` : ''}  ${page.id}  ${percent(scored.score)}  (${scored.exact}/${page.lines.length} exact)${cutOff ? '  CUT OFF' : ''}`);
      } catch (error) {
        results.push({ model: name, page: page.id, error: String(error?.message ?? error) });
        console.log(`${name}  ${page.id}  ERROR ${error?.message ?? error}`);
        // A daily quota, or a rate limit that outlasted every retry, won't clear during this run.
        if (error?.status === 429) stopped = `Not run: still rate limited (${error.message})`;
      }
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ images: imagesDir, models: models.map((m) => `${m.provider}:${m.model}`), results }, null, 2));

  const pageIds = present.map((page) => page.id);
  const rows = models.map(({ provider, model }) => {
    const name = `${provider}:${model}`;
    const mine = results.filter((r) => r.model === name);
    const scored = mine.filter((r) => r.error === undefined);
    const mean = scored.length ? scored.reduce((sum, r) => sum + r.score, 0) / scored.length : 0;
    const cells = pageIds.map((id) => {
      const r = mine.find((x) => x.page === id);
      return !r ? '' : r.error !== undefined ? 'error' : `${percent(r.score)}${r.cutOff ? ' ✂' : ''}`;
    });
    // The mean covers only the pages that ran, so say how many that was.
    const coverage = scored.length < pageIds.length ? ` (${scored.length} of ${pageIds.length} pages)` : '';
    return `| ${name} | ${scored.length ? percent(mean) : '–'}${coverage} | ${cells.join(' | ')} |`;
  });
  const misses = results
    .filter((r) => r.error === undefined)
    .flatMap((r) => r.lines.filter((l) => l.score < 1).map((l) => `| ${r.model} | ${r.page} | ${code(l.expected)} | ${l.got === null ? '(missing)' : code(l.got)} | ${percent(l.score)} |`));
  // Each distinct error once per model, with the pages it hit.
  const errors = [...Map.groupBy(results.filter((r) => r.error !== undefined), (r) => JSON.stringify([r.model, r.error]))]
    .map(([key, hits]) => {
      const [model, message] = JSON.parse(key);
      return `- ${model} (${hits.map((r) => r.page).join(', ')}): ${message.replaceAll('\n', ' ')}`;
    });
  // Drawings aren't scored automatically; they're listed for comparing by eye.
  const drawings = present
    .filter((page) => page.diagram)
    .flatMap((page) => [
      `### ${page.id}`,
      '',
      `Drawn: ${page.diagram}`,
      '',
      ...results.filter((r) => r.page === page.id && r.error === undefined).map((r) => `- ${r.model}: ${r.diagram ?? '(no description)'}`),
      '',
    ]);
  const notes = [
    ...skipped.map((m) => `- Skipped ${m.name}: ${m.reason}.`),
    // Which plan model each chatgpt: entry ran as.
    ...[...new Map(results.filter((r) => r.served).map((r) => [r.model, r.served]))].map(([name, slug]) => `- ${name} ran as \`${slug}\`.`),
  ];
  const summary = [
    '# Handwriting test results',
    '',
    `Images: \`${imagesDir}\``,
    '',
    'Scores cover the written lines only. Drawings are listed at the end to compare by eye.',
    ...(results.some((r) => r.cutOff) ? ['', '✂ The reply stopped early (usually at the token limit), so lines at the end may be missing.'] : []),
    ...(notes.length ? ['', ...notes] : []),
    '',
    `| Model | Mean | ${pageIds.join(' | ')} |`,
    `|---|---|${pageIds.map(() => '---').join('|')}|`,
    ...rows,
    '',
    ...(errors.length ? ['## Errors', '', ...errors, ''] : []),
    '## Lines not read exactly',
    '',
    '| Model | Page | Expected | Got | Score |',
    '|---|---|---|---|---|',
    ...misses,
    '',
    ...(drawings.length ? ['## Drawings (not scored)', '', ...drawings] : []),
  ].join('\n');
  writeFileSync(join(outDir, 'summary.md'), summary);
  console.log(`\nWrote ${join(outDir, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
