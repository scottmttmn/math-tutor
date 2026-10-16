import type { NextConfig } from "next";

// `npm run build:android` bundles the app into the Android app: a static export with no server,
// so the API routes (route.ts) are left out by only treating .tsx files as pages. ('mdx' is unused, but a
// one-entry list breaks the webpack build on Next 16.1.6.)
const android = process.env.BUILD_TARGET === 'android';

const nextConfig: NextConfig = {
  // Native keychain binding used to encrypt saved ChatGPT tokens; load it from node_modules at runtime.
  serverExternalPackages: ['@napi-rs/keyring'],
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
  // With no server, the Android app calls the tutor's providers itself (src/lib/tutorRequest.ts).
  env: { NEXT_PUBLIC_TUTOR_DIRECT: android ? '1' : '' },
  ...(android ? { output: 'export', pageExtensions: ['tsx', 'mdx'], images: { unoptimized: true } } : {}),
};

export default nextConfig;
