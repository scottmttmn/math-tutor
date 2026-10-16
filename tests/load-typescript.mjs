import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const loadDependency = createRequire(import.meta.url);

// Use the project's compiler to test server/storage modules without another test runtime.
// Relative imports (as in the vendored src/lib/siwc) load once per top-level call, so modules
// that share one (errors.ts) share its state and classes.
export default function loadTypeScript(path, overrides = {}, loaded = new Map()) {
  const filename = resolve(path);
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  loaded.set(filename, compiledModule);
  const load = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('./') || name.startsWith('../')) {
      const target = resolve(dirname(filename), name);
      return loadTypeScript(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`, overrides, loaded);
    }
    if (name.startsWith('@/')) {
      const target = resolve('src', name.slice(2));
      return target.endsWith('.json') ? loadDependency(target) : loadTypeScript(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`, overrides, loaded);
    }
    return loadDependency(name);
  };
  new Function('require', 'module', 'exports', source)(load, compiledModule, compiledModule.exports);
  return compiledModule.exports;
};
