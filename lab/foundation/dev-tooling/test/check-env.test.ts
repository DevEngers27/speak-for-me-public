import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkEnv, DEFAULT_ENV_SPEC, formatEnvReport, validateSpec, type EnvVarSpec } from "../src/scripts/check-env.ts";
import { parseEnvSpec } from "../src/scripts/spec-file.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Fabricated canary values: tests assert they never appear in any output.
const CANARY = "canary-value-7f3a9c";

const spec: EnvVarSpec[] = [
  { name: "NEXT_PUBLIC_A", location: "next-public", required: true, description: "" },
  { name: "SERVER_B", location: "next-server", required: true, description: "" },
  { name: "OPTIONAL_C", location: "cli", required: false, description: "" },
  { name: "REMOTE_D", location: "convex-deployment", required: true, description: "" },
];

describe("checkEnv", () => {
  it("reports set / missing / remote without values", () => {
    const report = checkEnv(spec, { NEXT_PUBLIC_A: CANARY, SERVER_B: "   ", REMOTE_D: CANARY });
    expect(report.entries.map((e) => [e.name, e.status])).toEqual([
      ["NEXT_PUBLIC_A", "set"],
      ["SERVER_B", "missing"],
      ["OPTIONAL_C", "missing"],
      ["REMOTE_D", "remote"],
    ]);
    expect(report.missingRequired).toEqual(["SERVER_B"]);
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain(CANARY);
    expect(formatEnvReport(report)).not.toContain(CANARY);
  });

  it("passes when every locally checkable required variable is set", () => {
    const report = checkEnv(spec, { NEXT_PUBLIC_A: CANARY, SERVER_B: CANARY });
    expect(report.ok).toBe(true);
    expect(formatEnvReport(report)).toContain("npx convex env list");
  });

  it("warns about secret-looking NEXT_PUBLIC_ variables that are set", () => {
    const report = checkEnv(spec, {
      NEXT_PUBLIC_A: CANARY,
      SERVER_B: CANARY,
      NEXT_PUBLIC_STRIPE_SECRET: CANARY,
      NEXT_PUBLIC_API_KEY_X: "",
    });
    expect(report.exposureWarnings).toEqual(["NEXT_PUBLIC_STRIPE_SECRET"]);
    expect(report.ok).toBe(false);
    expect(formatEnvReport(report)).not.toContain(CANARY);
  });

  it("ships a default spec that validates and keeps model keys on the Convex side", () => {
    expect(() => validateSpec(DEFAULT_ENV_SPEC)).not.toThrow();
    const anthropic = DEFAULT_ENV_SPEC.find((s) => s.name === "ANTHROPIC_API_KEY");
    expect(anthropic?.location).toBe("convex-deployment");
  });

  it.each([
    [[{ name: "lower", location: "cli", required: true, description: "" }], /Invalid variable name/],
    [[{ name: "PUBLIC_X", location: "next-public", required: true, description: "" }], /NEXT_PUBLIC_ prefix/],
    [[{ name: "NEXT_PUBLIC_X", location: "next-server", required: true, description: "" }], /ship it to browsers/],
    [
      [
        { name: "A", location: "cli", required: true, description: "" },
        { name: "A", location: "cli", required: false, description: "" },
      ],
      /Duplicate/,
    ],
  ] as Array<[EnvVarSpec[], RegExp]>)("rejects invalid spec %#", (bad, error) => {
    expect(() => validateSpec(bad)).toThrow(error);
  });

  it("parses spec files strictly", () => {
    expect(parseEnvSpec([{ name: "A", location: "cli", required: false }])).toEqual([
      { name: "A", location: "cli", required: false, description: "" },
    ]);
    expect(() => parseEnvSpec({})).toThrow(/array/);
    expect(() => parseEnvSpec([{ name: "A", location: "elsewhere", required: true }])).toThrow(/location/);
    expect(() => parseEnvSpec([{ name: "A", location: "cli", required: "yes" }])).toThrow(/required/);
  });
});

describe("check-env CLI", () => {
  // The child gets an explicit, fabricated environment; nothing is inherited.
  function run(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, ["src/scripts/check-env-cli.ts", ...args], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", ...env },
    });
  }

  it("exits 1 when required variables are missing and 0 with --allow-missing", () => {
    const failing = run([], {});
    expect(failing.status).toBe(1);
    expect(failing.stdout).toContain("NEXT_PUBLIC_CONVEX_URL");
    expect(failing.stdout).toContain("missing");
    expect(run(["--allow-missing"], {}).status).toBe(0);
  });

  it("exits 0 when the Next-side variables are present and never prints values", () => {
    const result = run(["--json"], {
      NEXT_PUBLIC_CONVEX_URL: CANARY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: CANARY,
      CLERK_SECRET_KEY: CANARY,
    });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(CANARY);
    const report = JSON.parse(result.stdout) as { ok: boolean };
    expect(report.ok).toBe(true);
  });

  it("does not waive exposure warnings with --allow-missing", () => {
    const result = run(["--allow-missing"], { NEXT_PUBLIC_SECRET_THING: CANARY });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("WARNING NEXT_PUBLIC_SECRET_THING");
    expect(result.stdout).not.toContain(CANARY);
  });

  it("accepts a custom spec file and rejects bad usage", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sfm-check-env-"));
    const specFile = path.join(dir, "spec.json");
    writeFileSync(specFile, JSON.stringify([{ name: "ONLY_THIS", location: "next-server", required: true }]));
    expect(run(["--spec", specFile], { ONLY_THIS: CANARY }).status).toBe(0);
    expect(run(["--spec", specFile], {}).status).toBe(1);
    writeFileSync(specFile, "not json");
    expect(run(["--spec", specFile], {}).status).toBe(2);
    expect(run(["--unknown-flag"], {}).status).toBe(2);
  });
});
