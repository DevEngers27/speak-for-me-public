# 08 审批与执行（事件溯源候选）

## 1. 决定

| # | 决定 | 理由 | 备选 |
| --- | --- | --- | --- |
| AE-1 | 审批是不可变事件 `decision_recorded`，绑定 `(proposalVersion, constraintsVersion)`；同人同提案以最新 seq 为准 | 撤回、改主意、旧审批全部留痕；"失效"是派生的，不改记录（核心 3、6） | Role A 的 approvals/rejections 两表 + 删除旧拒绝（RA-B06） |
| AE-2 | 必需审批 = 场景常量 `requiredApprovals`，在 `proposal_created` 中快照 | 不能被可改字段绕过（F08.2） | `members.approvalRequired` |
| AE-3 | 审批分 `kind`：customer/provider 签 `terms`，finance 签 `budget` | 条款签核与预算承诺权责分开（F08.3）；仍是一套流程 | 两套独立流程 |
| AE-4 | **执行在最后一票的同一 mutation 中**，由单个事件 `execution_completed` 投影出变更单、承诺、任务 | 原子性由"一个事件 = 一个事实"天然保证；不存在"全员已批未执行"的悬空态 | scheduler/action 执行：非原子 |
| AE-5 | 幂等：状态守卫为主、`operationId = exec:${roomId}:p${version}:c${constraintsVersion}` 唯一为辅、`commandId` 去重为第三层 | 三层各防一类问题：并发、重算、重发 | 客户端 uuid 作 operationId：查重失效 |
| AE-6 | 审批无有效期（v1）；约束变化即失效 | 版本机制已覆盖"条件变了"；报价有效期列为开放问题 | 定时过期 |

## 2. 命令：`approvals.decide`

```ts
export const decide = mutation({
  args: { roomId: v.id("rooms"), proposalVersion: v.number(),
          decision: v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw")),
          reasonCode: v.optional(humanRejectReasonV), note: v.optional(v.string()), commandId: v.string() },
  returns: v.object({ status: v.union(v.literal("recorded"), v.literal("executed"), v.literal("noop"), v.literal("duplicate")),
                      operationId: v.optional(v.string()), blockedReasonCodes: v.optional(v.array(v.string())) }),
  handler: async (ctx, a) => {
    const { user, role } = await requireMember(ctx, a.roomId);
    return runCommand(ctx, { roomId: a.roomId, actor: { kind: "user", userId: user._id, role },
      commandId: a.commandId, plan: s => planDecide(s, { ...a, userId: user._id, role }, todayFor(s)) });
  },
});
```

`humanRejectReasonV = "TOO_EXPENSIVE" | "DATE_TOO_LATE" | "SCOPE_INSUFFICIENT" | "OTHER"`；note ≤ 500 字符，仅本人可见。

## 3. `planDecide` 的步骤（纯函数；顺序即事务内步骤）

| 步 | 检查 / 动作 | 失败返回 | 失败后状态 |
| --- | --- | --- | --- |
| 1 | room.status = open | `ROOM_CLOSED` | 不写任何东西 |
| 2 | 提案存在；`role` 在 `proposal.requiredApprovals` 中，取对应 kind | `FORBIDDEN_ROLE` | 同上 |
| 3 | withdraw：提案未执行且本人最新决定为 approve/reject | `ALREADY_EXECUTED` / `INVALID_STATE` | 同上 |
| 4 | **审批/执行守卫**：`run.status === "pending_approval"`、`room.currentProposalVersion === proposalVersion`、`proposal.constraintsVersion === room.constraintsVersion` | `STALE_PROPOSAL` | 同上（reject 例外：对 stale 提案的 reject 也允许记录，便于表达"我不同意"，但不触发任何后续） |
| 5 | approve 前置：`validate(当前存储值)` 通过 | `INVALID_STATE` + 投影后的 reasonCodes | 同上 |
| 6 | 幂等 no-op：本人对该提案在当前约束版本下的最新决定已与本次相同 | 返回 `noop` | 同上 |
| 7 | 追加 `decision_recorded` | — | — |
| 8 | reject：反应器 → `run_resumed{human_rejected}`（round < maxRounds，调度 provider 回合，输入含 reasonCode）或 `run_needs_input{ROUNDS_EXHAUSTED}` + 取舍请求 | — | run 迁移 R7/R8 |
| 9 | approve：**完成判定**（§4）；未齐 → 返回 `recorded` | — | — |
| 10 | 齐了：执行前重算 `validate`（预算从 `budgets` + `Σ commitments` 当前值读）；不过 → 返回 `recorded` + `blockedReasonCodes`（审批已记录，执行不发生） | — | run 保持 pending_approval；界面显示 blocked |
| 11 | `operationId` 查重：`changeOrders.by_room_operation` 命中 → 返回 `executed` + 已有 operationId（不追加事件） | — | — |
| 12 | 追加 `execution_completed`（§5 载荷） | — | run → confirmed；currentRunNo 清空 |

