import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Serverless Chromium (used to read booking links) ships compressed binaries that file tracing can't detect.
  outputFileTracingIncludes: {
    "/api/meetings/\\[slug\\]/participants": [
      "./node_modules/@sparticuz/chromium/bin/**",
      // pnpm keeps the real files here; the symlinked path above isn't followed by tracing.
      "./node_modules/.pnpm/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
    ],
  },
};

export default nextConfig;
