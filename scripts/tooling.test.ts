import { cooldownExpiry } from './lib/cooldown-exceptions.mjs';
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkEnv, formatEnvReport, looksLikeSecret, parseDotenv } from "./lib/check-env.mjs";
import { runCheckEnv } from "./check-env.mjs";
import { loadConvexCliEnv, parseOpsConfig, planOperation } from "./lib/convex-ops.mjs";
import { resolveDeploymentTarget } from "./lib/deployment-target.mjs";
import { runConvexOpsCli } from "./convex-ops.mjs";
import { findLayerImportViolations } from "./lib/layer-imports.mjs";

const SECRET = "FABRICATED_CANARY";
const config = parseOpsConfig(JSON.parse(readFileSync(new URL("./convex-ops.config.json", import.meta.url), "utf8")));

describe("check-env", () => {
  it("reports missing required names and never the values", () => {
    const report = checkEnv(
      [
        { name: "NEXT_PUBLIC_CONVEX_URL", location: "next-public", required: true, description: "" },
        { name: "ANTHROPIC_API_KEY", location: "convex-deployment", required: true, description: "" },
      ],
      { NEXT_PUBLIC_ANTHROPIC_KEY: "sk-SENTINEL", ANTHROPIC_API_KEY: "remote-SENTINEL" },
    );
    expect(report.ok).toBe(false);
    expect(report.exposureWarnings).toEqual(["NEXT_PUBLIC_ANTHROPIC_KEY"]);
    expect(report.localRemoteWarnings).toEqual(["ANTHROPIC_API_KEY"]);
    const text = formatEnvReport(report);
    expect(text).not.toContain("SENTINEL");
    expect(text).toContain("Running in unconfigured mode");
    expect(looksLikeSecret("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY")).toBe(false);
  });

  it("CLI exits 1 without printing a present value", () => {
    const lines: string[] = [];
    const code = runCheckEnv([], { NEXT_PUBLIC_CONVEX_URL: "https://example.invalid", CLERK_SECRET_KEY: "sk_test_SECRET" }, {
      readFile: () => "{}",
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).not.toContain("sk_test_SECRET");
    expect(lines.join("\n")).toContain("CLERK_SECRET_KEY");
  });
});

describe("convex ops guard", () => {
  it("refuses when .env adds a prod deploy key the process env did not show", () => {
    const env = loadConvexCliEnv(
      {},
      {
        envLocal: "CONVEX_DEPLOYMENT=dev:happy-cat-123\n",
        env: `CONVEX_DEPLOY_KEY=prod:fabricated-prod-999|${SECRET}\n`,
      },
    );
    const plan = planOperation(config, { operation: "seed", yes: true, dryRun: true }, env);
    expect(plan.kind).toBe("refused");
    if (plan.kind === "refused") expect(plan.reason).not.toContain(SECRET);
  });

  it("pins unused selectors to empty strings for the child process", async () => {
    let child: Record<string, string | undefined> = {};
    const lines: string[] = [];
    const code = await runConvexOpsCli(["seed", "--yes", "--config", "scripts/convex-ops.config.json"], {
      env: { CONVEX_DEPLOYMENT: "dev:happy-cat-123", PATH: "/usr/bin" },
      readFile: (path: string) => {
        if (path === "scripts/convex-ops.config.json") return readFileSync(new URL("./convex-ops.config.json", import.meta.url), "utf8");
        if (path === ".env") return `CONVEX_DEPLOY_KEY=prod:fabricated-prod-999|${SECRET}\n`;
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
      runner: async (_command: string, _args: readonly string[], env: Record<string, string | undefined>) => {
        child = env;
        return 0;
      },
    });
    expect(code).toBe(2);
    expect(lines.join("\n")).toMatch(/Ambiguous/);
    expect(lines.join("\n")).not.toContain(SECRET);
    expect(child).toEqual({});

    const clean = await runConvexOpsCli(["seed", "--yes", "--dry-run", "--config", "scripts/convex-ops.config.json"], {
      env: { CONVEX_DEPLOYMENT: "dev:happy-cat-123" },
      readFile: (path: string) => {
        if (path === "scripts/convex-ops.config.json") return readFileSync(new URL("./convex-ops.config.json", import.meta.url), "utf8");
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      log: () => {},
      error: () => {},
      runner: async () => 0,
    });
    expect(clean).toBe(0);

    const executed = planOperation(config, { operation: "seed", yes: true, dryRun: false }, { CONVEX_DEPLOYMENT: "dev:happy-cat-123" });
    expect(executed.kind).toBe("execute");
    if (executed.kind === "execute") {
      expect(executed.childEnv?.CONVEX_DEPLOY_KEY).toBe("");
      expect(executed.childEnv?.CONVEX_DEPLOYMENT_TOKEN).toBe("");
      expect(executed.childEnv?.CONVEX_DEPLOYMENT).toBe("dev:happy-cat-123");
      expect(executed.command?.slice(2, 4)).toEqual(["run", "seed:fromFixture"]);
      expect(executed.command?.join(" ")).not.toContain("--prod");
    }
  });

  it("requires --yes and blocks destructive reset on prod", async () => {
    const dev = { CONVEX_DEPLOYMENT: "dev:happy-cat-123" };
    expect(planOperation(config, { operation: "reset", yes: false, dryRun: false, confirmDeployment: "happy-cat-123" }, dev).kind).toBe("needs-confirmation");
    expect(planOperation(config, { operation: "reset", yes: true, dryRun: false }, dev).kind).toBe("refused");
    const prod = resolveDeploymentTarget({ CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` });
    expect(prod.ok).toBe(true);
    if (prod.ok) {
      const plan = planOperation(config, { operation: "reset", yes: true, dryRun: false, confirmDeployment: "big-dog-9" }, { CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` });
      expect(plan.kind).toBe("refused");
      if (plan.kind === "refused") expect(plan.reason).not.toContain(SECRET);
    }
    expect(() => parseOpsConfig({ operations: { reset: { function: "seed:reset", destructive: true, allowedDeploymentTypes: ["prod"] } } })).toThrow(/prod/);
  });

  it("15.9 health without --yes prints the plan and exits 3", async () => {
    const lines: string[] = [];
    const code = await runConvexOpsCli(["health", "--config", "scripts/convex-ops.config.json"], {
      env: { CONVEX_DEPLOYMENT: "dev:happy-cat-123" },
      readFile: (path: string) => {
        if (path === "scripts/convex-ops.config.json") return readFileSync(new URL("./convex-ops.config.json", import.meta.url), "utf8");
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      },
      log: (line: string) => lines.push(line),
      error: (line: string) => lines.push(line),
      runner: async () => 0,
    });
    expect(code).toBe(3);
    expect(lines.join("\n")).toContain("ops:configHealth");
    expect(lines.join("\n")).toContain("Not executed");
  });

  it("15.9 refuses an unknown operation and an ambiguous deployment", () => {
    const dev = { CONVEX_DEPLOYMENT: "dev:happy-cat-123", CONVEX_DEPLOY_KEY: `dev:happy-cat-123|${SECRET}` };
    expect(planOperation(config, { operation: "nope", yes: true, dryRun: true }, { CONVEX_DEPLOYMENT: "dev:happy-cat-123" }).kind).toBe("refused");
    expect(planOperation(config, { operation: "health", yes: true, dryRun: true }, dev).kind).toBe("refused");
  });

  it("15.9 seed and reset are not allowed on local, and reset is refused on prod", () => {
    const local = { CONVEX_DEPLOYMENT: "local:happy-cat-123" };
    expect(planOperation(config, { operation: "seed", yes: true, dryRun: true }, local).kind).toBe("refused");
    expect(planOperation(config, { operation: "reset", yes: true, dryRun: false, confirmDeployment: "happy-cat-123" }, local).kind).toBe("refused");
    const prod = { CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` };
    const plan = planOperation(config, { operation: "reset", yes: true, dryRun: false, confirmDeployment: "big-dog-9" }, prod);
    expect(plan.kind).toBe("refused");
    if (plan.kind === "refused") expect(plan.reason).not.toContain(SECRET);
  });

  it("15.9 drain health inflight and metrics allow prod and reset carries confirmDeployment", () => {
    const prod = { CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` };
    for (const operation of ["drain", "health", "inflight", "metrics"]) {
      expect(planOperation(config, { operation, yes: false, dryRun: false }, prod).kind).toBe("needs-confirmation");
    }
    const dev = { CONVEX_DEPLOYMENT: "dev:happy-cat-123" };
    const reset = planOperation(config, { operation: "reset", yes: false, dryRun: false, confirmDeployment: "happy-cat-123" }, dev);
    expect(reset.kind).toBe("needs-confirmation");
    if (reset.kind === "needs-confirmation" && reset.command !== undefined) {
      const command = reset.command.join(" ");
      expect(command).toContain("seed:reset");
      expect(command).toContain("happy-cat-123");
      expect(command).toContain("fixtureKey");
      expect(command).not.toContain(SECRET);
    }
    const names = Object.keys(config.operations).sort();
    expect(names).toEqual(["drain", "health", "inflight", "metrics", "reset", "seed"]);
  });

  it("parses dotenv the way the Convex CLI does", () => {
    expect(parseDotenv('CONVEX_DEPLOYMENT=dev:happy-cat-123\nCONVEX_DEPLOY_KEY="prod:fabricated|SECRET"\n')).toMatchObject({
      CONVEX_DEPLOYMENT: "dev:happy-cat-123",
      CONVEX_DEPLOY_KEY: "prod:fabricated|SECRET",
    });
  });
});

describe("layer import fixtures", () => {
  it("rejects bare node builtins and unclassified relative imports", () => {
    expect(findLayerImportViolations("core/engine/probe.ts", 'import fs from "fs";').some((item) => item.kind === "builtin")).toBe(true);
    expect(findLayerImportViolations("core/engine/probe.ts", 'import { x } from "../../shared/util";').some((item) => item.kind === "unclassified")).toBe(true);
    expect(findLayerImportViolations("convex/engine/auth.ts", 'import { ConvexError } from "convex/values";')).toEqual([]);
  });
});

describe('wave-0 tool boundaries', () => {
  it('allows test helpers only from test files', () => {
    expect(findLayerImportViolations('convex/test/example.test.ts', 'import "../../tests/helpers/convex";')).toEqual([]);
    expect(findLayerImportViolations('convex/example.test.ts', 'import "../tests/convex-helpers/setup";')).toEqual([]);
    expect(findLayerImportViolations('convex/example.ts', 'import "../tests/convex-helpers/setup";')).not.toEqual([]);
    expect(findLayerImportViolations('convex/test/example.ts', 'import "../../tests/helpers/convex";')).not.toEqual([]);
    expect(findLayerImportViolations('convex/model/example.test.ts', 'import "../../tests/convex-helpers/setup";')).toEqual([]);
    expect(findLayerImportViolations('convex/model/example.ts', 'import "../../tests/convex-helpers/setup";')).not.toEqual([]);
  });
  it('keeps probes out of default projects and watch aligned with offline suites', () => {
    const base = readFileSync('vitest.config.ts', 'utf8');
    expect(base).not.toContain('tests/battery/real-deploy');
    // Battery files now contain offline generated-projection assertions; browsers remain opt-in.
    expect(base).toContain('tests/battery/e2e/**/*.spec.ts');
    expect(base).not.toContain('e2e/stage-b');
    expect(base).toContain('name: "evals"');
    expect(base).toContain('name: "web"');
    expect(readFileSync('tests/watch.config.ts', 'utf8')).toContain('scripts/**/*.test.ts');
    expect(readFileSync('convex/_generated/api.d.ts', 'utf8')).not.toContain('test/helpers');
    const exceptions = JSON.parse(readFileSync('scripts/cooldown-exceptions.json', 'utf8')) as {expires: string}[];
    expect(new Set(exceptions.map(entry => entry.expires)).size).toBeGreaterThan(1);
  });
});


describe('cooldown exception renewal horizon', () => {
  it('spreads every package 14–28 days out from a fixed generation date', () => {
    const generatedAt = Date.parse('2026-10-24T00:00:00Z');
    const exceptions = JSON.parse(readFileSync('scripts/cooldown-exceptions.json', 'utf8')) as {package: string}[];
    const expiries = exceptions.map(entry => cooldownExpiry(entry.package, generatedAt));
    expect(new Set(expiries).size).toBeGreaterThan(1);
    for (const expires of expiries) {
      const days = (Date.parse(expires + 'T00:00:00Z') - generatedAt) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(14);
      expect(days).toBeLessThanOrEqual(28);
    }
    const first = Date.parse(cooldownExpiry('vite@8.3.5', generatedAt));
    const next = Date.parse(cooldownExpiry('vite@8.3.5', generatedAt + 86_400_000));
    expect(next - first).toBe(86_400_000);
  });
});
