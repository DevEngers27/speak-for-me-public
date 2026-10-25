import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Layering: core (pure) <- convex (backend) ; core <- src (Next app).
// src may only reach convex through the generated, type-only API surface.
const frameworkImports = [
  { group: ["next", "next/*", "react", "react-dom", "@clerk/*"], message: "core/ and convex/ must stay framework-free." },
];

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", "convex/_generated/**", "next-env.d.ts", "coverage/**"]),
  {
    files: ["core/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          ...frameworkImports,
          { group: ["convex", "convex/*", "@convex/*", "@/*"], message: "core/ must not depend on Convex or the Next app." },
          { regex: "^\\.{1,2}/.*(convex|src)/", message: "core/ must not reach into convex/ or src/." },
        ],
      }],
    },
  },
  {
    files: ["convex/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          ...frameworkImports,
          { group: ["@/*"], message: "convex/ must not import the Next app." },
          { regex: "^\\.{1,2}/.*src/", message: "convex/ must not import the Next app." },
        ],
      }],
    },
  },
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            regex: "^@convex/(?!_generated/(api|dataModel)$)",
            message: "src/ may import only @convex/_generated/api and dataModel.",
          },
          { regex: "^\\.{1,2}/.*convex/", message: "Use the @convex/_generated alias, not relative paths." },
        ],
      }],
    },
  },
]);
