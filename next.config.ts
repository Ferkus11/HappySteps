import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Self-contained server build for the Docker image (docs/self-hosting.md).
  output: "standalone",
  poweredByHeader: false,
  // PDF fonts (src/lib/pdf.ts) are read from disk at runtime — copy them into the standalone build.
  outputFileTracingIncludes: { "/**/export": ["./src/assets/fonts/**/*"] },
  experimental: {
    serverActions: { bodySizeLimit: "16mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      // Push handlers imported by the service worker (and registered alone until the PWA worker exists).
      { source: "/sw-push.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