第 4、5 步保证"人批准具体版本"；第 10 步保证预算不变式在执行事务内对当前值成立；第 11 步与第 4 步一起保证至多执行一次。

## 4. 完成判定（按集合，不按计数）

```ts
export function approvalsComplete(p: Proposal, ds: Decision[], room: Room, members: Member[]): boolean {
  const latest = latestByUser(ds.filter(d => d.proposalVersion === p.version));   // 按 seq 取每人最新
  const effective = latest.filter(d => d.decision === "approve" && d.constraintsVersion === room.constraintsVersion);
  const usedUsers = new Set<string>();
  for (const req of p.requiredApprovals) {
    const m = members.find(x => x.role === req.role); if (!m) return false;
    const d = effective.find(x => x.userId === m.userId && x.role === req.role && x.kind === req.kind);
    if (!d || usedUsers.has(d.userId)) return false;       // 不同角色必须是不同 userId
    usedUsers.add(d.userId);
  }
  return true;
}
```

禁止 `approvals.length >= N`。v1 一角色一人，`members.find` 唯一；多人席位（Q13）时改为"该角色任一成员"。

## 5. 执行载荷与派生

`execution_completed` 是自包含快照（03 part1）。apply 时一次写三张表：

| 投影 | 写入 |
| --- | --- |
| changeOrders | 条款快照（lines、terms、deferredItemKeys、amountCents、deliveryDate）、`committedBeforeCents`、`committedAfterCents`、`totalBudgetCents`、operationId |
| commitments | `{kind: "change_order", amountCents, operationId, label: "CO p{v}"}` |
| tasks | 载荷中的 `tasks[]`（plan 阶段由 `deriveTasks` 确定性算出），status open |
| runs / rooms | run → confirmed（assertRunTransition）；rooms.currentRunNo 清空；currentProposalVersion 保留以显示 executed |

任务在 plan 阶段派生并写进事件，而不是在 apply 阶段派生：这样回放不依赖"当时的任务模板代码"，事件就是证据（开放问题 Q10 的裁决：任务属于被执行内容的一部分）。

## 6. 时序：最后一票（finance）

```text
finance 浏览器 ── useMutation(approvals.decide){proposalVersion:4, decision:approve, commandId:c-91}
  Convex mutation（单事务）:
    requireMember → role=finance
    by_room_command(c-91) 未命中
    loadRoomState: room(cv=5, currentProposalVersion=4), run#2(pending_approval), proposal v4,
                   decisions(v4): customer approve@cv5, provider approve@cv5; budget 480000; Σcommitments 400000
    planDecide: 守卫过 → validate ok(400000+80000 ≤ 480000) → 追加 decision_recorded(seq 41)
                → 完成判定 true → 重算 ok → operationId exec:<room>:p4:c5 未命中
                → 追加 execution_completed(seq 42)
    apply: decisions+1, changeOrders+1, commitments+1, tasks+2, runs#2 confirmed, rooms 流头 seq 42
  提交 → 所有订阅 rooms.view 的窗口同时看到 Executed
```

失败点：任一步抛错 → 整个事务回滚，没有部分写入；OCC 冲突（例如 customer 同时撤回）→ Convex 重试本 mutation，重试时看到对方结果，重新判定。

## 7. 并发与重复

| 情形 | 结果 |
| --- | --- |
| 同一人双击 approve（同 commandId） | 第二次命中 `by_room_command` → `duplicate` |
| 同一人两次提交（不同 commandId） | 第二次步骤 6 → `noop` |
| customer 与 finance 同时投最后两票 | 两事务都写 rooms 流头 → OCC 串行；后者重试时看到前者的决定并完成执行；只有一条 execution_completed |
| 执行与 budget.update 并发 | OCC 串行；若预算先提交，执行事务重试时守卫 4（约束版本）失败 → `STALE_PROPOSAL` |
| 已执行后再 decide | 守卫 4 失败（run 已 confirmed） |

验证方式：convex-test 串行执行、证明不了 OCC；并发必须对真实 dev 部署并行发起（16 §5）。

## 8. 执行边界

只写内部记录：changeOrders、commitments、tasks。不转账、不签署有法律效力的合同、不改外部 ERP；幂等只承诺内部记录。外部集成走 17 的 outbox 扩展点：外部写入将由一个读取 `execution_completed` 事件的 action 完成，并以 operationId 作为对外幂等键——事件日志让这个扩展点不需要改动执行事务。
