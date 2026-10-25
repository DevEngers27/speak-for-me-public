# 专题深潜：首个场景 fixture 与完整走查（part3：主线 S8–S14）

### 第 8 步　代码生成给 customer 的取舍请求（第 6 步同一事务里写入）

```ts
// humanRequests row written by budgets.update -> startRun -> openTradeoffRequest
{
  roomId, runId: run2, targetRole: "customer", kind: "tradeoff", status: "open",
  constraintsVersion: 4,
  questionTemplate: "tradeoff.scope_vs_date",           // rendered per viewer, never stored as model text
  options: [
    { key: "sso_login@expedited", impact: { itemKeys: ["sso_login"], deferredItemKeys: ["csv_export","usage_reports"],
      deliveryDate: "2026-11-16", amountCents: 60_000 }, keepsSoftGoals: ["preferredDate"] },
    { key: "sso_login+usage_reports@standard", impact: { itemKeys: ["sso_login","usage_reports"], deferredItemKeys: ["csv_export"],
      deliveryDate: "2026-11-23", amountCents: 75_000 }, keepsSoftGoals: ["wantedItemKeys"] },
    { key: "escalate_finance", impact: null },           // "Neither: ask finance to reconsider the budget"
  ],
  disclosureOnAnswer: "share_choice_label",              // what the provider will learn, shown before answering
  createdAt,
}
```

- 选项来源：前沿 {C2, C3}，按金额升序；外加固定的 `escalate_finance`。C1 被支配，不列出。
- 界面：
  - C（目标人，可操作）：标题 `Your decision is needed: the reduced budget can't cover both usage reports and the Nov 16 date.` 选项按钮：
    - `Keep Nov 16 delivery, defer usage reports — +$600 · $4,600 committed after approval`
    - `Include usage reports, deliver Nov 23 — +$750 · $4,750 committed after approval`
    - `Neither — ask finance to reconsider the budget`
    - 说明：`Your choice will be shared with the provider as a preference (no budget numbers). It does not approve anything.`
  - F（买方，只读）：`Waiting on the customer: SSO + expedited ($600) or SSO + usage reports, standard ($750).`
  - P（只读，无数字）：`The customer is choosing between delivery date and scope. No action needed from you.`

### 第 9 步　customer 回答（cv 不变，仍为 4）

- 调用：`humanRequests.answer({ requestId, optionKey: 'sso_login+usage_reports@standard' })`（public mutation）。
- 守卫：`requireRole('customer')` 且 `=== request.targetRole`；`request.status === 'open'`；`request.constraintsVersion === room.constraintsVersion`；`room.currentRunId === request.runId` 且 run2 为 `needs_input`；`optionKey ∈ options`。
- 表变化：`humanRequests` patch `{ status: 'answered', answerKey, answeredBy, answeredAt }`；`briefs`（customer）追加一条派生共享事实 `{ field: 'tradeoffPreference', value: { prefer: 'wantedItemKeys', over: 'preferredDate' }, sourceRequestId }`（**软偏好，不 bumpConstraints**，D6）；run2 `needs_input → negotiating`，`round: 1`；`agentTurns +1`（provider，seq 1，snapshot cv 4，baseProposalVersion 1）；`runAfter(0, internal.agents.runTurn)`。
- 事件：`request_answered`（payload `{ targetRole: 'customer', choiceLabelKey: 'prefer_scope_over_date' }`）、`turn_started`。
- 界面：三方时间线 `Customer prefers including usage reports over the Nov 16 date.`；run 进度 `Negotiation round 1 of 2 · Provider agent drafting…`。

### 第 10 步　重新协商 → 新方案 v2（pv 1 → 2）

1. provider 回合上下文：自身目录与产能、共享事实（含新偏好）、`p1` 的公开结构与 provider 可见的阻断原因 `OVER_BUDGET`（无数字）。输出：`{ action: 'propose', itemKeys: ['sso_login','usage_reports'], deliveryTier: 'standard', rationale: '…' }`。
2. `completeTurn` 守卫（currentRunId = run2、nextTurnSeq = 1、cv = 4）通过 → `buildCandidate` → 75_000、2026-11-23 → `validateProposal`：`FITS_BUDGET`（400_000 + 75_000 = 475_000 ≤ 480_000）、必需项齐、2026-11-23 ≤ 2026-11-30 → `proposals +1`：v2，`constraintsVersion: 4`，`derivedFromProposalId: p1`，`termKeys: []`；`rooms.currentProposalId = p2`；p1 `status: 'superseded'`（唯一允许的提案字段变更）。
3. customer、finance 评估回合并行 → 都 `recommend_accept` → run2 `negotiating → pending_approval`。
- 事件：`turn_completed` ×3、`proposal_created`（v2）、`agent_recommended` ×2。
- 界面（`Proposal v2 · Ready for approval · checked against constraints v4`）：
  - 公共摘要：`Provider proposes SSO login + Monthly usage report dashboard for $750 with standard delivery on Nov 23, 2026; CSV export deferred.`
  - 差异：`Changes from v1: delivery Nov 16 → Nov 23; expedited fee removed; $900 → $750.`
  - C、F：`+$750 change · $4,750 committed after approval · $4,800 cap · $50 headroom left`
  - P：`+$750 change · Fits the customer's budget`
  - C 私密检查：`Delivery Nov 23 meets your hard deadline (Nov 30). Misses your preferred date by 7 days, as you chose.`
  - 对比表：v1 行 `Superseded · blocked under constraints v4`（C、F 另显示 `Also over the current cap`）；v2 行 `Current`。

