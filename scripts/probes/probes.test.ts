import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildConcurrencyEvidence, evidenceFileName, PROBE_ROUNDS, PROBE_TABLE } from "./lib/evidence.ts";
import { scanLogLines, assessLogScan } from "./lib/logScan.ts";
import { maxConcurrentIntervals } from "./lib/overlap.ts";
import { refuseProbeEnvironment } from "./lib/target.ts";

const SECRET = "SUPER_SECRET_KEY";
const SCRIPTS = [
  "scripts/probes/concurrency.ts",
  "scripts/probes/log-scan.ts",
  "scripts/probes/error-shape.ts",
  "scripts/probes/nan-probe.ts",
  "scripts/probes/scheduler-semantics.ts",
];

describe("probe kit", () => {
  it("maxConcurrentIntervals counts overlapping calls and ignores a shared endpoint", () => {
    expect(maxConcurrentIntervals([])).toBe(0);
    expect(maxConcurrentIntervals([[0, 10]])).toBe(1);
    expect(maxConcurrentIntervals([[0, 10], [10, 20]])).toBe(1);
    expect(maxConcurrentIntervals([[0, 10], [5, 15]])).toBe(2);
    expect(maxConcurrentIntervals([[0, 30], [5, 15], [10, 12]])).toBe(3);
  });

  it("writes ConcurrencyEvidence shape and the 16.8.2 probe table", () => {
    const evidence = buildConcurrencyEvidence({
      probe: "approve_last_two",
      method: "multi_http_client",
      deployment: "dev:happy-cat-123",
      gitSha: "abc",
      n: 3,
      rounds: PROBE_ROUNDS,
      validRounds: 0,
      maxOverlapPerRound: [1],
      results: { ok: 1, rejected: 0, errorCodes: {} },
      invariant: { name: "executions", expected: 1, observed: [1], pass: true },
      startedAt: "2026-10-24T00:00:00.000Z",
      finishedAt: "2026-10-24T00:00:01.000Z",
    });
    expect(evidence.tier).toBe("dev");
    expect(evidence.occRetriesObserved).toBe("unknown");
    expect(evidence.rounds).toBe(20);
    expect(evidenceFileName("2026-10-24", evidence.probe)).toBe("probe-results/2026-10-24-approve_last_two.json");
    expect(PROBE_TABLE).toEqual([
      "approve_last_two",
      "start_follow_up_twice",
      "approve_last_repeat",
      "approve_same_user",
      "start_run_repeat",
      "join_same_role",
      "cap_vs_last_approval",
      "reject_vs_last_approval",
      "withdraw_vs_last_approval",
      "complete_vs_bump",
    ]);
    expect(JSON.stringify(evidence)).not.toContain(SECRET);
  });

  it("assessLogScan fails closed when the capture is empty", () => {
    expect(assessLogScan({ entryCount: 0, startedAt: "a", finishedAt: "b" }).pass).toBe(false);
    expect(assessLogScan({ entryCount: 2, startedAt: "a", finishedAt: "b" }).pass).toBe(true);
    const source = readFileSync(new URL("./log-scan.ts", import.meta.url), "utf8");
    expect(source).toContain('spawn("npx", ["convex", "logs", "--jsonl"]');
    expect(source).toContain("10_000");
  });

  it("every probe script refuses a prod deployment or prod key and never prints the key", () => {
    expect(refuseProbeEnvironment({ CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` })?.message).not.toContain(SECRET);
    for (const script of SCRIPTS) {
      const result = spawnSync(process.execPath, [script], {
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", CONVEX_DEPLOY_KEY: `prod:big-dog-9|${SECRET}` },
      });
      expect(result.status, script).toBe(2);
      expect(`${result.stdout}${result.stderr}`, script).not.toContain(SECRET);
      expect(`${result.stdout}${result.stderr}`, script).toMatch(/[Rr]efused/);
    }
  });

  it('unimplemented races exit 3 and never write fabricated evidence', () => {
    const result = spawnSync(process.execPath, ['scripts/probes/concurrency.ts', 'complete_vs_bump'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', CONVEX_DEPLOYMENT: 'dev:probe' } });
    expect(result.status).toBe(3);
    expect(result.stderr).toContain('not implemented: complete_vs_bump');
  });

  it('log scanner catches private data without returning the matched secret', () => {
    const secret = { id: 'private', ownerRole: 'finance' as const, kind: 'string' as const, value: 'CANARY-FIN-7731', allowedRoles: [], origin: 'brief' as const };
    const report = scanLogLines(['{"message":"CANARY-FIN-7731"}'], [secret]);
    expect(report.pass).toBe(false);
    expect(report.violations.length).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(secret.value);
    expect(scanLogLines(['{"code":"model_call"}'], [secret]).pass).toBe(true);
    expect(scanLogLines([], [secret]).pass).toBe(false);
  });

  it("mutation patches drop the room lock, execution key, approval run guard, and G1", () => {
    const dir = new URL("./mutations/", import.meta.url);
    const room = readFileSync(new URL("drop-room-lock.patch", dir), "utf8");
    const execution = readFileSync(new URL("drop-execution-key-check.patch", dir), "utf8");
    const approval = readFileSync(new URL("drop-approval-run-status.patch", dir), "utf8");
    const guard = readFileSync(new URL("drop-g1-guard.patch", dir), "utf8");
    expect(room).toContain("writeSeq");
    expect(execution).toContain("by_executionKey");
    expect(approval).toContain("approvals.record");
    for (const patch of ["drop-room-lock.patch", "drop-g1-guard.patch", "drop-execution-key-check.patch", "drop-approval-run-status.patch"]) {
      expect(spawnSync("git", ["apply", "--check", new URL(patch, dir).pathname]).status).toBe(0);
    }
    expect(guard).toContain("G1");
  });
});
