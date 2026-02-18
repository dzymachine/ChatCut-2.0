import type { NextConfig } from "next";

const isTauri = process.env.TAURI_ENV_PLATFORM !== undefined;

const nextConfig: NextConfig = {
  // Static export for Tauri production builds
  ...(isTauri ? { output: "export" } : {}),

  // Proxy AI API requests to the FastAPI backend
  // Note: rewrites only work in dev/server mode, not static export.
  // In Tauri production, the frontend calls the backend directly via fetch.
  ...(!isTauri
    ? {
        async rewrites() {
          return [
            {
              source: "/api/ai/health",
              destination: "http://localhost:3001/health",
            },
            {
              source: "/api/ai/:path*",
              destination: "http://localhost:3001/api/:path*",
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
