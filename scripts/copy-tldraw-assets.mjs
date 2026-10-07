// Copies tldraw's fonts, icons and translations into public/ so the canvas works
// offline instead of fetching them from tldraw's CDN. Runs after npm install.
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const source = dirname(createRequire(import.meta.url).resolve('@tldraw/assets/package.json'));
const target = join(import.meta.dirname, '..', 'public', 'tldraw-assets');
rmSync(target, { recursive: true, force: true });
for (const folder of ['fonts', 'icons', 'translations', 'embed-icons']) {
  cpSync(join(source, folder), join(target, folder), { recursive: true });
}
