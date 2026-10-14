// Stops `npm run dev` / `npm run build` early when node_modules doesn't match package-lock.json
// (usually after a pull that added or bumped a package), instead of a "Module not found" in the app.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const { dependencies = {}, devDependencies = {} } = lock.packages[''];
const stale = [];
for (const name of Object.keys({ ...dependencies, ...devDependencies })) {
  const wanted = lock.packages[`node_modules/${name}`]?.version;
  const manifest = join(root, 'node_modules', name, 'package.json');
  const installed = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).version : null;
  if (installed !== wanted) stale.push(`${name} (installed ${installed ?? 'nothing'}, needs ${wanted})`);
}
for (const asset of ['public/pdfjs/pdf.worker.min.mjs', 'public/tldraw-assets']) {
  if (!existsSync(join(root, asset))) stale.push(`${asset} (copied by npm install)`);
}
if (stale.length > 0) {
  console.error(`Dependencies are out of date. Run \`npm install\`, then try again.\n  ${stale.join('\n  ')}`);
  process.exit(1);
}
