import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = {
  "@core": fileURLToPath(new URL("./core", import.meta.url)),
  "@convex": fileURLToPath(new URL("./convex", import.meta.url)),
  "@": fileURLToPath(new URL("./src", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          // convex-test mocks the Convex runtime; edge-runtime is closest to it.
          environment: "edge-runtime",
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        resolve: { alias },
        test: { name: "core", include: ["core/**/*.test.ts", "src/**/*.test.ts"], environment: "node" },
      },
    ],
  },
});
