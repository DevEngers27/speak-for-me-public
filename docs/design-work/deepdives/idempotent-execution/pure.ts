// convex/lib/execution/pure.ts —— 不依赖 ctx 的纯函数；全部可用普通单测穷举。
// 引擎层：evaluateApprovalSet、latestDecisionsByUser、deriveOperationId、termsKey。
// 场景层接口：ScenarioExecutionPlugin（validateForExecution、planExecution）。

export type Role = "customer" | "provider" | "finance";
export type ApprovalKind = "terms" | "budget";
export type Decision = "approve" | "reject" | "withdraw";
export type RequiredApproval = { role: Role; kind: ApprovalKind };

export type ApprovalRow = {
  _id: string; // Id<"approvals">
  userId: string; // Id<"users">
  role: Role;
  kind: ApprovalKind;
  decision: Decision;
  seq: number;
  constraintsVersion: number;
};
export type MemberRow = { userId: string; role: Role };

/** 每人只取 seq 最大的一行。输入是 by_proposalId 区间的全部行（有上界，见 MAX_DECISIONS_PER_PROPOSAL）。 */
export function latestDecisionsByUser(rows: readonly ApprovalRow[]): Map<string, ApprovalRow> {
  const latest = new Map<string, ApprovalRow>();
  for (const r of rows) {
    const cur = latest.get(r.userId);
    if (cur === undefined || r.seq > cur.seq) latest.set(r.userId, r);
    // seq 相等说明 E2 被破坏：由调用方的不变量检查报告，这里不静默处理
  }
  return latest;
}

export type ApprovalSetResult =
  | { complete: true; approvalIds: string[] } // 与 required 顺序一一对应
  | {
      complete: false;
      missing: RequiredApproval[]; // 尚无有效 approve 的必需项
      rejectedBy: Role[]; // 当前决定为 reject 的角色
    };

/**
 * D3 集合判定。只在守卫通过后调用（proposal 是当前提案、版本一致）。
 * - 必需项来自 proposal.requiredApprovals 快照；
 * - 每项的审批人是“当前成员”中该角色的人；
 * - 该人的最新决定必须是 approve，且 role/kind/constraintsVersion 与要求一致；
 * - 被选中的 userId 两两不同（一人不能顶两个角色）。
 */
export function evaluateApprovalSet(input: {
  required: readonly RequiredApproval[];
  members: readonly MemberRow[];
  latest: ReadonlyMap<string, ApprovalRow>;
  roomConstraintsVersion: number;
}): ApprovalSetResult {
  const missing: RequiredApproval[] = [];
  const rejectedBy: Role[] = [];
  const approvalIds: string[] = [];
  const usedUsers = new Set<string>();

  for (const req of input.required) {
    const holders = input.members.filter((m) => m.role === req.role);
    if (holders.length !== 1) {
      // 0 人：角色空缺；>1 人：成员唯一性被破坏。两者都不能算齐。
      missing.push(req);
      continue;
    }
    const holder = holders[0];
    const row = input.latest.get(holder.userId);
    const valid =
      row !== undefined &&
      row.decision === "approve" &&
      row.role === req.role &&
      row.kind === req.kind &&
      row.constraintsVersion === input.roomConstraintsVersion &&
      !usedUsers.has(holder.userId);
    if (row?.decision === "reject") rejectedBy.push(req.role);
    if (!valid) {
      missing.push(req);
      continue;
    }
    usedUsers.add(holder.userId);
    approvalIds.push(row._id);
  }

  return missing.length === 0
    ? { complete: true, approvalIds }
    : { complete: false, missing, rejectedBy };
}

/** D5：服务端派生，客户端永不提供。不含 constraintsVersion：同一提案可能在多个约束版本上被审批（RA-R11），
 *  但至多执行一次（I5），所以键只按 proposalId（与 versioned-approvals D12 一致；偏离 F08.4 原写法）。 */
export function deriveOperationId(proposalId: string): string {
  return `exec:${proposalId}`;
}

/** F03.7：可读条款指纹；提案不可变，所以它只是展示用证据，不是安全边界。 */
export function termsKey(p: { itemKeys: readonly string[]; amountCents: number; deliveryDate: string }): string {
  return `${[...p.itemKeys].sort().join(",")}|${p.amountCents}|${p.deliveryDate}`;
}

export const MAX_DECISIONS_PER_PROPOSAL = 60; // 3 人 × 20 次切换；超过即拒绝写入（防滥用、保证 collect 有界）
export const MAX_TASKS_PER_EXECUTION = 50; // 与目录条目上限一致（14）

// ---------- 场景插件接口（首个场景的实现在 14） ----------

export type ExecutionInputs = {
  proposal: {
    _id: string;
    version: number;
    itemKeys: string[];
    deferredItemKeys: string[];
    amountCents: number;
    deliveryDate: string;
  };
  totalBudgetCents: number;
  committedCents: number; // 来自 getCommittedCents（D7）
  catalog: ReadonlyArray<{
    itemKey: string;
    title: string;
    priceCents: number;
    status: "unconfirmed" | "confirmed";
    simulated: boolean;
    taskTemplates: ReadonlyArray<{ title: string; assigneeRole: Role }>;
  }>;
  customerBrief: { requiredItemKeys: string[]; deadline: string };
};

export type ReasonCode =
  | "EXCEEDS_BUDGET"
  | "AMOUNT_MISMATCH" // 提案金额 ≠ 目录求和
  | "UNCONFIRMED_ITEM"
  | "UNKNOWN_ITEM"
  | "MISSING_REQUIRED_ITEM"
  | "AFTER_DEADLINE";

export type ExecutionPlan = {
  planVersion: string;
  changeOrder: {
    approvedItemKeys: string[];
    deferredItemKeys: string[];
    amountCents: number;
    deliveryDate: string;
    termsKey: string;
    simulated: boolean;
  };
  commitment: { amountCents: number; simulated: boolean };
  tasks: Array<{ itemKey: string; title: string; assigneeRole: Role; dueDate: string }>;
};

export interface ScenarioExecutionPlugin {
  scenarioKey: string;
  requiredApprovals: readonly RequiredApproval[];
  /** 与 06 的 validateProposal 共用规则；ok=false 时 reasonCodes 非空。 */
  validateForExecution(i: ExecutionInputs): { ok: true } | { ok: false; reasonCodes: ReasonCode[] };
  /** 纯函数、确定性、不调模型；审批预览页用同一函数渲染“批准后将创建的记录”。 */
  planExecution(i: ExecutionInputs): ExecutionPlan;
}

/** 首个场景的预算规则（I5）：执行事务内重算，== 允许（“恰好等于余量”的边界可执行）。 */
export function checkBudget(i: { totalBudgetCents: number; committedCents: number; amountCents: number }): boolean {
  return i.committedCents + i.amountCents <= i.totalBudgetCents;
}
