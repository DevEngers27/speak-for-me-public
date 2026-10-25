// convex/approvals.ts —— 审批与执行的唯一写入口（接近可编译；外部 helper 见文末“依赖”）。
import { mutation, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { decisionV, rejectReasonKeyV, roleV } from "./schema";
import {
  evaluateApprovalSet, latestDecisionsByUser, deriveOperationId, termsKey,
  MAX_DECISIONS_PER_PROPOSAL, MAX_TASKS_PER_EXECUTION,
  type ExecutionInputs, type ScenarioExecutionPlugin, type Role,
} from "./lib/execution/pure";
import { requireUser } from "./lib/auth"; // identity.tokenIdentifier → users 行；未认证抛 UNAUTHENTICATED
import { assertTransition } from "./lib/state"; // 04 的迁移表
import { getScenario } from "./scenarios/registry"; // scenarioKey → ScenarioExecutionPlugin
import { appendEvent } from "./lib/events"; // 03/07：模板化公共事件
import { assertCents } from "./lib/money";
import { canSeeBudgetReasons } from "./lib/disclosure"; // 07：customer/finance → true
import { onProposalRejected } from "./runs/transitions"; // 04/10：reject 后 run 去向与调度

export type DecideErrorCode =
  | "UNAUTHENTICATED" | "PROPOSAL_NOT_FOUND" | "ROOM_CLOSED"
  | "PROPOSAL_NOT_CURRENT" | "CONSTRAINTS_CHANGED" | "RUN_NOT_AWAITING_APPROVAL"
  | "NOT_A_REQUIRED_APPROVER" | "PROPOSAL_NOT_EXECUTABLE" | "PROPOSAL_ALREADY_EXECUTED"
  | "TOO_MANY_DECISIONS" | "INVARIANT_VIOLATION";

function fail(code: DecideErrorCode, extra: Record<string, unknown> = {}): never {
  throw new ConvexError({ code, ...extra });
}

const decideResultV = v.union(
  v.object({
    kind: v.literal("recorded"),
    decision: decisionV,
    changed: v.boolean(), // false = 与最新决定相同，未写入（双击）
    missingRoles: v.array(roleV),
  }),
  v.object({
    kind: v.literal("executed"),
    executionId: v.id("executions"),
    alreadyExecuted: v.boolean(), // true = 之前已执行，本次未写任何东西
  }),
);

export const decide = mutation({
  args: {
    proposalId: v.id("proposals"),
    decision: decisionV,
    // 人看到的约束版本：审批绑定 (proposalId, constraintsVersion)。不一致即拒绝（核心 3）。
    expectedConstraintsVersion: v.number(),
    reasonKey: v.optional(rejectReasonKeyV), // 仅 reject 使用
  },
  returns: decideResultV,
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    return await decideCore(ctx, user._id, args);
  },
});

