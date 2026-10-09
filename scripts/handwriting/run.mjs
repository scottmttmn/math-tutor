// Handwriting test: sends each handwritten page to each model, asks for a LaTeX
// transcription, and scores it against the answer key.
//
//   node scripts/handwriting/run.mjs [--pages <dir with pages.json>] [--images <dir>] \
//     [--models anthropic:claude-sonnet-5-5,gemini:gemini-3.8-flash] [--out <dir>]
//
// --pages defaults to tests/handwriting, Scott's handwritten set. Images are <page-id>.png in
// --images (default <pages>/wacom). Keys come from .env.local,
// as for the app. Writes results.json and summary.md to --out (default <pages>/results/<time>).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { scorePage, transcriptionLines } from './score.mjs';

const PROMPT = `Transcribe the handwritten math in this image into LaTeX.
- One output line per handwritten line, top to bottom, in the order written.
- Output only the LaTeX lines: no $ or \\[ delimiters, no code fences, no commentary.
- Write words as \\text{...}. Leave out anything crossed out.
- If the page has a drawing, add one last line starting with "DIAGRAM:" that describes it.`;

const OPENAI_COMPATIBLE = {
  openai: { baseURL: 'https://api.openai.com/v1', keys: ['OPENAI_API_KEY'] },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', keys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'] },
  ollama: { baseURL: process.env.NEXT_PUBLIC_OLLAMA_BASE_URL ?? 'http://localhost:11434/v1', keys: [], fallbackKey: 'ollama' },
};

const DEFAULT_MODELS = 'anthropic:claude-sonnet-5-5,gemini:gemini-3.8-flash,openai:gpt-4o';

async function transcribe(provider, model, base64) {
  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const reply = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
        { type: 'text', text: PROMPT },
      ] }],
    });
    return reply.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
  }
  const settings = OPENAI_COMPATIBLE[provider];
  if (!settings) throw new Error(`Unknown provider "${provider}" (use anthropic, ${Object.keys(OPENAI_COMPATIBLE).join(', ')})`);
  const apiKey = settings.keys.map((name) => process.env[name]).find(Boolean) ?? settings.fallbackKey;
  if (!apiKey) throw new Error(`Missing ${settings.keys.join(' or ')} in .env.local`);
  const client = new OpenAI({ apiKey, baseURL: settings.baseURL });
  const reply = await client.chat.completions.create({
    model,
    max_tokens: 2048,
    messages: [{ role: 'user', content: [
      { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      { type: 'text', text: PROMPT },
    ] }],
  });
  return reply.choices[0]?.message?.content ?? '';
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
  } });
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');

  const pagesDir = resolve(values.pages);
  const imagesDir = resolve(values.images ?? join(pagesDir, 'wacom'));
  const outDir = resolve(values.out ?? join(pagesDir, 'results', new Date().toISOString().replace(/[:.]/g, '-')));
  const { pages } = JSON.parse(readFileSync(join(pagesDir, 'pages.json'), 'utf8'));
  const present = pages.filter((page) => existsSync(join(imagesDir, `${page.id}.png`)));
  if (present.length === 0) throw new Error(`No <page-id>.png images in ${imagesDir}`);
  const models = values.models.split(',').map((entry) => {
    const [provider, ...rest] = entry.trim().split(':');
    return { provider, model: rest.join(':') };
  });

  const results = [];
  for (const { provider, model } of models) {
    const name = `${provider}:${model}`;
    for (const page of present) {
      const base64 = readFileSync(join(imagesDir, `${page.id}.png`)).toString('base64');
      const started = Date.now();
      try {
        const text = await transcribe(provider, model, base64);
        const scored = scorePage(page.lines, transcriptionLines(text));
        const diagram = text.split('\n').find((line) => /^\s*DIAGRAM:/i.test(line))?.trim() ?? null;
        results.push({ model: name, page: page.id, ms: Date.now() - started, ...scored, diagram, raw: text });
        console.log(`${name}  ${page.id}  ${percent(scored.score)}  (${scored.exact}/${page.lines.length} exact)`);
      } catch (error) {
        results.push({ model: name, page: page.id, error: String(error?.message ?? error) });
        console.log(`${name}  ${page.id}  ERROR ${error?.message ?? error}`);
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
      return !r ? '' : r.error !== undefined ? 'error' : percent(r.score);
    });
    return `| ${name} | ${percent(mean)} | ${cells.join(' | ')} |`;
  });
  const misses = results
    .filter((r) => r.error === undefined)
    .flatMap((r) => r.lines.filter((l) => l.score < 1).map((l) => `| ${r.model} | ${r.page} | ${code(l.expected)} | ${l.got === null ? '(missing)' : code(l.got)} | ${percent(l.score)} |`));
  const summary = [
    '# Handwriting test results',
    '',
    `Images: \`${imagesDir}\``,
    '',
    `| Model | Mean | ${pageIds.join(' | ')} |`,
    `|---|---|${pageIds.map(() => '---').join('|')}|`,
    ...rows,
    '',
    '## Lines not read exactly',
    '',
    '| Model | Page | Expected | Got | Score |',
    '|---|---|---|---|---|',
    ...misses,
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'summary.md'), summary);
  console.log(`\nWrote ${join(outDir, 'summary.md')}`);
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