### 第 11 步　三方审批

- 调用：`approvals.decide({ proposalId: p2, decision: 'approve' })`：C（`terms`）→ P（`terms`）→ F（`budget`，最后一个）。
- 守卫：同第 5 步，cv 4。
- 前两次：`approvals +1` ×2，判定未齐。事件 `approval_recorded` ×2。界面：`Waiting on: Provider, Finance` → `Waiting on: Finance`。

### 第 12 步　执行（与 finance 的批准同一事务）

finance 那次 `approvals.decide` 内，按 F08.4 顺序：
1. upsert finance 审批（`kind: 'budget'`，cv 4）。
2. 集合判定：对 `currentProposalId = p2` 与 cv 4，`requiredApproverRoles` 每个角色各有一条**不同 userId** 的最新 `approve`，且 `terms` 与 `budget` 两类齐全 → 继续。
3. 状态守卫：run2 `pending_approval`、`currentProposalId === p2`、`p2.constraintsVersion === 4`。
4. 预算重算：`getCommitted` = 400_000；`400_000 + 75_000 ≤ 480_000` → 通过（同一纯函数 `checkBudget`）。
5. `operationId = "exec:" + p2 + ":4"`；`changeOrders.by_operation` 未命中。
6. 插入：`changeOrders +1` `{ runId: run2, proposalId: p2, proposalVersion: 2, constraintsVersion: 4, operationId, approvedItemKeys: ['sso_login','usage_reports'], deferredItemKeys: ['csv_export'], amountCents: 75_000, deliveryDate: '2026-11-23', budgetSnapshot: { totalBudgetCents: 480_000, committedBeforeCents: 400_000, committedAfterCents: 475_000 } }`；`commitments +1` `{ kind: 'change_order', changeOrderId, operationId, amountCents: 75_000 }`；`tasks +2`（`sso_impl`、`reports_impl`，`assigneeRole: 'provider'`，`dueDate: '2026-11-23'`，`status: 'todo'`，`operationId`）。
7. run2 `pending_approval → confirmed`；p2 `status: 'executed'`；`rooms.currentRunId = null`。
- 事件：`approval_recorded`（finance）、`executed`（payload `{ proposalVersion: 2, changeOrderId }`）。
- 界面：
  - 三方 `Executed · Change order CO-1 based on proposal v2 · constraints v4. An internal record only. No payment, transfer, or e-signature happens in this system.`
  - C、F 预算影响（读 `budgetSnapshot`，不做减法推算）：`Cap $4,800 · Before $4,000 · This change $750 · After $4,750 · Remaining $50`
  - P：`Change order CO-1 · $750 · Delivery Nov 23, 2026 · 2 tasks assigned to you`，任务列表只有 P 可勾选。
  - 审批记录（结果页）：v2 三条 `Used for execution`；v1 两条 `No longer applies (constraints v3)`。

### 第 13 步　重复点击 / 重试 / 并发

| 情形 | 发生什么 | 结果 |
| --- | --- | --- |
| F 双击 `Approve budget commitment` | 第二次调用读到 run2 `confirmed` → 守卫失败分支返回 `{ status: 'already_executed', changeOrderId }` | 不新增任何行；界面不报错 |
| 两人同时提交最后两个批准 | 两个事务都读写 run2 与 approvals；OCC 令其一重试，重试时看到 `confirmed` 或集合已齐 | 只有一次执行（必须在真实部署上并发验证，F08.5） |
| 客户端断线重发同一 mutation | 同上，守卫命中 | 同上 |
| 守卫被绕过（假想 bug） | `by_operation` 命中 → 返回已有 changeOrderId | 第二道保险，不重复承诺 |

### 第 14 步　追溯链（结果页 History，可按 pv / cv 筛选）

`CO-1` → p2（v2，cv 4，`derivedFromProposalId: p1`）→ 三条 approvals（cv 4）→ 产生 p2 的 provider turn（run2 seq 1）→ `request_answered`（customer 选择）→ run2 `trigger: 'budget_change'` → `budgetChanges`（仅 finance 看到 $5,000 → $4,800 与原因）→ `constraints_changed` v3 → v4 → p1 与两条旧审批（cv 3）→ run1 `trigger: 'initial'` → 三条 `brief_confirmed`（引用 `briefVersions`）→ `room_created`（fixture scope_change.v1, simulated）。

### 主线状态汇总

| 实体 | 终态 |
| --- | --- |
| room | `open`，cv 4，pv 2，`currentRunId: null`，`currentProposalId: p2` |
| run1 / run2 | `superseded`（constraints_changed）/ `confirmed` |
| p1 / p2 | `superseded` / `executed` |
| approvals | 5 行：p1 两条（cv 3，派生为 stale）+ p2 三条（cv 4） |
| humanRequests | 1 行 `answered` |
| commitments | baseline 400_000 + change_order 75_000 = 475_000 |
| agentTurns / 模型调用 | run1 3 次 + run2 3 次 = 6 次（无解变体为 0 次） |
