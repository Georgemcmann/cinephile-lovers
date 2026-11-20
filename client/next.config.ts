import { resolve } from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin Turbopack's root to the client package. Without this Next walks up
  // to the user's home directory, finds an unrelated package-lock.json and
  // warns that it is ignoring it (and module tracing may drift there).
  turbopack: {
    root: resolve(process.cwd()),
  },
  // StrictMode is kept ON in development on purpose: the brief requires that
  // object URLs, sockets and effects survive its double-invoked effects, so
  // we want to catch mistakes early, not hide them.
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Brief §6: referrers must never carry room paths onward.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;