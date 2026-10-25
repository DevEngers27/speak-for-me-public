# 08 审批与执行（part1：绑定、必需审批人、决定种类、decide 时序）

> 本章分 2 个文件：part1（本文件）；part2 原子幂等执行、记录派生、幂等与并发分析、审批界面、执行边界与修订。

## 8.1 审批绑定什么

一条批准绑定 **(proposalId, constraintsVersion)**，并且必须携带**调用者页面上展示的 cv**：

| 绑定要素 | 防的是什么 | 机制 |
| --- | --- | --- |
| `proposalId` | 旧签字匹配被改写的条款（T-12） | 提案没有任何可变字段，id 即内容；不需要另算内容哈希（Convex 运行时 `crypto.subtle` 也无需依赖） |
| `constraintsVersion` | 条款没变但预算、截止日、目录、已承诺额变了 | 决定行存 cv；派生状态只认当前 cv 下的决定；cv 变化即 stale（核心 3） |
| `expectedConstraintsVersion`（参数） | 用户在旧页面上点批准，批准被绑到他没看过的新约束 | `decide` 要求它等于 `room.constraintsVersion`，否则 `STALE_VIEW`，界面刷新后重新展示 |
| `requiredApproverRoleKeys`（提案快照） | 事后改变"谁必须批准" | 插入提案时由场景策略计算并冻结；执行以快照为准（RA-R05） |
| `catalogVersionId`（提案字段） | 报价改价后旧批准仍有效（RA-B04） | 新目录版本使 cv 递增且旧提案 `CATALOG_STALE` |

`termsKey` 写在提案与变更单上，作为人类可读的证据，例如 `LOGIN+REPORTS|defer:EXPORT|standard|2026-11-20|75000|cat1`；它不是安全机制。

## 8.2 必需审批人与完成判定

- 场景声明每个角色是否 `requiredApprover`；首场景三方都是。`requiredApprovers(terms)` 的结果在插入提案时快照（I-14）。v1 不提供"修改必需审批人"的入口；若将来引入金额阈值，它在提案插入时计算，不在审批时动态读取。
- 完成判定按**集合**：对快照中的每个角色，取该角色席位在当前 cv 下对该提案的**最新**决定，全部为 `approve` 才完成。禁止 `approvals.length >= N`（重复点击会让计数提前达标）。
- 不同角色必须是不同的人：由 I-02（一人一席）保证；执行前再断言一次 `new Set(decisions.map(d => d.userId)).size === roles.length`，纵深防御。
- 房主身份不带来任何审批权（T-11）。

## 8.3 决定的种类

| kind | 何时允许 | 额外要求 | 对 run 的影响 |
| --- | --- | --- | --- |
| `approve` | run `awaiting_approval`、提案为当前、cv 一致 | 当前 cv 下求值通过（不能批准不可执行的版本，RA-R06） | 若集合完成 → 同事务执行（R9） |
| `reject` | 同上 | `reasonCode` ∈ 场景公开词表；`note` ≤ 500（房间可见） | R10（继续协商）或 R11（给拒绝者发请求） |
| `withdraw` | 同上，且该席位当前 cv 下最新决定为 `approve` | — | 无（集合判定自然不完整） |

所有决定只追加（I-13）：先拒绝、再撤回、再批准，三条都保留，当前决定为最后一条（修复 RA-B06）。执行后不能撤回：执行后 run 为 `executed`，`decide` 的守卫直接返回幂等结果。

## 8.4 `decisions.decide` 时序

参数：`{ proposalId, kind, expectedConstraintsVersion, reasonCode?, note? }`。返回：`{ status: "recorded", decisionId } | { status: "executed", changeOrderId, duplicate: boolean }`。

| 步 | 读 | 写 | 可能的失败（整笔回滚，状态不变） |
| --- | --- | --- | --- |
| 1 | `proposals`(id) | — | `NOT_FOUND`（不存在） |
| 2 | `users`、`participants`(by_room_user)、`rooms` | — | `NOT_FOUND`（非成员，与"不存在"不可区分）、`FORBIDDEN_ROLE`、`ROOM_NOT_ACTIVE` |
| 3 | `runs`(room.currentRunId) | — | 若 `run.status === "executed"` 且 `room.currentProposalId === proposalId` → 查 `changeOrders.by_proposal` 返回 `{ status: "executed", duplicate: true }`（幂等成功，不写任何东西，只 +1 运维计数） |
| 4 | — | — | 提案不是当前、cv 不等于期望、run 不在 `awaiting_approval` → `STALE_VIEW` |
| 5 | 约束快照、简报版本、目录版本、`commitments` | — | `approve` 时求值不通过 → `PROPOSAL_BLOCKED`（参数为按调用者粗化的检查结果） |
| 6 | — | — | `reject`：`reasonCode` 不在词表 → `INVALID_INPUT`；`withdraw`：当前不是 approve → `NOTHING_TO_WITHDRAW` |
| 7 | — | `decisions` 插入一行 | — |
| 8 | — | `events`：`decision_recorded` | — |
| 9a | `decisions`(by_proposal_cv_participant，各必需角色) | — | `approve`：集合未完成 → 返回 `recorded` |
| 9b | 同上 | 调用 `executeInTx`（part2 §8.5） | 执行内部断言失败 → 整笔回滚（包括第 7 步的批准），返回错误；正常情况下第 5 步已保证通过 |
| 9c | — | `runs` 迁移（R10/R11）、可能的 `agentTurns` 调度或 `humanRequests` | `reject` 的后续 |
| 10 | — | — | OCC 冲突 → Convex 自动重试整个 handler，从第 1 步重新判定 |

代码骨架：

```ts
export const decide = mutation({
  args: { proposalId: v.id("proposals"), kind: decisionKindV, expectedConstraintsVersion: v.number(),
          reasonCode: v.optional(v.string()), note: v.optional(v.string()) },
  returns: decideResultV,
  handler: async (ctx, a) => {
    const proposal = await ctx.db.get("proposals", a.proposalId);
    if (!proposal) throw err("NOT_FOUND");
    const m = await requireCapability(ctx, proposal.roomId, "decision.make");
    const run = await currentRun(ctx, m.room);
    if (run?.status === "executed" && m.room.currentProposalId === proposal._id)
      return idempotentExecuted(ctx, proposal);                       // 步骤 3
    assertApprovalGuards(m, proposal, run, a.expectedConstraintsVersion);   // 04 §4.9
    if (a.kind === "approve") assertEvaluates(ctx, m, proposal);       // 步骤 5
    const decisionId = await insertDecision(ctx, m, proposal, a);      // 步骤 6–8
    if (a.kind === "approve") {
      const approvals = await currentApprovals(ctx, proposal, m.room.constraintsVersion);
      if (isComplete(approvals, proposal.requiredApproverRoleKeys))
        return executeInTx(ctx, { room: m.room, run: run!, proposal, approvals, finalApprover: m.participant });
    }
    if (a.kind === "reject") await afterHumanReject(ctx, m, run!, proposal, a);
    return { status: "recorded", decisionId };
  },
});
```

客户端约束：审批按钮不做乐观更新（inputs/04 §5.1）；按钮上写明版本："Approve v3 under constraints v2"；`expectedConstraintsVersion` 取自同一次 `rooms.view` 返回的 DTO，而不是另一次查询。
