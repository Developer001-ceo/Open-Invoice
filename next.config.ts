import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Surface type errors at build time instead of silently succeeding.
    ignoreBuildErrors: false,
  },
  // Strict mode helps catch unsafe patterns (effect cleanup bugs, stale
  // closures, double-invocation side effects) during development.
  reactStrictMode: true,
  // Hide the Next.js development indicator (the circular "N" logo button at
  // the bottom-left that opens the dev tools / error overlay). It only appears
  // in dev mode, but disabling it keeps the preview/deployment clean.
  devIndicators: false,
  allowedDevOrigins: [
    'preview-chat-f7720b96-e99e-4da4-9277-315f50a870ab.space-z.ai',
    'preview-chat-ed5e5f94-8731-4ee7-8e2f-1df8b8e9888b.space-z.ai',
    'preview-chat-4b2d0024-a459-4547-8ee8-b63379f410b1.space-z.ai',
    '*.space-z.ai',
  ],
};

export default nextConfig;
