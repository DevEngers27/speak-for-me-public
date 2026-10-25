import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveDeploymentTarget } from "../src/scripts/deployment-target.ts";
import {
  EXIT,
  formatCommand,
  parseArgsJson,
  parseOpsConfig,
  planOperation,
  type ConvexOpsConfig,
} from "../src/scripts/convex-ops.ts";
import { runConvexOpsCli, type CommandRunner } from "../src/scripts/convex-ops-cli.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Fabricated secret halves; asserted never to appear in output.
const SECRET = "fakesecret0000canary";

// Placeholder function paths: real names come from the consuming repo's config.
const rawConfig = {
  operations: {
    seed: { function: "ops/example:seedThing", destructive: false, allowedDeploymentTypes: ["dev", "local", "preview"] },
    reset: {
      function: "ops/example:resetThing",
      destructive: true,
      allowedDeploymentTypes: ["dev", "local"],
      defaultArgs: { scope: "simulated" },
    },
  },
};
const config = parseOpsConfig(rawConfig);

describe("resolveDeploymentTarget", () => {
  it.each([
    [{ CONVEX_DEPLOYMENT: "dev:happy-cat-123" }, { type: "dev", name: "happy-cat-123", source: "CONVEX_DEPLOYMENT" }],
    [{ CONVEX_DEPLOYMENT: "local:local-team-proj" }, { type: "local", name: "local-team-proj", source: "CONVEX_DEPLOYMENT" }],
    [{ CONVEX_DEPLOY_KEY: `preview:br-42|${SECRET}` }, { type: "preview", name: "br-42", source: "CONVEX_DEPLOY_KEY" }],
    [{ CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` }, { type: "prod", name: "big-dog-9", source: "CONVEX_DEPLOY_KEY" }],
    [{ CONVEX_DEPLOY_KEY: SECRET }, { type: "prod", name: null, source: "CONVEX_DEPLOY_KEY" }],
    [{ CONVEX_SELF_HOSTED_URL: "http://127.0.0.1:3210" }, { type: "self-hosted", name: "127.0.0.1:3210", source: "CONVEX_SELF_HOSTED_URL" }],
  ])("resolves %o", (env, target) => {
    expect(resolveDeploymentTarget(env)).toEqual({ ok: true, target });
  });

  it.each([
    [{}, /No Convex deployment selected/],
    [{ CONVEX_DEPLOYMENT: "dev:a", CONVEX_DEPLOY_KEY: `dev:b|${SECRET}` }, /Ambiguous/],
    [{ CONVEX_DEPLOY_KEY: `project:team:proj|${SECRET}` }, /project key/],
    [{ CONVEX_DEPLOY_KEY: `preview:team:proj|${SECRET}` }, /preview deploy key/],
    [{ CONVEX_DEPLOY_KEY: `weird:x|${SECRET}` }, /unrecognised/],
    [{ CONVEX_DEPLOYMENT: "happy-cat-123" }, /must look like/],
    [{ CONVEX_DEPLOYMENT_TOKEN: SECRET }, /not supported/],
    [{ CONVEX_SELF_HOSTED_ADMIN_KEY: SECRET }, /without CONVEX_SELF_HOSTED_URL/],
  ])("refuses %o", (env, reason) => {
    const result = resolveDeploymentTarget(env);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(reason);
      expect(result.reason).not.toContain(SECRET);
    }
  });
});

describe("parseOpsConfig", () => {
  it.each([
    [{}, /"operations"/],
    [{ operations: {} }, /no operations/],
    [{ operations: { Seed: rawConfig.operations.seed } }, /operation names/],
    [{ operations: { seed: { ...rawConfig.operations.seed, function: "--prod" } } }, /function path/],
    [{ operations: { seed: { ...rawConfig.operations.seed, function: "../x:y" } } }, /function path/],
    [{ operations: { seed: { ...rawConfig.operations.seed, destructive: undefined } } }, /destructive must be a boolean/],
    [{ operations: { seed: { ...rawConfig.operations.seed, allowedDeploymentTypes: [] } } }, /non-empty/],
    [{ operations: { seed: { ...rawConfig.operations.seed, allowedDeploymentTypes: ["staging"] } } }, /unknown type/],
    [{ operations: { reset: { ...rawConfig.operations.reset, allowedDeploymentTypes: ["dev", "prod"] } } }, /never be allowed on "prod"/],
  ])("rejects config %#", (input, error) => {
    expect(() => parseOpsConfig(input)).toThrow(error);
  });

  it("accepts default-export paths and keeps defaults", () => {
    const parsed = parseOpsConfig({
      operations: { seed: { function: "ops/example", destructive: false, allowedDeploymentTypes: ["dev", "dev"] } },
    });
    expect(parsed.operations.seed).toEqual({
      function: "ops/example",
      destructive: false,
      allowedDeploymentTypes: ["dev"],
      defaultArgs: {},
      description: "",
    });
  });

  it("parses --args as a JSON object only", () => {
    expect(parseArgsJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseArgsJson("[1]")).toThrow(/object/);
    expect(() => parseArgsJson("{")).toThrow(/valid JSON/);
  });
});

describe("planOperation guards", () => {
  const dev = { CONVEX_DEPLOYMENT: "dev:happy-cat-123" };
  const base = { yes: false, dryRun: false };

  it("requires --yes before executing", () => {
    const plan = planOperation(config, { ...base, operation: "seed" }, dev);
    expect(plan.kind).toBe("needs-confirmation");
    const confirmed = planOperation(config, { ...base, yes: true, operation: "seed", args: { n: 2 } }, dev);
    expect(confirmed).toEqual({
      kind: "execute",
      target: { type: "dev", name: "happy-cat-123", source: "CONVEX_DEPLOYMENT" },
      command: ["npx", "convex", "run", "ops/example:seedThing", '{"n":2}'],
    });
  });

  it("enforces the deployment-type allowlist", () => {
    const plan = planOperation(config, { ...base, yes: true, operation: "seed" }, { CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` });
    expect(plan).toMatchObject({ kind: "refused" });
    if (plan.kind === "refused") expect(plan.reason).toMatch(/allowed on \[dev, local, preview\]/);
  });

  it("requires a matching --confirm-deployment for destructive operations", () => {
    const missing = planOperation(config, { ...base, yes: true, operation: "reset" }, dev);
    expect(missing).toMatchObject({ kind: "refused" });
    const wrong = planOperation(config, { ...base, yes: true, operation: "reset", confirmDeployment: "other" }, dev);
    expect(wrong).toMatchObject({ kind: "refused" });
    const ok = planOperation(config, { ...base, yes: true, operation: "reset", confirmDeployment: "happy-cat-123" }, dev);
    expect(ok).toMatchObject({ kind: "execute", command: ["npx", "convex", "run", "ops/example:resetThing", '{"scope":"simulated"}'] });
  });

  it("never runs a destructive operation on prod, even with a hand-built config", () => {
    const unsafe: ConvexOpsConfig = {
      operations: {
        reset: { function: "ops/x:y", destructive: true, allowedDeploymentTypes: ["prod"], defaultArgs: {}, description: "" },
      },
    };
    const plan = planOperation(
      unsafe,
      { ...base, yes: true, operation: "reset", confirmDeployment: "big-dog-9" },
      { CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` },
    );
    expect(plan).toMatchObject({ kind: "refused" });
    if (plan.kind === "refused") expect(plan.reason).toMatch(/destructive and can never run against a prod/);
  });

  it("refuses unknown operations and inherited object keys", () => {
    expect(planOperation(config, { ...base, operation: "toString" }, dev)).toMatchObject({ kind: "refused" });
    expect(planOperation(config, { ...base, operation: "nope" }, dev)).toMatchObject({ kind: "refused" });
  });

  it("formats commands for display with shell-safe quoting", () => {
    expect(formatCommand(["npx", "convex", "run", "a:b", `{"k":"it's"}`])).toBe(`npx convex run a:b '{"k":"it'\\''s"}'`);
  });
});

describe("convex-ops CLI", () => {
  function makeIo(env: Record<string, string>) {
    const out: string[] = [];
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    let exitCode = 0;
    const runner: CommandRunner = async (command, args) => {
      calls.push({ command, args });
      return exitCode;
    };
    return {
      out,
      calls,
      setChildExit: (code: number) => {
        exitCode = code;
      },
      io: {
        env,
        readFile: () => JSON.stringify(rawConfig),
        log: (line: string) => out.push(line),
        error: (line: string) => out.push(line),
        runner,
      },
    };
  }

  it("prints the plan and exits 3 without --yes; nothing is spawned", async () => {
    const t = makeIo({ CONVEX_DEPLOY_KEY: `dev:happy-cat-123|${SECRET}` });
    expect(await runConvexOpsCli(["seed"], t.io)).toBe(EXIT.confirmationRequired);
    expect(t.calls).toEqual([]);
    expect(t.out.join("\n")).toContain("re-run with --yes");
    expect(t.out.join("\n")).not.toContain(SECRET);
  });

  it("spawns npx convex run with a fixed argv when confirmed", async () => {
    const t = makeIo({ CONVEX_DEPLOYMENT: "dev:happy-cat-123" });
    expect(await runConvexOpsCli(["reset", "--yes", "--confirm-deployment", "happy-cat-123", "--args", '{"scope":"all"}'], t.io)).toBe(
      EXIT.ok,
    );
    expect(t.calls).toEqual([{ command: "npx", args: ["convex", "run", "ops/example:resetThing", '{"scope":"all"}'] }]);
  });

  it("maps a failing child process to exit 1", async () => {
    const t = makeIo({ CONVEX_DEPLOYMENT: "dev:happy-cat-123" });
    t.setChildExit(7);
    expect(await runConvexOpsCli(["seed", "--yes"], t.io)).toBe(EXIT.commandFailed);
  });

  it("refuses usage errors and bad args with exit 2", async () => {
    const t = makeIo({ CONVEX_DEPLOYMENT: "dev:happy-cat-123" });
    expect(await runConvexOpsCli([], t.io)).toBe(EXIT.refused);
    expect(await runConvexOpsCli(["seed", "reset"], t.io)).toBe(EXIT.refused);
    expect(await runConvexOpsCli(["seed", "--args", "[]"], t.io)).toBe(EXIT.refused);
    expect(await runConvexOpsCli(["seed", "--prod"], t.io)).toBe(EXIT.refused);
    expect(t.calls).toEqual([]);
  });

  it("runs as a real Node process in --dry-run mode without spawning npx", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sfm-convex-ops-"));
    const configFile = path.join(dir, "convex-ops.config.json");
    writeFileSync(configFile, JSON.stringify(rawConfig));
    const run = spawnSync(process.execPath, ["src/scripts/convex-ops-cli.ts", "seed", "--config", configFile, "--dry-run"], {
      cwd: root,
      encoding: "utf8",
      // Empty PATH: if anything tried to spawn npx it would fail loudly.
      env: { PATH: "", CONVEX_DEPLOY_KEY: `preview:br-42|${SECRET}` },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('preview deployment "br-42" selected by CONVEX_DEPLOY_KEY');
    expect(run.stdout).toContain("Would run: npx convex run ops/example:seedThing '{}'");
    expect(run.stdout + run.stderr).not.toContain(SECRET);
  });
});

describe("example config template", () => {
  it("parses and keeps reset off prod", () => {
    const example = parseOpsConfig(JSON.parse(readFileSync(path.join(root, "templates/convex-ops.config.example.json"), "utf8")));
    expect(example.operations.reset?.destructive).toBe(true);
    expect(example.operations.reset?.allowedDeploymentTypes).not.toContain("prod");
  });
});
