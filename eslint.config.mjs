import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored from OpenAI's Sign in with ChatGPT DevKit; kept close to upstream.
    "src/lib/siwc/**",
    ".claude/**",
    // Copied from pdfjs-dist on npm install.
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;
