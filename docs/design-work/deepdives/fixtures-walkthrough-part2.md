# 专题深潜：首个场景 fixture 与完整走查（part2：主线 S0–S7）

> 记号：cv = `rooms.constraintsVersion`；pv = `rooms.proposalVersion`；C/P/F = customer / provider / finance 界面；`+n` = 插入行数；所有行 `isSimulated: true`（继承自房间）。界面文案为英文模板（F05.3），中文是说明。
> 每个公共函数第一步都是 `requireMember(ctx, roomId)`：从 `ctx.auth` 取 `tokenIdentifier` → 查 `members.by_room_user` 得角色；角色从不由客户端传入。

## 4. 主线走查

### 第 0 步　seed（运维，CLI）

- 调用：`npx convex run seed:demoRoom '{"variant":"mainline","seedKey":"rehearsal-001"}'` → `internal.seed.demoRoom`（internalMutation）。
- 守卫：`DEMO_TOOLS_ENABLED === "true"`（Convex 环境变量）；`by_seed_key` 已有同 seedKey 房间 → 直接返回旧 roomId（幂等）。
- 表变化：`rooms +1`（status `open`，cv 0，pv 0，`currentRunId: null`，`fixtureKey`，`seedKey`，`anchorDate: "2026-10-26"`，`timezone`）；`budgets +1`（`status: 'draft'`，500_000）；`commitments +1`（`kind: 'baseline'`，400_000）；`catalogItems +3`、`catalogTerms +1`、`deliverySchedules +4`（均 `status: 'draft'`，归属 provider brief）；`briefs +3`（`status: 'draft'`，`origin: 'fixture'`，日期已按锚点解析）；`roomInvites +3`（只存 `tokenHash`、`expiresAt`）。
- 事件：`room_created`（`actorType: 'system'`，payload `{ fixtureKey }`）。
- 返回：`{ roomId, invites: { customer, provider, finance } }`（明文邀请码只在此返回一次）。

### 第 1 步　三人加入

- 调用：`invites.accept({ code })` ×3（public mutation）。
- 守卫：码哈希命中、未用、未过期；`by_room_role` 下该角色无人；该 userId 在本房间无成员。
- 表变化：`members +3`；`roomInvites` 3 行写 `acceptedBy/acceptedAt`。
- 事件：`member_joined` ×3。
- 界面（三方相同的横幅，贯穿全程）：`Simulated example data · Seeded from fixture scope_change.v1. Names, prices, dates and budgets are not real.`

### 第 2 步　各方确认 brief（cv 0 → 3）

顺序不强制；这里按 provider → customer → finance。

- 调用：`briefs.confirm({ roomId, expectedVersion, fields, disclosures })`（public mutation，只能确认本人角色的 brief）。
- 守卫：`expectedVersion === brief.version`（乐观并发）；字段过场景插件的 `validateBrief(role, fields)`：金额为安全整数美分、日期为 `YYYY-MM-DD` 且不早于房间时区的今天、`requiredItemKeys ⊆ catalogItems.itemKey`、`requiredItemKeys ∩ deferrableItemKeys = ∅`、`preferredDate ≤ hardDeadline`；`disclosures` 只能取场景词表里的字段名。
- 表变化（每次）：`briefs` patch `status: 'confirmed'`、`version + 1`；`briefVersions +1`（不可变快照，供 sourceRefs 引用）；`bumpConstraints(ctx, roomId, { cause: 'brief_confirmed', role })` → cv + 1。provider 确认时同事务把 `catalogItems/catalogTerms/deliverySchedules` 置 `confirmed` 并写 `confirmedBy/confirmedAt`；finance 确认时把 `budgets.status` 置 `confirmed`（金额仍是 seed 的 500_000，但从此刻起是"finance 确认过的值"）。
- 事件：`brief_confirmed`（payload `{ role }`，不含字段值）+ `constraints_changed`（payload `{ fromVersion, toVersion, cause: 'brief_confirmed' }`）。
- 界面：
  - 确认表单每个共享字段旁：`Visible to other parties`；私密字段旁：`Private to you and your agent`。
  - C 确认后：`Brief confirmed (v1). Shared with the room: required SSO login; wanted usage reports; preferred delivery Nov 16, 2026. Kept private: hard deadline, conflict policy.`
  - P 确认后：`Catalog confirmed: 3 items, 1 term. Your delivery schedule stays private; only dates of proposed bundles are shared.`
  - F 确认后：`Budget confirmed: $5,000 cap, $4,000 already committed (simulated baseline). Visible to the customer and finance only.`
  - 共享事实面板（三方都能看）：`Customer: SSO login is required · Usage reports wanted this phase · CSV export can wait · Preferred delivery Nov 16, 2026` / `Provider: No fixed price without a confirmed scope · Prefers phased delivery`。

