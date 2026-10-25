// versioned-approvals/constraints.ts — 约束版本的唯一入口（设计稿）。
// 依赖：06 的 loadConstraintInputs / evaluateProposal / preflightFeasibility；
//       04/10 的 assertTransition / supersedeRun / startRun；07 的事件模板。
import type { MutationCtx } from "../_generated/server"; // 实现时的路径
import type { Id } from "../_generated/dataModel";
import type { ConstraintCause, Role, RunEffect } from "./schema";

/** 硬投影：被 evaluateProposal 读取的字段的规范化形式（D5）。只在服务端内存中存在，从不持久化。 */
export type HardProjection = {
  totalBudgetCents: number | null;
  customer: { requiredItemKeys: string[]; deferrableItemKeys: string[]; deadline: string | null } | null;
  catalog: Array<{ itemKey: string; catalogItemId: string; priceCents: number; deliveryDate: string | null }>;
  requiredApprovals: Array<{ role: Role; kind: string }>;
};

export type ConstraintInputs = HardProjection & {
  committedCents: number; // 台账实时汇总；不在投影比较中（D9）
  softPreferences: { preferredDate: string | null }; // 不在投影比较中（D5）
};

declare function loadConstraintInputs(ctx: MutationCtx, roomId: Id<"rooms">): Promise<ConstraintInputs>; // 06

export function hardProjection(i: ConstraintInputs): HardProjection {
  const sort = (xs: string[]) => [...xs].sort();
  return {
    totalBudgetCents: i.totalBudgetCents,
    customer: i.customer && {
      requiredItemKeys: sort(i.customer.requiredItemKeys),
      deferrableItemKeys: sort(i.customer.deferrableItemKeys),
      deadline: i.customer.deadline,
    },
    catalog: [...i.catalog].sort((a, b) => a.itemKey.localeCompare(b.itemKey)),
    requiredApprovals: [...i.requiredApprovals].sort((a, b) => (a.role + a.kind).localeCompare(b.role + b.kind)),
  };
}

/** 规范化后逐字段比较；用 JSON 字符串是因为投影已排序且只含原始类型。 */
export function equalHard(a: HardProjection, b: HardProjection): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ConstraintActor =
  | { actorType: "user"; role: Role; userId: string }
  | { actorType: "system" };

export type SourceRef =
  | { kind: "budgetChange"; id: Id<"budgetChanges"> }
  | { kind: "briefVersion"; id: Id<"briefVersions"> }
  | { kind: "catalogItem"; id: Id<"catalogItems"> }
  | { kind: "humanRequest"; id: Id<"humanRequests"> };

/**
 * 所有可能改变硬约束的写入都包在这里（INV-C3/C4）。
 * apply 返回它写入的源记录引用；投影无变化时不 bump，返回 { bumped: false }。
 */
export async function withConstraintChange<T>(
  ctx: MutationCtx,
  args: { roomId: Id<"rooms">; causes: ConstraintCause[]; actor: ConstraintActor; triggerHint?: "human_answer" },
  apply: () => Promise<{ result: T; sourceRefs: SourceRef[] }>,
): Promise<{ result: T; bumped: false } | { result: T; bumped: true; newVersion: number; runEffect: RunEffect }> {
  const room = await ctx.db.get(args.roomId);
  if (!room || room.status !== "open") throw new Error("ROOM_CLOSED"); // 实际用 ConvexError({ code })
  const before = hardProjection(await loadConstraintInputs(ctx, args.roomId));
  const { result, sourceRefs } = await apply();
  const after = hardProjection(await loadConstraintInputs(ctx, args.roomId)); // 同事务读回自己的写入
  if (equalHard(before, after)) return { result, bumped: false };
  const { newVersion, runEffect } = await bumpConstraints(ctx, { ...args, sourceRefs });
  return { result, bumped: true, newVersion, runEffect };
}

