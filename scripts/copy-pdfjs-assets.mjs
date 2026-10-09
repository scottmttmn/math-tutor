// Copies PDF.js's worker, fonts, character maps and decoders into public/ so the Shelf reads
// PDFs offline instead of fetching them from a CDN. Runs after npm install.
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const source = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const target = join(import.meta.dirname, '..', 'public', 'pdfjs');
rmSync(target, { recursive: true, force: true });
// The legacy build, like src/lib/pdf.ts: the modern one needs very recent browsers.
cpSync(join(source, 'legacy', 'build', 'pdf.worker.min.mjs'), join(target, 'pdf.worker.min.mjs'));
for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(source, folder), join(target, folder), { recursive: true });
}