### 第 3 步　第三份确认触发首个 run

- 调用：仍在第 2 步最后那次 `briefs.confirm` 的同一事务里：`allBriefsConfirmed && !room.currentRunId` → `startRun(ctx, roomId, 'initial')`（内部 helper）。
- `startRun` 步骤：
  1. `precheck(ctx, roomId)`：读已确认目录、customer 硬约束、budget、`getCommitted`（基线 400_000）→ `enumerateCandidates` → 可行集 {C1, C2, C3, C4}；customer 帕累托前沿 {C4}（单元素）→ 结论 `negotiate`。
  2. `runs +1`：`{ status: 'negotiating', trigger: 'initial', constraintsVersionAtStart: 3, round: 1, maxRounds: 2, nextTurnSeq: 1, callCount: 0 }`；`rooms.currentRunId = run1`。
  3. `agentTurns +1`：`{ runId: run1, turnSeq: 1, role: 'provider', status: 'queued', attempt: 1, snapshot: { constraintsVersion: 3, baseProposalVersion: 0 } }`。
  4. `ctx.scheduler.runAfter(0, internal.agents.runTurn, { turnId })`（与写入原子提交）。
- 事件：`run_started`（payload `{ trigger: 'initial' }`）。
- 界面（三方）：run 进度条 `Negotiation round 1 of 2 · Provider agent drafting…`。

### 第 4 步　协商回合 → $900 一期方案（pv 0 → 1）

1. **provider 回合**：`agents.runTurn`（internal action）→ `runQuery(internal.agents.buildContext, { turnId })` 返回白名单上下文：provider 自己的目录与私密产能、他方共享事实、历史公开提案与 reasonCode；**不含预算、不含按预算过滤后的候选集**（否则 provider 可由"哪些组合可行"反推余量）。模型输出（stub 模式下为固定录制）：`{ message: { action: 'propose', itemKeys: ['sso_login','usage_reports'], deliveryTier: 'expedited', rationale: '…' } }`。
2. `runMutation(internal.agents.completeTurn, { turnId, output, usage })`：持久化守卫（`room.currentRunId === run1`、`run.nextTurnSeq === 1`、`room.constraintsVersion === 3`）→ 用 `buildCandidate` 求出金额 90_000（45_000 + 30_000 + 15_000 加急费）、交付日 **2026-11-16**（工作量 7，expedited 第一行）；`validateProposal` 全部通过 → `proposals +1`：`{ version: 1, runId: run1, turnId, authorKind: 'agent', generatedBy: 'model'|'stub', itemKeys, deferredItemKeys: ['csv_export'], deliveryTier: 'expedited', termKeys: ['expedite_fee'], amountCents: 90_000, deliveryDate: '2026-11-16', constraintsVersion: 3, requiredApproverRoles: ['customer','provider','finance'], sourceRefs: [catalog/brief 版本引用], status: 'active' }`；`rooms.proposalVersion = 1`、`rooms.currentProposalId = p1`；`agentTurns` 1 → `succeeded`，写 usage；插入 customer 与 finance 两个评估回合（seq 2、3）并各自 `runAfter(0, …)`。
3. **customer / finance 评估回合**并行：上下文含本方 brief 与按 F07.1 投影的预算；两者输出 `recommend_accept`。第二个 `completeTurn` 看到本轮评估齐全 → `assertTransition('negotiating','pending_approval')`。
- 事件：`turn_completed` ×3（payload `{ role, action }`）、`proposal_created`（payload `{ proposalVersion: 1, reasonCodes: ['FITS_BUDGET'] }`）、`agent_recommended` ×2（不写 approvals，F05.7）。
- 界面（提案卡 `Proposal v1 · Ready for approval · checked against constraints v3`）：
  - 三方公共摘要：`Provider proposes SSO login + Monthly usage report dashboard for $900 with expedited delivery on Nov 16, 2026; CSV export deferred.`
  - 标注：`Drafted by the provider's agent (simulated data). Agents recommend; only people approve.`（stub 模式额外：`Recorded agent output (stub mode)`）
  - C 与 F 预算块：`+$900 change · $4,900 committed after approval · $5,000 cap · $100 headroom left`
  - P 预算块：`+$900 change · Fits the customer's budget`
  - C 的私密检查行：`Delivery Nov 16 meets your hard deadline (Nov 30) and your preferred date.`；P 看到：`Delivery date accepted by the customer.`
  - 批准后将创建：`1 change order · 1 commitment of $900 (buyer view) · 2 tasks for the provider`；P 看到前后两项，不显示承诺金额以外的预算数字。
  - 代理建议区（本方可见）：C `Your agent recommends accepting v1.`；F `Your agent recommends approving the $900 commitment.`

