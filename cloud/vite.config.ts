import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
export default defineConfig({
  root: `${root}/cloud`,
  resolve: { alias: { "@": `${root}/src`, "@core": `${root}/core`, "@convex": `${root}/convex`, "@clerk/nextjs": "@clerk/react", "next/link": `${root}/cloud/link.tsx`, "next/navigation": `${root}/cloud/navigation.tsx` } },
  esbuild: { jsx: "automatic" },
  build: { outDir: `${root}/dist`, emptyOutDir: true, sourcemap: false },
  server: { host: "127.0.0.1", port: 3032 },
});
