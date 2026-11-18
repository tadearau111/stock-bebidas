import type { NextConfig } from "next";

// Versión de esta publicación (la usa la app instalada para saber cuándo actualizarse)
const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now())).slice(0, 12)

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_VERSION: version },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
