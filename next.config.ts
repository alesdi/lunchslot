import type { NextConfig } from "next";

// Serverless Chromium (used to read booking links) ships compressed binaries that file tracing can't detect.
const chromiumFiles = [
  "./node_modules/@sparticuz/chromium/bin/**",
  // pnpm keeps the real files here; the symlinked path above isn't followed by tracing.
  "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/meetings/\\[slug\\]/participants": chromiumFiles,
    "/api/meetings/\\[slug\\]/refresh": chromiumFiles,
  },
};

export default nextConfig;
