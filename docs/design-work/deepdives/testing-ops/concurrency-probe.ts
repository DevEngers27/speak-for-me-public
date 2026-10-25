// 示例：scripts/probes/concurrency.ts —— L2 真实部署并发证据（§3.6，方法 a）。设计稿，未运行。
// 运行：CONVEX_DEPLOYMENT=<dev 或 staging 部署> node scripts/probes/concurrency.ts approve_last_two 5
// 前置：目标部署 DEPLOYMENT_TIER ∈ {dev, staging}；探针身份 issuer 默认 https://convex.test
//（CLI 源码 NM:convex/src/cli/lib/run.ts:143-163：tokenIdentifier = `${issuer}|${subject}`）。
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

type RunResult = { code: number; stdout: string; stderr: string };

function convexRun(fn: string, args: unknown, identity?: object): Promise<RunResult> {
  const argv = ["convex", "run", fn, JSON.stringify(args)];
  if (identity) argv.push("--identity", JSON.stringify(identity));
  return new Promise((resolve) => {
    const p = spawn("npx", argv, { env: process.env });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

const probeIdentity = (role: "customer" | "provider" | "finance") => ({ subject: `probe-${role}` });

function errorCodeOf(r: RunResult): string {
  const m = /"code"\s*:\s*"([A-Z_]+)"/.exec(r.stderr + r.stdout);
  return r.code === 0 ? "OK" : (m?.[1] ?? "UNKNOWN");
}

async function approveLastTwo(n: number) {
  // 1) 新房间 + 成员 + 推进到"待批且 provider 已批"。devProbe.setupPendingApproval 内部依次调用
  //    与生产相同的 handler（确认简报 → stub 模式 startRun → provider decide），不直接写审批表（核心 8）。
  const setup = await convexRun("devProbe:setupPendingApproval", {
    fixtureKey: "feasible",
    members: {
      customer: `https://convex.test|probe-customer`,
      provider: `https://convex.test|probe-provider`,
      finance: `https://convex.test|probe-finance`,
    },
    preApprovedRoles: ["provider"],
  });
  if (setup.code !== 0) throw new Error("setup failed");
  const { roomId, proposalId } = JSON.parse(setup.stdout) as { roomId: string; proposalId: string };

  // 2) customer 与 finance 的最后两票各并发 n 次
  const calls: Promise<RunResult>[] = [];
  for (let i = 0; i < n; i++) {
    for (const role of ["customer", "finance"] as const) {
      calls.push(convexRun("approvals:decide", { proposalId, decision: "approve" }, probeIdentity(role)));
    }
  }
  const startedAt = new Date().toISOString();
  const results = await Promise.all(calls);
  const finishedAt = new Date().toISOString();

  // 3) 读取计数（internal 查询，admin 权限；能否直接调用 internal：待验证 V6）
  const counts = JSON.parse(
    (await convexRun("devProbe:executionCounts", { roomId })).stdout,
  ) as { executions: number; changeOrderCommitments: number; tasks: number; expectedTasks: number; executedEvents: number };

  const errorCodes: Record<string, number> = {};
  for (const r of results) errorCodes[errorCodeOf(r)] = (errorCodes[errorCodeOf(r)] ?? 0) + 1;

  const pass =
    counts.executions === 1 &&
    counts.changeOrderCommitments === 1 &&
    counts.tasks === counts.expectedTasks &&
    counts.executedEvents === 1;

  const evidence = {
    probe: "approve_last_two",
    method: "parallel_cli",
    deployment: process.env.CONVEX_DEPLOYMENT ?? "unknown",
    tier: "dev",
    gitSha: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    n,
    roomId,
    results: { ok: errorCodes.OK ?? 0, rejected: results.length - (errorCodes.OK ?? 0), errorCodes },
    invariant: { name: "one_execution_per_proposal", expected: 1, observed: counts.executions, pass },
    occRetriesObserved: "unknown", // 由 `npx convex insights` 人工补填（待验证 V8）
    startedAt,
    finishedAt,
  };
  mkdirSync("probe-results", { recursive: true });
  writeFileSync(`probe-results/${finishedAt.slice(0, 10)}-approve_last_two-cli.json`, JSON.stringify(evidence, null, 2));
  if (!pass) process.exitCode = 1;
}

const [probe, nArg] = process.argv.slice(2);
if (probe === "approve_last_two") await approveLastTwo(Number(nArg ?? "5"));
else throw new Error(`unknown probe ${probe}`);

// 方法 (b)：convex/devProbe.ts 中 internalAction parallel({ calls }) 对每个调用
// ctx.runMutation(internal.devProbe.asIdentity, { tokenIdentifier, fn: "approvals.decide", args })，
// 用 Promise.all 发出；asIdentity 复用公开 mutation 的 handler（公开函数 = 取身份 + 调 handler）。
// devProbe.ts 每个导出的入口第一行 assertTier(["dev", "staging"])。
