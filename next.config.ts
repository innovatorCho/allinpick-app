import type { NextConfig } from "next";

// Files the browser packages read at runtime by computed path, which Vercel's
// file tracing can't discover on its own. Without them, the deployed
// function fails with "Cannot find module .../playwright-core/browsers.json"
// or can't find the Chromium binary to unpack. Applied to every route since
// collectors are reachable from pages, server actions, and cron routes alike.
const browserRuntimeFiles = [
  "./node_modules/playwright-core/browsers.json",
  "./node_modules/@sparticuz/chromium/bin/**/*",
];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/*": browserRuntimeFiles,
    "/**/*": browserRuntimeFiles,
  },
};

export default nextConfig;
