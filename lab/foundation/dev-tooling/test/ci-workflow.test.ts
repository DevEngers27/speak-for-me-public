import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEFAULT_CI_OPTIONS, renderCiWorkflow } from "../src/ci/workflow.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}
interface Workflow {
  name: string;
  on: { push: { branches: string[] }; pull_request: null };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: { check: { "runs-on": string; "timeout-minutes": number; env?: Record<string, string>; steps: Step[] } };
}

function load(yaml: string): Workflow {
  return parse(yaml) as Workflow;
}

describe("CI workflow template", () => {
  it("committed templates/ci.yml matches the generator (run `npm run ci:render` to update)", () => {
    expect(readFileSync(path.join(root, "templates/ci.yml"), "utf8")).toBe(renderCiWorkflow());
  });

  it("is valid YAML with lint, typecheck, test and build in order", () => {
    const wf = load(renderCiWorkflow());
    expect(wf.name).toBe("CI");
    expect(wf.on.push.branches).toEqual(["main"]);
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.concurrency.group).toBe("ci-${{ github.ref }}");
    const runs = wf.jobs.check.steps.map((s) => s.run ?? s.uses ?? "");
    const order = ["pnpm run lint", "pnpm run typecheck", "pnpm run test", "pnpm run build"].map((cmd) => runs.indexOf(cmd));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(runs[0]).toBe(DEFAULT_CI_OPTIONS.actions.checkout);
    expect(runs).toContain("pnpm install --frozen-lockfile");
  });

  it("checks committed Convex codegen before linting", () => {
    const steps = load(renderCiWorkflow()).jobs.check.steps;
    const codegen = steps.findIndex((s) => s.run?.includes("git diff --exit-code -- convex/_generated"));
    const lint = steps.findIndex((s) => s.name === "Lint");
    expect(codegen).toBeGreaterThan(0);
    expect(codegen).toBeLessThan(lint);
  });

  it("needs no secrets", () => {
    const yaml = renderCiWorkflow();
    expect(yaml).not.toMatch(/secrets\./);
    expect(yaml.match(/\$\{\{/g)).toHaveLength(1);
  });

  it("supports npm and disabling the codegen check", () => {
    const wf = load(renderCiWorkflow({ packageManager: "npm", convexCodegenCheck: null, env: {} }));
    const runs = wf.jobs.check.steps.map((s) => s.run).filter(Boolean);
    expect(runs).toEqual(["npm ci", "npm run lint", "npm run typecheck", "npm run test", "npm run build"]);
    expect(wf.jobs.check.env).toBeUndefined();
  });

  it.each([
    [{ scripts: { ...DEFAULT_CI_OPTIONS.scripts, lint: "lint && curl evil" } }, /scripts.lint/],
    [{ env: { GOOD: "${{ secrets.X }}" } }, /expressions/],
    [{ env: { "bad-name": "1" } }, /env name/],
    [{ branches: [] }, /branches/],
    [{ pnpmVersion: "latest" }, /pnpmVersion/],
    [{ actions: { checkout: "actions/checkout", setupNode: "actions/setup-node@v7" } }, /actions/],
    [{ convexCodegenCheck: { script: "codegen", generatedDir: "../outside" } }, /generatedDir/],
    [{ timeoutMinutes: 0 }, /timeoutMinutes/],
  ])("rejects unsafe option %#", (overrides, error) => {
    expect(() => renderCiWorkflow(overrides)).toThrow(error);
  });

  it("quotes scalar values so names cannot inject YAML", () => {
    const wf = load(renderCiWorkflow({ name: 'CI: "x"\nfoo: bar' }));
    expect(wf.name).toBe('CI: "x"\nfoo: bar');
    expect(Object.keys(wf)).not.toContain("foo");
  });
});
