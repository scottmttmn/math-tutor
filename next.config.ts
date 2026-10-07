import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the project root. Without this, a package.json or lockfile in a parent
  // folder makes Next treat that folder as the root, and Tailwind then can't be found.
  turbopack: {
    root: __dirname,
  },
  // Native keychain binding used to encrypt saved ChatGPT tokens; load it from node_modules at runtime.
  serverExternalPackages: ['@napi-rs/keyring'],
};

export default nextConfig;