/** 唯一改变 rooms.constraintsVersion 的函数（INV-C1）。不导出为 Convex 函数，只能被 withConstraintChange 调用。 */
async function bumpConstraints(
  ctx: MutationCtx,
  args: { roomId: Id<"rooms">; causes: ConstraintCause[]; actor: ConstraintActor; sourceRefs: SourceRef[]; triggerHint?: "human_answer" },
): Promise<{ newVersion: number; runEffect: RunEffect }> {
  const room = (await ctx.db.get(args.roomId))!;
  const previousVersion = room.constraintsVersion;
  const newVersion = previousVersion + 1;
  await ctx.db.patch(args.roomId, { constraintsVersion: newVersion });

  // 被作废的决定数：当前提案上在 previousVersion 下的有效 approve/reject（仅计数，用于事件与审计）
  let invalidatedDecisionCount = 0;
  if (room.currentProposalId) {
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_proposalId_and_constraintsVersion", (q) =>
        q.eq("proposalId", room.currentProposalId!).eq("constraintsVersion", previousVersion))
      .collect();
    invalidatedDecisionCount = countEffectiveDecisions(rows);
  }

  const revisionId = await ctx.db.insert("constraintRevisions", {
    roomId: args.roomId, version: newVersion, previousVersion,
    causes: args.causes, sourceRefs: args.sourceRefs,
    actorType: args.actor.actorType,
    actorRole: args.actor.actorType === "user" ? args.actor.role : undefined,
    actorUserId: args.actor.actorType === "user" ? args.actor.userId : undefined,
    runEffect: "none", invalidatedDecisionCount, createdAt: Date.now(),
  });

  // 源表回填 producedConstraintsVersion
  for (const ref of args.sourceRefs) {
    if (ref.kind !== "humanRequest") await ctx.db.patch(ref.id, { producedConstraintsVersion: newVersion });
  }

  // INV-H1：取消所有 open 人工请求（引发本次 bump 的那条已由调用者先置 answered）
  const open = await ctx.db
    .query("humanRequests")
    .withIndex("by_roomId_and_status", (q) => q.eq("roomId", args.roomId).eq("status", "open"))
    .collect();
  for (const r of open) await ctx.db.patch(r._id, { status: "cancelled", cancelledByRevision: revisionId });

  const effect = await reconcileAfterBump(ctx, { roomId: args.roomId, newVersion, revisionId, triggerHint: args.triggerHint });
  await ctx.db.patch(revisionId, effect.patch);

  await writeEvent(ctx, { roomId: args.roomId, action: "constraints_changed", constraintsVersion: newVersion,
    actorRole: args.actor.actorType === "user" ? args.actor.role : undefined, causes: args.causes });
  if (invalidatedDecisionCount > 0)
    await writeEvent(ctx, { roomId: args.roomId, action: "approval_invalidated", constraintsVersion: newVersion,
      count: invalidatedDecisionCount });
  return { newVersion, runEffect: effect.patch.runEffect };
}

/** part3 §1.1 的分支表。所有 run 迁移经 assertTransition（04）。 */
async function reconcileAfterBump(
  ctx: MutationCtx,
  a: { roomId: Id<"rooms">; newVersion: number; revisionId: Id<"constraintRevisions">; triggerHint?: "human_answer" },
): Promise<{ patch: { runEffect: RunEffect; supersededRunId?: Id<"runs">; startedRunId?: Id<"runs"> } }> {
  const room = (await ctx.db.get(a.roomId))!;
  const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
  const ACTIVE = ["negotiating", "pending_approval", "needs_input", "failed"];
  if (!run || !ACTIVE.includes(run.status)) return { patch: { runEffect: "none" } };

  const inputs = await loadConstraintInputs(ctx, a.roomId);
  if (run.status === "pending_approval" && room.currentProposalId) {
    const proposal = (await ctx.db.get(room.currentProposalId))!;
    if (evaluateProposal(proposal, inputs).ok) {
      await writeEvent(ctx, { roomId: a.roomId, action: "reapproval_required", constraintsVersion: a.newVersion,
        proposalId: proposal._id, proposalVersion: proposal.version });
      return { patch: { runEffect: "kept_pending_approval" } }; // D6：不复制、不重谈
    }
  }

  await supersedeRun(ctx, run._id, "constraints_changed"); // 04：assertTransition(run.status, 'superseded')；尽力 cancel 已调度 action
  const trigger = a.triggerHint ?? "constraints_change";
  const newRunId = await startRun(ctx, { roomId: a.roomId, trigger, constraintsVersionAtStart: a.newVersion });
  const pre = preflightFeasibility(inputs); // 06：总额 < 已承诺、目录无合规组合 → infeasible
  if (!pre.feasible) await moveToNeedsInput(ctx, newRunId, pre); // 05：生成 humanRequest，不调用模型
  else await scheduleFirstTurn(ctx, newRunId); // 10：写 turn.constraintsVersion = newVersion，runAfter(0, ...)
  return { patch: { runEffect: "run_superseded", supersededRunId: run._id, startedRunId: newRunId } };
}

function countEffectiveDecisions(rows: Array<{ userId: string; seq: number; decision: string }>): number {
  const latest = new Map<string, { seq: number; decision: string }>();
  for (const r of rows) { const p = latest.get(r.userId); if (!p || r.seq > p.seq) latest.set(r.userId, r); }
  return [...latest.values()].filter((r) => r.decision !== "withdraw").length;
}

// ---- 外部依赖（其他专题定义）----
declare function evaluateProposal(p: unknown, i: ConstraintInputs): { ok: true } | { ok: false; reasonCodes: string[] };
declare function preflightFeasibility(i: ConstraintInputs): { feasible: true } | { feasible: false; reasonCodes: string[] };
declare function supersedeRun(ctx: MutationCtx, runId: Id<"runs">, reason: "constraints_changed"): Promise<void>;
declare function startRun(ctx: MutationCtx, a: { roomId: Id<"rooms">; trigger: "constraints_change" | "human_answer"; constraintsVersionAtStart: number }): Promise<Id<"runs">>;
declare function moveToNeedsInput(ctx: MutationCtx, runId: Id<"runs">, pre: { feasible: false; reasonCodes: string[] }): Promise<void>;
declare function scheduleFirstTurn(ctx: MutationCtx, runId: Id<"runs">): Promise<void>;
declare function writeEvent(ctx: MutationCtx, e: Record<string, unknown>): Promise<void>;
