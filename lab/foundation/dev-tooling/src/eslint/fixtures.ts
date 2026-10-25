import { readFile } from "node:fs/promises";
import path from "node:path";
import { ESLint } from "eslint";
import { createBoundaryConfig, type BoundaryConfigOptions } from "./boundaries.ts";

/**
 * Fixture convention: inside a fixture project, a file whose name contains
 * ".fail." must produce lint errors, and its first lines declare the exact set
 * of rule ids expected, e.g. `// @expect-rules boundaries/dependencies`.
 * Every other file must lint clean. This keeps "must fail" and "must pass"
 * cases next to each other and self-describing.
 */
export const EXPECT_DIRECTIVE = "@expect-rules";

export interface FixtureMessage {
  readonly ruleId: string | null;
  readonly line: number;
  readonly message: string;
}

export interface FixtureResult {
  /** POSIX path relative to the fixture project root. */
  readonly file: string;
  readonly shouldFail: boolean;
  /** Sorted, de-duplicated rule ids declared by the fixture (empty for passing fixtures). */
  readonly expectedRules: readonly string[];
  /** Sorted, de-duplicated rule ids actually reported. */
  readonly actualRules: readonly string[];
  readonly messages: readonly FixtureMessage[];
  /** True when the outcome matches the expectation. */
  readonly ok: boolean;
}

export function parseExpectedRules(source: string): string[] {
  const rules = new Set<string>();
  for (const line of source.split("\n").slice(0, 10)) {
    const idx = line.indexOf(EXPECT_DIRECTIVE);
    if (idx === -1) continue;
    for (const rule of line.slice(idx + EXPECT_DIRECTIVE.length).trim().split(/\s+/)) {
      if (rule) rules.add(rule);
    }
  }
  return [...rules].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export interface LintFixturesOptions extends Omit<BoundaryConfigOptions, "rootDir"> {
  /** Absolute path of the fixture project (acts as the repository root). */
  readonly projectDir: string;
}

/** Lints every source file of a fixture project with the boundary config only. */
export async function lintFixtureProject(options: LintFixturesOptions): Promise<FixtureResult[]> {
  const { projectDir, ...configOptions } = options;
  const eslint = new ESLint({
    cwd: projectDir,
    overrideConfigFile: true,
    overrideConfig: createBoundaryConfig({ ...configOptions, rootDir: projectDir }),
    errorOnUnmatchedPattern: false,
  });
  const results = await eslint.lintFiles(["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"]);
  const out: FixtureResult[] = [];
  for (const result of results) {
    const file = path.relative(projectDir, result.filePath).split(path.sep).join("/");
    const shouldFail = path.basename(file).includes(".fail.");
    const source = result.source ?? (await readFile(result.filePath, "utf8"));
    const expectedRules = shouldFail ? parseExpectedRules(source) : [];
    const messages = result.messages.map((m) => ({ ruleId: m.ruleId, line: m.line, message: m.message }));
    const actualRules = [...new Set(messages.map((m) => m.ruleId ?? "(fatal)"))].sort();
    const ok = shouldFail ? expectedRules.length > 0 && sameSet(expectedRules, actualRules) : messages.length === 0;
    out.push({ file, shouldFail, expectedRules, actualRules, messages, ok });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

export function formatFixtureResults(results: readonly FixtureResult[]): string {
  const lines = results.map((r) => {
    const status = r.ok ? "ok  " : "FAIL";
    const kind = r.shouldFail ? "must-fail" : "must-pass";
    const detail = r.shouldFail
      ? `expected [${r.expectedRules.join(", ")}] got [${r.actualRules.join(", ")}]`
      : r.messages.length === 0
        ? "clean"
        : `unexpected: ${r.messages.map((m) => `${m.ruleId ?? "(fatal)"}@${m.line}`).join(", ")}`;
    return `${status} ${kind} ${r.file}  ${detail}`;
  });
  const failed = results.filter((r) => !r.ok).length;
  lines.push(`${results.length} fixture files, ${failed} mismatched`);
  return lines.join("\n");
}