### 第 5 步　两方审批（customer、provider）

- 调用：`approvals.decide({ proposalId: p1, decision: 'approve' })`，C 一次、P 一次。
- 守卫（审批/执行守卫，F04.2）：`run.status === 'pending_approval'`、`room.currentProposalId === p1`、`p1.constraintsVersion === room.constraintsVersion (3)`、`isExecutable(p1)`（实时重算 `validateProposal`）、角色 ∈ `p1.requiredApproverRoles`。
- 表变化：`approvals +1` ×2：`{ proposalId: p1, userId, role, kind: 'terms', decision: 'approve', constraintsVersion: 3, decidedAt }`（`by_proposal_user` 先查后写）。完成判定：缺 finance（`kind: 'budget'`）→ 不执行。
- 事件：`approval_recorded` ×2（payload `{ role, kind, proposalVersion: 1 }`）。
- 界面：C 按钮 `Accept terms of v1`，按下后 `You accepted v1 under constraints v3. Waiting on: Finance (budget commitment).`；P 同理 `Waiting on: Finance`；F 的待办置顶 `Approve budget commitment for v1 (+$900)`，按钮 `Approve budget commitment`。

### 第 6 步　finance 把预算从 $5,000 降到 $4,800（cv 3 → 4）

- 调用：`budgets.update({ roomId, newTotalCents: 480_000, reason: 'Q4 reforecast: department budget reduced (simulated)', expectedConstraintsVersion: 3 })`。
- 守卫：角色 `finance`；`assertCents`；`expectedConstraintsVersion === room.constraintsVersion`（防止基于过期界面改预算）；`newTotalCents !== total`。UI 在提交前用同一纯函数预览影响：`This blocks proposal v1 and voids 2 approvals. A renegotiation will start.`
- 同一事务内（F09.2 顺序）：
  1. `budgets` patch → 480_000；`budgetChanges +1`：`{ oldTotalCents: 500_000, newTotalCents: 480_000, actor, reason, constraintsVersion: 4 }`。
  2. `bumpConstraints(…, { cause: 'budget_changed' })` → cv 4。
  3. run1：`assertTransition('pending_approval','superseded')`，`endedReason: 'constraints_changed'`；`rooms.currentRunId = null`；`rooms.currentProposalId` 保持 p1（历史），p1 不改。
  4. 取消 open humanRequests（无）。旧 approvals **不改不删**（F09.3）。
  5. `precheck` @cv4：可行 {C1, C2, C3}；前沿 {C2, C3}；customer `conflictPolicy = 'ask_me'` → 结论 `ask_customer`。
  6. `startRun(…, 'budget_change')`：`runs +1`（run2，cvAtStart 4，`negotiating`）→ 同事务 `assertTransition('negotiating','needs_input')`；`humanRequests +1`（见 part3 第 8 步）。**不调度任何模型回合**（run2.callCount 0）。
- 事件：`constraints_changed`（payload `{ fromVersion: 3, toVersion: 4, cause: 'budget_changed' }`，无数字）、`approval_invalidated` ×2（payload `{ role, proposalVersion: 1 }`，只是历史标记）、`run_started`（`budget_change`）、`request_opened`（payload `{ targetRole: 'customer', kind: 'tradeoff' }`）。

### 第 7 步　旧方案阻断（读取时派生，所有窗口同一刻翻转）

- 调用：无写入。`rooms.view` 订阅自动重跑：`isExecutable(p1) = p1.constraintsVersion === 4 ? … : false` → `blockedReasonCodes: ['CONSTRAINTS_CHANGED', 'OVER_BUDGET']`（后者由按 cv4 重算 `validateProposal` 得出）。
- 界面：
  - 三方提案卡徽章 `Blocked` + 时间线 `Finance constraint changed (v3 → v4); proposal v1 blocked.`
  - C、F：`+$900 change · $4,900 committed after approval · $4,800 cap · over by $100. This version cannot execute.`
  - P：`+$900 · Blocked: exceeds the finance limit.`（不出现 $4,900 / $4,800，防止反推已承诺 $4,000，F07.1）
  - 审批面板：C、P 两行 `No longer applies — approved under constraints v3`；F 行 `Not requested (v1 blocked)`。
  - F 私密：`Budget history: $5,000 → $4,800 · Q4 reforecast (simulated) · by you`（仅 `budgetChanges`，只有 finance 可读）。
  - 待办：C `Choose between two options (see request)`；P、F `Waiting on the customer's decision.`
