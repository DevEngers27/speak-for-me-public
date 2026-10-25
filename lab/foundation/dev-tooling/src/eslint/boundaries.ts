import path from "node:path";
import type { ESLint, Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import boundariesPlugin from "eslint-plugin-boundaries";
import { ELEMENT_TYPES, resolveLayout, type BoundaryLayout } from "./layout.ts";

/** Modules that make code framework-bound. Engine and scenarios must stay portable. */
export const DEFAULT_FRAMEWORK_MODULES: readonly string[] = Object.freeze([
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "next",
  "next/*",
  "@clerk/*",
  "server-only",
  "client-only",
  "convex/server",
  "convex/react",
  "convex/react-clerk",
  "convex/nextjs",
  "convex/browser",
]);

/** Modules convex/ must not import: the UI frameworks (Convex code runs outside Next). */
export const DEFAULT_CONVEX_FORBIDDEN_MODULES: readonly string[] = Object.freeze([
  "react",
  "react/*",
  "react-dom",
  "react-dom/*",
  "next",
  "next/*",
  "@clerk/*",
]);

export interface BoundaryConfigOptions {
  /** Absolute path of the repository root (usually `import.meta.dirname` in eslint.config.mjs). */
  readonly rootDir: string;
  /** Overrides for the folder layout; unspecified fields use DEFAULT_LAYOUT. */
  readonly layout?: Partial<BoundaryLayout>;
  /**
   * tsconfig files used to resolve path aliases, relative to rootDir.
   * Defaults to the root tsconfig plus `<convex>/tsconfig.json`.
   */
  readonly tsconfigs?: readonly string[];
  /** Replaces DEFAULT_FRAMEWORK_MODULES for engine and scenarios. */
  readonly frameworkModules?: readonly string[];
  /** Replaces DEFAULT_CONVEX_FORBIDDEN_MODULES for convex/. */
  readonly convexForbiddenModules?: readonly string[];
  /** File extensions to lint. */
  readonly extensions?: readonly string[];
}

export const RULE_IDS = Object.freeze({
  boundaries: "boundaries/dependencies",
  restrictedImports: "no-restricted-imports",
} as const);

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filesUnder(folder: string, extensions: readonly string[]): string[] {
  return extensions.map((ext) => `${folder}/**/*.${ext}`);
}

function element(type: string): Record<string, unknown> {
  return { to: { element: { type } } };
}

/**
 * Builds the ESLint 9 flat-config blocks that enforce the dependency direction.
 *
 * Two mechanisms, on purpose:
 * - `boundaries/dependencies` classifies the *resolved* file of every local
 *   import (relative or aliased) and enforces engine <- scenarios <- convex/app.
 * - core `no-restricted-imports` bans *specifiers*: framework packages in the
 *   portable layers, and the app alias inside convex/. A specifier rule still
 *   fires when the alias does not resolve at all (convex/tsconfig.json does not
 *   declare it), which is exactly the case the resolver-based rule cannot see.
 */
export function createBoundaryConfig(options: BoundaryConfigOptions): Linter.Config[] {
  if (!path.isAbsolute(options.rootDir)) {
    throw new Error("createBoundaryConfig: rootDir must be an absolute path.");
  }
  const layout = resolveLayout(options.layout);
  const extensions = options.extensions ?? ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
  const tsconfigs = (options.tsconfigs ?? ["tsconfig.json", `${layout.convex}/tsconfig.json`]).map((p) =>
    path.resolve(options.rootDir, p),
  );
  const frameworkModules = options.frameworkModules ?? DEFAULT_FRAMEWORK_MODULES;
  const convexForbidden = options.convexForbiddenModules ?? DEFAULT_CONVEX_FORBIDDEN_MODULES;
  const aliasRegex = `^${escapeRegex(layout.appAlias)}`;
  const t = ELEMENT_TYPES;

  const sourceFiles = [layout.engine, layout.scenarios, layout.convex, layout.app].flatMap((folder) =>
    filesUnder(folder, extensions),
  );

  const parserBlock: Linter.Config = {
    name: "sfm/boundaries/parser",
    // typescript-eslint parses plain JS/JSX too, so one parser covers every layer.
    files: sourceFiles,
    languageOptions: {
      parser: tsParser as unknown as Linter.Parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
  };

  const boundariesBlock: Linter.Config = {
    name: "sfm/boundaries/dependencies",
    files: sourceFiles,
    plugins: { boundaries: boundariesPlugin as unknown as ESLint.Plugin },
    settings: {
      "boundaries/root-path": options.rootDir,
      "boundaries/legacy-templates": false,
      "boundaries/legacy-warnings": false,
      "boundaries/elements": [
        // Order matters: the generated surface is carved out of convex/ first.
        { type: t.convexGenerated, pattern: layout.convexGenerated, partialMatch: false, exclusive: true },
        { type: t.engine, pattern: layout.engine, partialMatch: false, exclusive: true },
        {
          type: t.scenario,
          pattern: `${layout.scenarios}/*`,
          capture: ["scenario"],
          partialMatch: false,
          exclusive: true,
        },
        { type: t.convex, pattern: layout.convex, partialMatch: false, exclusive: true },
        { type: t.app, pattern: layout.app, partialMatch: false, exclusive: true },
      ],
      "import/resolver": {
        typescript: { project: tsconfigs, alwaysTryTypes: true, noWarnOnMultipleProjects: true },
      },
    },
    rules: {
      [RULE_IDS.boundaries]: [
        "error",
        {
          default: "disallow",
          message:
            "Layer boundary: {{ from.element.type }} must not import {{ to.element.type }} ({{ dependency.source }}). Allowed direction: engine <- scenarios <- convex/app; app reaches convex only through the generated API.",
          policies: [
            { from: { element: { type: t.engine } }, allow: element(t.engine) },
            // Imports inside one plugin folder are internal to that element and not
            // checked; anything reaching another plugin falls through to "disallow".
            { from: { element: { type: t.scenario } }, allow: element(t.engine) },
            {
              from: { element: { type: t.convex } },
              allow: [element(t.engine), element(t.scenario), element(t.convex), element(t.convexGenerated)],
            },
            { from: { element: { type: t.convexGenerated } }, allow: [element(t.convex), element(t.convexGenerated)] },
            {
              from: { element: { type: t.app } },
              allow: [element(t.app), element(t.engine), element(t.scenario), element(t.convexGenerated)],
            },
          ],
        },
      ],
    },
  };

  const frameworkPatterns = [
    {
      group: [...frameworkModules],
      message: "engine and scenario code must stay framework-free (no React, Next, Clerk, or Convex server/client).",
    },
  ];
  const appAliasPattern = {
    regex: aliasRegex,
    message: `The ${layout.appAlias} alias points into the Next app (${layout.app}/); it is not available here.`,
  };

  const portableBlock: Linter.Config = {
    name: "sfm/boundaries/portable-layers",
    files: [...filesUnder(layout.engine, extensions), ...filesUnder(layout.scenarios, extensions)],
    rules: {
      [RULE_IDS.restrictedImports]: ["error", { patterns: [...frameworkPatterns, appAliasPattern] }],
    },
  };

  const convexBlock: Linter.Config = {
    name: "sfm/boundaries/convex",
    files: filesUnder(layout.convex, extensions),
    ignores: filesUnder(layout.convexGenerated, extensions),
    rules: {
      [RULE_IDS.restrictedImports]: [
        "error",
        {
          patterns: [
            { group: [...convexForbidden], message: "convex/ runs inside Convex, not Next: no React, Next or Clerk imports." },
            appAliasPattern,
          ],
        },
      ],
    },
  };

  return [parserBlock, boundariesBlock, portableBlock, convexBlock];
}
