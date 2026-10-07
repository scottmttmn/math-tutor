import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native keychain binding used to encrypt saved ChatGPT tokens; load it from node_modules at runtime.
  serverExternalPackages: ['@napi-rs/keyring'],
  outputFileTracingRoot: __dirname,
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
