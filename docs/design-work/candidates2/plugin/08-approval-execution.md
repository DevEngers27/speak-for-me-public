# 08 审批与执行

## 1. 审批绑定
一条 decision 绑定三件事：`proposalId`（不可变条款）、`contentKey`（条款的规范化串，可读证据）、`constraintsVersion`（决策当时的约束版本）。条款或约束任一变化，旧决定自动不计数（派生，不改写）。不存 hash：proposals 只追加，proposalId 已证明"批的就是这份"；contentKey 只为人可读与 `engine.content_drift` 比较。

## 2. 必需审批人
- 来自插件常量 `requiredApprovals`，在 `insertProposal` 时快照进 `proposals.requiredApprovals`；执行以快照为准。
- 完成判定是**集合**判定，纯函数：

```ts
export function approvalSetComplete(p: Proposal, latest: Map<RoleKey, Decision>, seats: Map<RoleKey, UserId>, cv: number) {
  const users = new Set<string>();
  for (const req of p.requiredApprovals) {
    const d = latest.get(req.roleKey);
    if (!d || d.decision !== 'approve' || d.kind !== req.kind) return false;
    if (d.constraintsVersion !== cv || d.contentKey !== p.contentKey) return false;
    if (d.userId !== seats.get(req.roleKey)) return false;   // 必须是当前席位上的人
    users.add(d.userId);
  }
  return users.size === p.requiredApprovals.length;           // 不同角色必须不同 userId（I7）
}
```
`latest` 由 `decisions.by_proposal_user` 每人取 `.order('desc').first()` 构建；禁止 `approvals.length >= N`。

## 3. `decisions.decide({proposalId, decision, reasonCode?, note?})` 事务步骤

| 步 | 动作 | 失败 → 结果 |
| --- | --- | --- |
| 1 | `requireParticipant`；roleKey 来自 participant；kind 来自快照中该 roleKey 的要求 | 非必需审批角色 → `NOT_AN_APPROVER` |
| 2 | 读 room、run、proposal；**审批/执行守卫**：run pending_approval（approve 与 reject 相同）、`room.currentProposalId === proposalId`、proposal active | `PROPOSAL_NOT_CURRENT` / `RUN_NOT_AWAITING_APPROVAL` |
| 3 | 若 approve：`snap = buildSnapshot`；`evaluate(plugin, proposal, snap).executable` | `NOT_EXECUTABLE`（code 附首个 reasonCode，无数字） |
| 4 | 插入 decision（`constraintsVersion = room.constraintsVersion`，`contentKey = proposal.contentKey`）；写 `decision_recorded` 事件 | — |
| 5 | reject → R8/R8'（新一轮或人工请求）；withdraw → 结束 | — |
| 6 | approve → `executeIfComplete(ctx, room, run, proposal, snap)` | 未齐 → 返回 `{status:'recorded'}` |

同一人连点两次 approve：两条 decision（只追加），集合判定按最新一条，不会提前达标。

## 4. `executeIfComplete`（与步骤 6 同一事务）

1. `approvalSetComplete(...)` 为假 → 返回。
2. 主防线（状态守卫）已在步骤 2 完成：两个并发的最后一票读写同一 run/room 文档，OCC 让后者重跑，重跑时看到 run confirmed → 在步骤 2 返回 `{status:'already_executed', executionId}`（查 `executions.by_operation` 取回）。
3. 复算：用步骤 3 的同一 snapshot（同一事务快照）再跑 `ledger.over_cap`（evaluate 已含，显式断言一次作为 I9 的落点）。
4. `operationId = exec:${proposalId}:${room.constraintsVersion}`；`executions.by_operation` 命中 → 返回已有 executionId，不抛错、不写房间事件（重复计数只进日志）。
5. `plan = plugin.deriveExecution(sel, derived, snap)`；同一事务插入：`executions`（含 `approvingDecisionIds`）、每个 `ledgerImpact` 一条 `ledgerEntries(kind:'execution')`、`outcomeDocuments`、`tasks`（`taskKey` 唯一）。
6. `proposal → executed`；`run → confirmed`（`assertTransition`）；`room.currentRunId` 清空；写 `executed` 事件（room 级，模板参数经 room 投影）。
7. `bumpConstraints(ctx, roomId, {kind:'ledger_execution'})`——台账变了，约束集合变了（09）。

不用 action、不用 scheduler：执行全部是数据库写，放进 mutation 才有原子性。

## 5. 撤回、过期
- 撤回：追加 `withdraw`；提案 executed 后禁止。
- 过期：v1 不设审批有效期（目录条目的报价有效期见 18 开放问题）；约束变化已覆盖"条件变了旧批准失效"。

## 6. 派生规则（插件 → 引擎）

| 产物 | 谁定义 | 引擎保证 |
| --- | --- | --- |
| ledger 条目 | 引擎按 `ledgerImpact` 写 | `Σ entries <= cap` |
| 文档 | 插件 `deriveExecution.documents` | 受众过滤、只读 |
| 任务 | 插件 `deriveExecution.tasks` | `(executionId, taskKey)` 唯一；assignee 只能改 status |

审批界面在 approve 前展示"批准后将写入的记录预览"（同一个 `deriveExecution` 在 `rooms.view` 中对当前提案调用并按 viewer 投影），让人知道自己批的后果。

## 7. 执行边界
只写内部记录。外部动作（转账、签合同、改 ERP、发邮件）是 17 的 outbox 扩展点；幂等只承诺内部记录。