/** 公共入口与测试专用入口（testing.decideAs，仅 dev 部署）共用；鉴权之后的全部逻辑在这里。 */
export async function decideCore(
  ctx: MutationCtx,
  userId: Id<"users">,
  args: {
    proposalId: Id<"proposals">; decision: Doc<"approvals">["decision"];
    expectedConstraintsVersion: number; reasonKey?: Doc<"approvals">["reasonKey"];
  },
) {
  // 1. 读取。先做成员检查，再暴露提案的任何状态（不向非成员泄露“已执行”等信息）。
  const proposal = await ctx.db.get("proposals", args.proposalId);
  if (proposal === null) fail("PROPOSAL_NOT_FOUND");
  const member = await ctx.db
    .query("members")
    .withIndex("by_roomId_and_userId", (q) => q.eq("roomId", proposal.roomId).eq("userId", userId))
    .unique();
  if (member === null) fail("PROPOSAL_NOT_FOUND"); // 对非成员与不存在同码，防探测
  const room = (await ctx.db.get("rooms", proposal.roomId))!;
  const run = (await ctx.db.get("runs", proposal.runId))!;

  // 2. 已执行快速路径（D6）。不写审批、不写事件。
  if (proposal.status === "executed") {
    if (args.decision !== "approve") fail("PROPOSAL_ALREADY_EXECUTED");
    const exec = await ctx.db
      .query("executions")
      .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id))
      .unique(); // >1 行会抛错：E1 被破坏时大声失败
    if (exec === null) fail("INVARIANT_VIOLATION", { which: "executed_without_execution" });
    return { kind: "executed" as const, executionId: exec._id, alreadyExecuted: true };
  }

  // 3. 状态守卫（D5 主防线；F04.2 的审批/执行组）。
  if (room.status !== "open") fail("ROOM_CLOSED");
  if (room.currentRunId !== proposal.runId || room.currentProposalId !== proposal._id || proposal.status !== "active")
    fail("PROPOSAL_NOT_CURRENT");
  if (args.expectedConstraintsVersion !== room.constraintsVersion) fail("CONSTRAINTS_CHANGED");
  if (run.status !== "pending_approval") fail("RUN_NOT_AWAITING_APPROVAL");

  // 4. 必需审批人：只看提案快照（D3）。
  const req = proposal.requiredApprovals.find((r) => r.role === member.role);
  if (req === undefined) fail("NOT_A_REQUIRED_APPROVER");

  // 5. approve 前提：此刻可执行（D4）。同一快照，结果复用于执行。
  const plugin = getScenario(room.scenarioKey);
  let inputs: ExecutionInputs | null = null;
  if (args.decision === "approve") {
    inputs = await loadExecutionInputs(ctx, room, proposal);
    const verdict = plugin.validateForExecution(inputs);
    if (!verdict.ok) {
      console.error("approve_on_unexecutable_proposal", { proposalId: proposal._id, cv: room.constraintsVersion });
      fail("PROPOSAL_NOT_EXECUTABLE", canSeeBudgetReasons(member.role) ? { reasonCodes: verdict.reasonCodes } : {});
    }
  }

  // 6. 读本提案全部决定（整个 by_proposalId 区间进入读集 —— 并发审批靠它冲突，见 part3 C2/C4）。
  const rows = await ctx.db
    .query("approvals")
    .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id))
    .take(MAX_DECISIONS_PER_PROPOSAL + 1);
  if (rows.length > MAX_DECISIONS_PER_PROPOSAL) fail("TOO_MANY_DECISIONS");
  const latest = latestDecisionsByUser(rows);
  const mine = latest.get(userId);

  // 7. 逻辑 upsert（D2）：(decision, constraintsVersion) 都相同则不写；否则追加 seq+1。
  //    只比 decision 是错的：cv5 上的 approve 在 cv6 上必须能重新写入（RA-R11）。
  let changed = false;
  if (mine?.decision !== args.decision || mine.constraintsVersion !== room.constraintsVersion) {
    const seq = (mine?.seq ?? 0) + 1;
    const id = await ctx.db.insert("approvals", {
      roomId: room._id, proposalId: proposal._id, runId: run._id, userId,
      role: member.role, kind: req.kind, decision: args.decision,
      seq, constraintsVersion: room.constraintsVersion,
      reasonKey: args.decision === "reject" ? args.reasonKey : undefined, decidedAt: Date.now(),
    });
    latest.set(userId, {
      _id: id, userId, role: member.role, kind: req.kind,
      decision: args.decision, seq, constraintsVersion: room.constraintsVersion,
    });
    changed = true;
    await appendEvent(ctx, {
      roomId: room._id, action: "approval_recorded", actorType: "user", actorRole: member.role,
      proposalId: proposal._id, proposalVersion: proposal.version, constraintsVersion: room.constraintsVersion,
      payload: { decision: args.decision, kind: req.kind, reasonKey: args.reasonKey ?? null },
    });
  }

  // 8. reject：交给 04/10 决定 run 去向（negotiating 或 needs_input）并在同事务调度下一回合。
  //    withdraw：只记录，run 保持 pending_approval（本人的批准不再计入）。
  if (args.decision !== "approve") {
    if (changed && args.decision === "reject") await onProposalRejected(ctx, { room, run, proposal, byRole: member.role });
    return { kind: "recorded" as const, decision: args.decision, changed, missingRoles: [] as Role[] };
  }

  // 9. 集合判定。即使本次 unchanged 也判定：approve 调用是收敛的——成功返回后若已齐则必已执行。
  const members = await ctx.db
    .query("members")
    .withIndex("by_roomId_and_role", (q) => q.eq("roomId", room._id))
    .take(16);
  const set = evaluateApprovalSet({
    required: proposal.requiredApprovals,
    members,
    latest,
    roomConstraintsVersion: room.constraintsVersion,
  });
  if (!set.complete) {
    return { kind: "recorded" as const, decision: args.decision, changed, missingRoles: set.missing.map((m) => m.role) };
  }

  // 10. 执行（D1）：与最后一张 approve 同一事务。
  const executionId = await executeIfComplete(ctx, {
    room, run, proposal, plugin, inputs: inputs!,
    approvalIds: set.approvalIds as Id<"approvals">[], executedBy: userId,
  });
  return { kind: "executed" as const, executionId, alreadyExecuted: false };
}

