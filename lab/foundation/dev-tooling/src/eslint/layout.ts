/**
 * Folder layout the boundary rules are written against.
 *
 * Every path is a POSIX folder path relative to the repository root, without
 * leading "./" or trailing "/". The final directory structure is still being
 * designed, so nothing here hard-codes it: callers override any field and the
 * rules follow.
 *
 * Dependency direction enforced by `createBoundaryConfig`:
 *
 *   engine  <-  scenarios/<name>  <-  convex  (and app)
 *   app may reach convex only through `convexGenerated`.
 */
export interface BoundaryLayout {
  /** Framework-free negotiation engine. Must not import scenarios, convex or the app. */
  readonly engine: string;
  /**
   * Parent folder of scenario plugins. Each direct child folder is one plugin;
   * plugins may import the engine and themselves, never each other.
   */
  readonly scenarios: string;
  /** Convex functions folder. May import engine and scenarios, never the app. */
  readonly convex: string;
  /** Generated Convex client surface: the only part of `convex` the app may import. */
  readonly convexGenerated: string;
  /** Next.js application source root (App Router lives below it). */
  readonly app: string;
  /**
   * Import-specifier prefix that maps to `app` in the root tsconfig (for
   * example "@/"). Banned by specifier inside convex/, engine and scenarios,
   * because convex/tsconfig.json does not declare it and the Convex bundler
   * would fail or silently resolve something else.
   */
  readonly appAlias: string;
}

/**
 * Default layout, matching the layout verified by the repository skeleton
 * spike (core/engine, core/scenarios/<name>, convex/, src/).
 */
export const DEFAULT_LAYOUT: BoundaryLayout = Object.freeze({
  engine: "core/engine",
  scenarios: "core/scenarios",
  convex: "convex",
  convexGenerated: "convex/_generated",
  app: "src",
  appAlias: "@/",
});

/** Element type names used in boundaries settings and in error messages. */
export const ELEMENT_TYPES = Object.freeze({
  engine: "engine",
  scenario: "scenario",
  convex: "convex",
  convexGenerated: "convex-generated",
  app: "app",
} as const);

export type ElementType = (typeof ELEMENT_TYPES)[keyof typeof ELEMENT_TYPES];

const SAFE_FOLDER = /^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/;

/**
 * Merges overrides onto the default layout and validates every folder.
 * Throws on paths that would make the glob patterns ambiguous.
 */
export function resolveLayout(overrides: Partial<BoundaryLayout> = {}): BoundaryLayout {
  const layout: BoundaryLayout = { ...DEFAULT_LAYOUT, ...overrides };
  const folders: Array<[string, string]> = [
    ["engine", layout.engine],
    ["scenarios", layout.scenarios],
    ["convex", layout.convex],
    ["convexGenerated", layout.convexGenerated],
    ["app", layout.app],
  ];
  for (const [key, value] of folders) {
    if (!SAFE_FOLDER.test(value) || value.split("/").some((part) => part === "." || part === "..")) {
      throw new Error(
        `Invalid layout.${key}: ${JSON.stringify(value)}. Use a relative POSIX folder path without globs, "./", "../" or trailing "/".`,
      );
    }
  }
  if (!layout.convexGenerated.startsWith(`${layout.convex}/`)) {
    throw new Error("layout.convexGenerated must be a folder inside layout.convex.");
  }
  if (!/^[@~#][A-Za-z0-9_-]*\/$/.test(layout.appAlias)) {
    throw new Error(`Invalid layout.appAlias: ${JSON.stringify(layout.appAlias)}. Expected something like "@/".`);
  }
  const roots = [layout.engine, layout.scenarios, layout.convex, layout.app];
  for (const a of roots) {
    for (const b of roots) {
      if (a !== b && (a.startsWith(`${b}/`) || a === b)) {
        throw new Error(`Layout folders must not nest: ${JSON.stringify(a)} is inside ${JSON.stringify(b)}.`);
      }
    }
  }
  return Object.freeze(layout);
}
