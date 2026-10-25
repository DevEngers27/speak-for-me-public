// versioned-approvals/decide.ts — decideOnProposal 骨架与守卫顺序（设计稿，part2 §4.1）。
// 执行本体 executeProposalInTx 归 08（见 deepdives/idempotent-execution），拒绝后的 run 迁移归 04/05。
import { mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { decisionV } from "./schema";
import { summarizeApprovals, deriveProposalStanding, isExecutable } from "./standing";

const APPROVAL_KIND_BY_ROLE = { customer: "terms", provider: "terms", finance: "budget" } as const;

export const decideOnProposal = mutation({
  args: {
    proposalId: v.id("proposals"),
    decision: decisionV,
    expectedConstraintsVersion: v.number(), // D3：用户看到的约束版本
    reasonCode: v.optional(v.string()), // reject 必填（07 定义枚举）
    note: v.optional(v.string()), // 本人私有；长度上限在代码里校验
  },
  returns: v.union(
    v.object({ status: v.literal("recorded"), decisionId: v.id("approvals") }),
    v.object({ status: v.literal("unchanged"), decisionId: v.id("approvals") }),
    v.object({ status: v.literal("executed"), changeOrderId: v.id("changeOrders") }),
  ),
  handler: async (ctx, args) => {
    // G1 身份与成员
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new ConvexError({ code: "NOT_FOUND" });
    const userId = identity.tokenIdentifier;
    const member = await ctx.db
      .query("members")
      .withIndex("by_roomId_and_userId", (q) => q.eq("roomId", proposal.roomId).eq("userId", userId))
      .unique();
    if (!member) throw new ConvexError({ code: "NOT_FOUND" }); // 非成员与不存在同码，避免探测（07）
    const role = member.role;
    const kind = APPROVAL_KIND_BY_ROLE[role];

    // G2 按快照判定必需审批人
    if (!proposal.requiredApprovals.some((r) => r.role === role && r.kind === kind))
      throw new ConvexError({ code: "NOT_REQUIRED_APPROVER" });

    const room = (await ctx.db.get(proposal.roomId))!;
    // G9（先于 G3–G6）：最后一票双击的第二次调用在 OCC 重试后看到 executed → 幂等成功
    if (proposal.status === "executed" && args.decision === "approve") {
      const co = await ctx.db
        .query("changeOrders")
        .withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id))
        .unique();
      const mine = await latestDecision(ctx, proposal._id, userId);
      if (co && mine?.decision === "approve") return { status: "executed" as const, changeOrderId: co._id };
      throw new ConvexError({ code: "ALREADY_EXECUTED" });
    }
    // G3
    if (room.status !== "open") throw new ConvexError({ code: "ROOM_CLOSED" });
    // G4
    if (room.currentProposalId !== proposal._id || proposal.status !== "active")
      throw new ConvexError({ code: "NOT_CURRENT_PROPOSAL" });
    // G5 看当前 run，不看 proposal.runId
    const run = room.currentRunId ? await ctx.db.get(room.currentRunId) : null;
    if (!run || run.status !== "pending_approval") throw new ConvexError({ code: "NOT_AWAITING_APPROVAL" });
    // G6 比较并设置
    if (room.constraintsVersion !== args.expectedConstraintsVersion)
      throw new ConvexError({ code: "CONSTRAINTS_CHANGED", currentConstraintsVersion: room.constraintsVersion });

    // G7 仅 approve：在当前约束下重算规则（INV-R1 保证正常必过；防御性）
    const inputs = await loadConstraintInputs(ctx, room._id); // 读 budgets、commitments 区间等（08 D10：防写偏斜）
    const rule = evaluateProposal(proposal, inputs);
    if (args.decision === "approve" && !rule.ok)
      throw new ConvexError({ code: "PROPOSAL_INVALID", reasonCodes: filterReasonCodesForRole(rule.reasonCodes, role) });
    if (args.decision === "reject" && !args.reasonCode) throw new ConvexError({ code: "REASON_REQUIRED" });

    // G8 去重
    const last = await latestDecision(ctx, proposal._id, userId);
    const lastAtCurrent = last && last.constraintsVersion === room.constraintsVersion ? last : undefined;
    if (args.decision === "withdraw" && (!lastAtCurrent || lastAtCurrent.decision === "withdraw"))
      throw new ConvexError({ code: "NOTHING_TO_WITHDRAW" });
    if (lastAtCurrent && lastAtCurrent.decision === args.decision)
      return { status: "unchanged" as const, decisionId: lastAtCurrent._id };

    // 写入（只追加）
    const decisionId = await ctx.db.insert("approvals", {
      roomId: room._id, proposalId: proposal._id, proposalVersion: proposal.version,
      userId, role, kind, decision: args.decision,
      constraintsVersion: room.constraintsVersion, seq: (last?.seq ?? 0) + 1,
      reasonCode: args.reasonCode, note: args.note, decidedAt: Date.now(),
    });
    await writeEvent(ctx, { roomId: room._id, action: "approval_recorded", actorRole: role,
      decision: args.decision, proposalVersion: proposal.version, constraintsVersion: room.constraintsVersion });

    if (args.decision === "reject") {
      await onProposalRejected(ctx, { room, run, proposal }); // 04/05：run → negotiating 或 needs_input
      return { status: "recorded" as const, decisionId };
    }
    if (args.decision === "approve") {
      const rows = await ctx.db
        .query("approvals")
        .withIndex("by_proposalId_and_userId_and_seq", (q) => q.eq("proposalId", proposal._id))
        .collect(); // 含刚插入的行
      const members = await ctx.db
        .query("members")
        .withIndex("by_roomId_and_userId", (q) => q.eq("roomId", room._id))
        .collect();
      const approvals = summarizeApprovals({ required: proposal.requiredApprovals, rows, members,
        currentConstraintsVersion: room.constraintsVersion });
      const standing = deriveProposalStanding({ proposal, room, currentRunStatus: run.status, ruleResult: rule, approvals });
      if (isExecutable(standing)) {
        const changeOrderId = await executeProposalInTx(ctx, { room, run, proposal, inputs }); // 08；幂等键 exec:${proposalId}
        return { status: "executed" as const, changeOrderId };
      }
    }
    return { status: "recorded" as const, decisionId };
  },
});

async function latestDecision(ctx: any, proposalId: any, userId: string) {
  return await ctx.db
    .query("approvals")
    .withIndex("by_proposalId_and_userId_and_seq", (q: any) => q.eq("proposalId", proposalId).eq("userId", userId))
    .order("desc")
    .first();
}

// ---- 外部依赖 ----
declare function loadConstraintInputs(ctx: unknown, roomId: unknown): Promise<any>;
declare function evaluateProposal(p: unknown, i: unknown): { ok: true; reasonCodes?: never } | { ok: false; reasonCodes: string[] };
declare function filterReasonCodesForRole(codes: string[], role: string): string[];
declare function onProposalRejected(ctx: unknown, a: unknown): Promise<void>;
declare function executeProposalInTx(ctx: unknown, a: unknown): Promise<any>;
declare function writeEvent(ctx: unknown, e: Record<string, unknown>): Promise<void>;