/** 可被 internal mutation 复用（D1 退路）。调用前提：守卫已在本事务内通过、集合已齐。 */
export async function executeIfComplete(
  ctx: MutationCtx,
  a: {
    room: Doc<"rooms">; run: Doc<"runs">; proposal: Doc<"proposals">;
    plugin: ScenarioExecutionPlugin; inputs: ExecutionInputs;
    approvalIds: Id<"approvals">[]; executedBy: Id<"users">;
  },
): Promise<Id<"executions">> {
  const { room, run, proposal, plugin, inputs } = a;
  const operationId = deriveOperationId(proposal._id);

  // 第二道防线（D5）：守卫通过却已有执行 → E1 被破坏 → fail closed，整笔回滚。
  const dup = await ctx.db
    .query("executions")
    .withIndex("by_operationId", (q) => q.eq("operationId", operationId))
    .first();
  if (dup !== null) fail("INVARIANT_VIOLATION", { which: "duplicate_operation" });

  const plan = plugin.planExecution(inputs);
  if (plan.tasks.length > MAX_TASKS_PER_EXECUTION) fail("INVARIANT_VIOLATION", { which: "too_many_tasks" });
  if (plan.commitment.amountCents !== proposal.amountCents) fail("INVARIANT_VIOLATION", { which: "amount_drift" });
  if (plan.changeOrder.termsKey !== termsKey(proposal)) fail("INVARIANT_VIOLATION", { which: "terms_drift" });
  assertCents(plan.commitment.amountCents);

  const now = Date.now();
  const executionId = await ctx.db.insert("executions", {
    roomId: room._id, runId: run._id, proposalId: proposal._id, proposalVersion: proposal.version,
    constraintsVersion: room.constraintsVersion, operationId, approvalIds: a.approvalIds,
    executedBy: a.executedBy, scenarioKey: plugin.scenarioKey, planVersion: plan.planVersion,
    amountCents: proposal.amountCents,
    committedBeforeCents: inputs.committedCents, // 快照，仅展示
    committedAfterCents: inputs.committedCents + proposal.amountCents,
    totalBudgetCents: inputs.totalBudgetCents,
    executedAt: now,
  });
  await ctx.db.insert("changeOrders", {
    roomId: room._id, executionId, proposalId: proposal._id, ...plan.changeOrder, createdAt: now,
  });
  await ctx.db.insert("commitments", {
    roomId: room._id, kind: "change_order", executionId, operationId,
    amountCents: plan.commitment.amountCents, simulated: plan.commitment.simulated, createdAt: now,
  });
  for (const t of plan.tasks) {
    await ctx.db.insert("tasks", { roomId: room._id, executionId, ...t, status: "todo", createdAt: now });
  }

  assertTransition(run.status, "confirmed");
  await ctx.db.patch("runs", run._id, { status: "confirmed", endedReason: "executed" });
  await ctx.db.patch("proposals", proposal._id, { status: "executed" });
  await appendEvent(ctx, {
    roomId: room._id, action: "executed", actorType: "system",
    proposalId: proposal._id, proposalVersion: proposal.version, constraintsVersion: room.constraintsVersion,
    payload: { executionId, taskCount: plan.tasks.length }, // 不带金额：金额按 07 在查询时投影
  });
  return executionId;
}

/** D7：已承诺金额的唯一计算方式。整个 by_roomId 区间进入读集。 */
export async function getCommittedCents(ctx: MutationCtx, roomId: Id<"rooms">): Promise<number> {
  let sum = 0;
  for await (const c of ctx.db.query("commitments").withIndex("by_roomId", (q) => q.eq("roomId", roomId))) {
    sum += c.amountCents;
  }
  assertCents(sum);
  return sum;
}

async function loadExecutionInputs(ctx: MutationCtx, room: Doc<"rooms">, proposal: Doc<"proposals">): Promise<ExecutionInputs> {
  const budget = await ctx.db.query("budgets").withIndex("by_roomId", (q) => q.eq("roomId", room._id)).unique();
  if (budget === null) fail("INVARIANT_VIOLATION", { which: "missing_budget" });
  // catalog / customerBrief 的读取形状以 03/14 为准；必须走索引并有上界。
  const { catalog, customerBrief } = await loadScenarioFacts(ctx, room._id);
  return {
    proposal: {
      _id: proposal._id, version: proposal.version, itemKeys: proposal.itemKeys,
      deferredItemKeys: proposal.deferredItemKeys, amountCents: proposal.amountCents, deliveryDate: proposal.deliveryDate,
    },
    totalBudgetCents: budget.totalBudgetCents,
    committedCents: await getCommittedCents(ctx, room._id),
    catalog,
    customerBrief,
  };
}

declare function loadScenarioFacts(ctx: MutationCtx, roomId: Id<"rooms">): Promise<Pick<ExecutionInputs, "catalog" | "customerBrief">>;
