import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const loadDependency = createRequire(import.meta.url);

// Use the project's compiler to test server/storage modules without another test runtime.
export default function loadTypeScript(path, overrides = {}) {
  const filename = resolve(path);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiledModule = { exports: {} };
  const load = (name) => {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (name.startsWith('@/')) {
      const target = resolve('src', name.slice(2));
      return target.endsWith('.json') ? loadDependency(target) : loadTypeScript(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`, overrides);
    }
    return loadDependency(name);
  };
  new Function('require', 'module', 'exports', source)(load, compiledModule, compiledModule.exports);
  return compiledModule.exports;
};
