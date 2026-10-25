import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const config: NextConfig = {
  // Pin the workspace root so a stray lockfile in a parent directory is ignored.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  async headers() {
    return [
      {
        source: "/invite",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default config;
