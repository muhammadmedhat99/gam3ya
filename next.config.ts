import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components is off on purpose: almost every route is private and
  // per-user (session cookie + financial data), so we render dynamically and
  // avoid any chance of caching one user's data for another. Revisit for
  // public pages later.
  cacheComponents: false,
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
