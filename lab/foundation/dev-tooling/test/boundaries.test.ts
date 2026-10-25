import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createBoundaryConfig,
  DEFAULT_LAYOUT,
  lintFixtureProject,
  parseExpectedRules,
  resolveLayout,
  RULE_IDS,
  type FixtureResult,
} from "../src/eslint/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultProject = path.join(root, "fixtures/project");
const altProject = path.join(root, "fixtures/alt-layout");

function listSources(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSources(full, base);
    return /\.(ts|tsx)$/.test(entry.name) ? [path.relative(base, full).split(path.sep).join("/")] : [];
  });
}

function byFile(results: readonly FixtureResult[]): Map<string, FixtureResult> {
  return new Map(results.map((r) => [r.file, r]));
}

describe("default layout fixtures", () => {
  const files = listSources(defaultProject).sort();
  let results: Map<string, FixtureResult>;

  beforeAll(async () => {
    results = byFile(await lintFixtureProject({ projectDir: defaultProject }));
  });

  it("lints every fixture file", () => {
    expect([...results.keys()].sort()).toEqual(files);
  });

  it.each(files)("%s matches its expectation", (file) => {
    const result = results.get(file);
    expect(result, file).toBeDefined();
    if (!result) return;
    if (result.shouldFail) {
      expect(result.expectedRules.length, "fail fixture must declare @expect-rules").toBeGreaterThan(0);
      expect(result.actualRules).toEqual(result.expectedRules);
    } else {
      expect(result.messages).toEqual([]);
    }
  });

  it("covers both mechanisms and every layer with must-fail cases", () => {
    const failing = [...results.values()].filter((r) => r.shouldFail);
    const rules = new Set(failing.flatMap((r) => r.actualRules));
    expect(rules).toEqual(new Set([RULE_IDS.boundaries, RULE_IDS.restrictedImports]));
    for (const folder of ["core/engine/", "core/scenarios/", "convex/", "src/app/"]) {
      expect(failing.some((r) => r.file.startsWith(folder)), folder).toBe(true);
    }
    expect(failing.length).toBeGreaterThanOrEqual(14);
  });

  it("explains the violated direction in the boundaries message", () => {
    const result = results.get("convex/imports-app-relative.fail.ts");
    const message = result?.messages.find((m) => m.ruleId === RULE_IDS.boundaries)?.message ?? "";
    expect(message).toContain("convex must not import app");
    expect(message).toContain("../src/app/page");
  });

  it("catches the @/ alias in convex/ even though it does not resolve there", () => {
    const result = results.get("convex/imports-app-alias.fail.ts");
    expect(result?.actualRules).toEqual([RULE_IDS.restrictedImports]);
    expect(result?.messages[0]?.message).toContain("@/ alias");
  });
});

describe("alternate layout fixtures", () => {
  it("applies the same rules to a different folder layout", async () => {
    const results = await lintFixtureProject({
      projectDir: altProject,
      layout: {
        engine: "packages/engine",
        scenarios: "packages/plugins",
        convex: "backend",
        convexGenerated: "backend/_gen",
        app: "apps/web/src",
        appAlias: "~/",
      },
    });
    const mismatched = results.filter((r) => !r.ok).map((r) => `${r.file}: ${r.actualRules.join(",")}`);
    expect(mismatched).toEqual([]);
    expect(results.filter((r) => r.shouldFail)).toHaveLength(4);
    expect(results).toHaveLength(listSources(altProject).length);
  });
});

describe("layout and config validation", () => {
  it("returns the default layout when nothing is overridden", () => {
    expect(resolveLayout()).toEqual(DEFAULT_LAYOUT);
  });

  it.each([
    [{ engine: "../engine" }, /Invalid layout.engine/],
    [{ app: "src/**" }, /Invalid layout.app/],
    [{ convexGenerated: "generated" }, /inside layout.convex/],
    [{ scenarios: "core/engine/plugins" }, /must not nest/],
    [{ appAlias: "src/" }, /Invalid layout.appAlias/],
  ])("rejects %o", (override, error) => {
    expect(() => resolveLayout(override)).toThrow(error);
  });

  it("requires an absolute rootDir", () => {
    expect(() => createBoundaryConfig({ rootDir: "relative/path" })).toThrow(/absolute/);
  });

  it("produces named flat-config blocks", () => {
    const names = createBoundaryConfig({ rootDir: root }).map((block) => block.name);
    expect(names).toEqual([
      "sfm/boundaries/parser",
      "sfm/boundaries/dependencies",
      "sfm/boundaries/portable-layers",
      "sfm/boundaries/convex",
    ]);
  });

  it("parses @expect-rules directives", () => {
    expect(parseExpectedRules("// @expect-rules b a  a\nimport x from 'y';")).toEqual(["a", "b"]);
    expect(parseExpectedRules("export {};")).toEqual([]);
  });
});

describe("plain Node execution", () => {
  it("runs the fixture CLI with Node's built-in type stripping", () => {
    const run = spawnSync(process.execPath, ["src/eslint/lint-fixtures-cli.ts"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
      timeout: 120_000,
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/fixture files, 0 mismatched/);
  });
});
