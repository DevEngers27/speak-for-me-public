// versioned-approvals/standing.ts — 纯函数：审批汇总、提案处境、isExecutable。
// 无 I/O、无 Date.now()，可直接单测（16）。调用者负责在同一事务内读齐输入。
import type { ApprovalKind, Decision, ProposalStatus, Role } from "./schema";

export type ApprovalRow = {
  _id: string;
  proposalId: string;
  userId: string;
  role: Role;
  kind: ApprovalKind;
  decision: Decision;
  constraintsVersion: number;
  seq: number;
};

export type MemberRow = { userId: string; role: Role };

export type RequiredApproval = { role: Role; kind: ApprovalKind };

export type DerivedApprovalState =
  | { state: "approved"; userId: string; decisionId: string }
  | { state: "rejected"; userId: string; decisionId: string }
  | { state: "pending" }
  | { state: "stale_approve"; atConstraintsVersion: number; decisionId: string }
  | { state: "stale_reject"; atConstraintsVersion: number; decisionId: string };

export type ApprovalSummary = {
  perRequirement: Array<RequiredApproval & DerivedApprovalState>;
  complete: boolean; // INV-E3
  anyRejected: boolean;
};

/**
 * 每个 (proposalId, userId) 取 seq 最大的一行即"该用户的最新决定"。
 * 因为 G6 拒绝旧版本上的写入，同一用户的行在 seq 上单调对应非递减的 constraintsVersion，
 * 所以"全局最新一行的 cv === 当前 cv"等价于"当前 cv 上的最新一行"（与 idempotent-execution D2 一致）。
 */
export function latestPerUser(rows: readonly ApprovalRow[]): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  for (const r of rows) {
    const prev = latest.get(r.userId);
    if (!prev || r.seq > prev.seq) latest.set(r.userId, r);
  }
  return latest;
}

/** 某用户在早于 currentCv 的版本上最近一次非 withdraw 决定（用于 stale 展示）。 */
function latestBefore(rows: readonly ApprovalRow[], userId: string, currentCv: number) {
  let best: ApprovalRow | undefined;
  for (const r of rows) {
    if (r.userId !== userId || r.constraintsVersion >= currentCv || r.decision === "withdraw") continue;
    if (!best || r.seq > best.seq) best = r;
  }
  return best;
}

export function summarizeApprovals(input: {
  required: readonly RequiredApproval[]; // proposal.requiredApprovals 快照
  rows: readonly ApprovalRow[]; // 该提案的全部决定（by_proposalId 区间，必须全读，见 08 D10）
  members: readonly MemberRow[]; // 房间当前成员
  currentConstraintsVersion: number;
}): ApprovalSummary {
  const latest = latestPerUser(input.rows);
  const perRequirement: ApprovalSummary["perRequirement"] = [];
  const approvingUsers = new Set<string>();
  let complete = true;
  let anyRejected = false;

  for (const req of input.required) {
    const holder = input.members.find((m) => m.role === req.role); // 首个场景每角色一人
    const row = holder ? latest.get(holder.userId) : undefined;
    const current =
      row && row.constraintsVersion === input.currentConstraintsVersion && row.role === req.role && row.kind === req.kind
        ? row
        : undefined;

    if (current?.decision === "approve" && !approvingUsers.has(current.userId)) {
      approvingUsers.add(current.userId);
      perRequirement.push({ ...req, state: "approved", userId: current.userId, decisionId: current._id });
      continue;
    }
    complete = false;
    if (current?.decision === "reject") {
      anyRejected = true;
      perRequirement.push({ ...req, state: "rejected", userId: current.userId, decisionId: current._id });
      continue;
    }
    // 当前版本上无决定、或最新为 withdraw、或重复 userId：看是否有旧版本决定可展示
    const old = holder ? latestBefore(input.rows, holder.userId, input.currentConstraintsVersion) : undefined;
    if (old && !(current?.decision === "withdraw")) {
      perRequirement.push({
        ...req,
        state: old.decision === "approve" ? "stale_approve" : "stale_reject",
        atConstraintsVersion: old.constraintsVersion,
        decisionId: old._id,
      });
    } else {
      perRequirement.push({ ...req, state: "pending" });
    }
  }
  return { perRequirement, complete, anyRejected };
}

export type RuleResult = { ok: true } | { ok: false; reasonCodes: readonly string[] };

export type ProposalStanding =
  | { standing: "executed" }
  | { standing: "superseded" }
  | { standing: "blocked"; reasonCodes: readonly string[] } // 调用者按查看者角色过滤（07）
  | { standing: "renegotiating" }
  | { standing: "awaiting_approval"; approvals: ApprovalSummary }
  | { standing: "executable"; approvals: ApprovalSummary };

export function deriveProposalStanding(input: {
  proposal: { _id: string; status: ProposalStatus };
  room: { currentProposalId?: string; status: "open" | "closed" };
  currentRunStatus?: string; // room.currentRunId 指向的 run 的状态
  ruleResult: RuleResult; // evaluateProposal(proposal, loadConstraintInputs(room)) —— 06
  approvals: ApprovalSummary;
}): ProposalStanding {
  const { proposal, room } = input;
  if (proposal.status === "executed") return { standing: "executed" };
  if (proposal.status === "superseded" || room.currentProposalId !== proposal._id) return { standing: "superseded" };
  if (!input.ruleResult.ok) return { standing: "blocked", reasonCodes: input.ruleResult.reasonCodes };
  if (room.status !== "open" || input.currentRunStatus !== "pending_approval") return { standing: "renegotiating" };
  if (!input.approvals.complete) return { standing: "awaiting_approval", approvals: input.approvals };
  return { standing: "executable", approvals: input.approvals };
}

/** INV-E1/E2/E3：只在守卫内调用；结果永不入库。 */
export function isExecutable(s: ProposalStanding): boolean {
  return s.standing === "executable";
}
