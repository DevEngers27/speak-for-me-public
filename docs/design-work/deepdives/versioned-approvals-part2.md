# 专题深潜：版本化审批与约束失效（part2：不变量、字段、递增矩阵、守卫）

## 1. 不变量清单

编号供 02（不变量清单）、16（测试）引用。"落点"= 由哪段代码保证。

| id | 不变量 | 落点 |
| --- | --- | --- |
| INV-A1 | 一条审批决定对"当前"有效 ⇔ `proposalId === room.currentProposalId ∧ constraintsVersion === room.constraintsVersion ∧ 它是 (proposalId, userId, constraintsVersion) 上 seq 最大的行 ∧ decision === 'approve'` | `summarizeApprovals`（standing.ts） |
| INV-A2 | `approvals` 只插入，从不 patch / delete | 唯一写入口 `decideOnProposal`；16 的代码结构测试 |
| INV-A3 | 决定行的 `constraintsVersion` 等于写入事务中读到的 `room.constraintsVersion`，且等于客户端的 `expectedConstraintsVersion` | `decideOnProposal` 守卫 G6 |
| INV-A4 | 决定行的 `role` 与 `kind` 从 members 与 `APPROVAL_KIND_BY_ROLE` 派生，从不接受客户端输入 | `decideOnProposal` G1 |
| INV-A5 | (proposalId, userId) 内 `seq` 从 1 连续递增、无重复 | `decideOnProposal` 同事务读最后一行再 +1 |
| INV-A6 | 代理永远不写 `approvals`（recommend_accept 只产生事件） | 只有 public mutation 写；internal 函数不 import 该写入 helper |
| INV-C1 | `rooms.constraintsVersion` 只在 `bumpConstraints` 中改变，每次恰好 +1 | constraints.ts；代码结构测试 |
| INV-C2 | 每次 bump 恰好插入一行 `constraintRevisions`，`version === room.constraintsVersion`（新值），(roomId, version) 唯一 | `bumpConstraints` |
| INV-C3 | 硬投影变化 ⇔ 版本递增（在 `withConstraintChange` 包裹的写入范围内） | `withConstraintChange` |
| INV-C4 | 写约束源表（budgets、briefVersions 的 confirmed 行、catalogItems 的 confirmed 行、room 的 approverSet 若将来存在）只能发生在 `withConstraintChange` 的 `apply` 回调内 | 代码结构测试（grep 白名单） |
| INV-P1 | 提案条款字段永不 patch；可变的只有 `status`、`statusChangedAt` | `insertProposal` + 生命周期 helper `setProposalStatus` |
| INV-P2 | `proposal.status === 'active'` ⇔ `room.currentProposalId === proposal._id`；每房至多一个 active | `setCurrentProposal`（同事务改两处） |
| INV-P3 | `proposal.version` 房间内唯一、单调，由 `insertProposal` 分配；约束变化与新 run 都不改变它 | `insertProposal` |
| INV-P4 | `executed` 是提案终态；每个提案至多执行一次 | 执行事务的状态守卫 + 幂等键 `exec:${proposalId}`（D12） |
| INV-E1 | `isExecutable` 永不入库；任何执行入口都在同一事务内重算 | standing.ts；08 执行事务 |
| INV-E2 | `isExecutable ⇒ evaluateProposal(proposal, loadConstraintInputs(room)).ok` | `deriveProposalStanding` |
| INV-E3 | 完成判定按集合：`requiredApprovals` 快照中每个 (role, kind) 恰有一个当前有效 approve，来自该 role 当前成员，且这些 userId 两两不同 | `summarizeApprovals` |
| INV-T1 | 回合结果只有在 `room.currentRunId === runId ∧ run.status === 'negotiating' ∧ run.nextTurnSeq === turnSeq ∧ turn.constraintsVersion === room.constraintsVersion` 时才落库 | `completeTurn` 持久化守卫（D8） |
| INV-T2 | `turn.constraintsVersion` 在调度该回合的 mutation 中写入 | `scheduleTurn` helper（04/10） |
| INV-H1 | 任何 bump 都把房间内所有 `open` 的 humanRequests 置为 `cancelled`（引发本次 bump 的那条已先置为 `answered`） | `bumpConstraints` |
| INV-R1 | bump 后，若当前 run 为 pending_approval，则当前提案在新约束下合规；否则 run 已离开 pending_approval | `reconcileAfterBump` |

## 2. 字段（摘要；完整 validator 见 versioned-approvals/schema.ts）

| 表 | 本专题新增或改动的字段 | 说明 |
| --- | --- | --- |
| rooms | `constraintsVersion: number`（建房 0）、`proposalVersion: number`（建房 0）、`currentRunId?`、`currentProposalId?` | 0 表示"尚无已确认硬约束"；第一次确认简报即变为 1 |
| constraintRevisions（新） | `roomId, version, previousVersion, causes[], sourceRefs[], actorType, actorRole?, actorUserId?, runEffect, invalidatedDecisionCount, createdAt` | 回答"cv 为什么是 N"；不存任何约束值；仅服务端读，公共视图只取 `version/causes/actorRole/createdAt` |
| proposals | `version`、`baseProposalVersion?`、`createdAtConstraintsVersion`（原 constraintsVersion 改名）、`requiredApprovals: {role, kind}[]`（快照）、`validationAtCreation: {constraintsVersion, ok, reasonCodes}`、`status: 'active'|'superseded'|'executed'`、`statusChangedAt` | validationAtCreation 只作时间线展示，执行永远重算 |
| approvals（改为只追加） | `roomId, proposalId, proposalVersion, userId, role, kind, decision, constraintsVersion, seq, reasonCode?, note?, decidedAt` | note 为本人私有自由文本，不进他方视图与代理上下文（07） |
| agentTurns | `constraintsVersion`（调度时快照） | D8 |
| runs | `constraintsVersionAtStart`（仅来历）、`trigger` 增加 `'constraints_change'`、`endedReason` 增加 `'constraints_changed'` | |
| humanRequests | `constraintsVersion`（创建时）、`cancelledByRevision?: Id<'constraintRevisions'>` | |
| changeOrders | `proposalId, proposalVersion, constraintsVersion, operationId = exec:${proposalId}` | D12，交 08 拍板 |
| budgetChanges / briefVersions / catalogItems | 各加 `producedConstraintsVersion?: number`（该写入导致 bump 时回填新版本号；未导致 bump 则为空） | 让"版本 N 的硬输入"可由各源表重建，无需复制私密值 |

## 3. 递增矩阵

"递增"= 在 `withConstraintChange` 内执行且投影变化时递增。矩阵列出期望结果，测试据此断言。

| # | 写入（mutation） | 调用者 | 是否递增 | cause | 备注 |
| --- | --- | --- | --- | --- | --- |
| B1 | `updateBudget` 改总额（降或升） | finance 本人 | 是 | `budget` | 与原值相同 → 返回 `{ changed: false }`，不递增、不写事件；新值 < 已承诺 → 拒绝 `BUDGET_BELOW_COMMITTED`，事务回滚 |
| B2 | `confirmBrief`（customer）且 required/deferrable/deadline 与上一确认版本不同 | customer 本人 | 是 | `customer_requirements` | 首次确认（从无到有）也递增 |
| B3 | `confirmBrief` 只改 `preferredDate` 或披露项 | 本人 | 否 | — | 写新 briefVersion；事件 `brief_updated`（软）；在途协商下一回合自然读到 |
| B4 | `confirmBrief`（provider / finance）只改披露项或说明 | 本人 | 否 | — | provider 的供给由目录表达；finance 的硬输入在 budgets |
| B5 | `confirmCatalogItem`（新条目确认、改价确认为新版本、交付日期改动） | provider 本人 | 是 | `catalog` | 改价 = 插入新 catalogItems 行并把旧行置 superseded（03）；与当前提案无关的条目变化同样递增（D11） |
| B6 | `withdrawCatalogItem` | provider 本人 | 是 | `catalog` | 引用它的提案在新版本下报 `SOURCE_ITEM_WITHDRAWN`（06） |
| B7 | 代理提出目录外选项（落库为 unconfirmed） | internal（completeTurn） | 否 | — | 只有 B5 确认后才进入投影 |
| B8 | `answerRequest` 选项改变硬输入（如 "Defer REPORTS"、"Raise budget by $100"） | 目标角色本人 | 是 | `human_answer` + 具体源（`customer_requirements` / `budget`） | 该请求先置 answered，再 bump（取消其他 open 请求），新 run trigger `human_answer` |
| B9 | `answerRequest` 选项不改变硬输入（澄清、选择候选） | 目标角色本人 | 否 | — | run needs_input → negotiating 或进入审批（05） |
| B10 | 改变必需审批角色集合 | 无（v1 为场景常量，改动 = 部署） | v1 不适用 | `approver_set` | 将来若做成房间配置，必须走 withConstraintChange；`evaluateProposal` 需加 `APPROVER_SET_CHANGED` 检查（快照 ≠ 当前集合即不合规） |
| B11 | `decideOnProposal`（approve/reject/withdraw） | 必需审批人 | 否 | — | |
| B12 | 插入提案、run/turn 生命周期、人工请求创建 | internal | 否 | — | |
| B13 | 执行（插入 commitment / changeOrder / tasks） | 最后一位审批人的 mutation | 否 | — | D9 |
| B14 | 保存草稿（brief draft、目录草稿） | 本人 | 否 | — | 草稿不被规则读取 |
| B15 | 成员加入、显示名、房间标题/目标 | 各自 | 否 | — | 成员更替不 bump，但 INV-E3 要求 approve 来自当前成员，旧成员的审批自然不计 |
| B16 | seed / fixture 建房 | 运维脚本 | 是（经同一 helper） | `seed` | constraintRevisions 行标 `actorType: 'system'`；fixture 数据另有 simulated 标记（15） |

## 4. 守卫

### 4.1 `decideOnProposal` 守卫顺序（public mutation）

顺序有意义：先鉴权后泄露最少信息；先陈旧检查后规则重算。错误码统一用 `ConvexError({ code })`，不带他方数值（07）。

| 序 | 守卫 | 失败码 | 说明 |
| --- | --- | --- | --- |
| G1 | `identity = ctx.auth.getUserIdentity()`；`member = members.by_room_user(proposal.roomId, identity.tokenIdentifier)` | `UNAUTHENTICATED` / `NOT_A_MEMBER` | role、kind 由此派生 |
| G2 | `proposal.requiredApprovals` 含 member.role | `NOT_REQUIRED_APPROVER` | 按快照，不按当前常量 |
| G3 | `room.status === 'open'` | `ROOM_CLOSED` | |
| G4 | `room.currentProposalId === proposalId ∧ proposal.status === 'active'` | `NOT_CURRENT_PROPOSAL`（若 executed 且 decision === 'approve' 则返回幂等成功，见 G9） | |
| G5 | `run = db.get(room.currentRunId)`；`run.status === 'pending_approval'` | `NOT_AWAITING_APPROVAL` | 看当前 run，不看 proposal.runId（提案可被新 run 沿用，part3 §2） |
| G6 | `room.constraintsVersion === args.expectedConstraintsVersion` | `CONSTRAINTS_CHANGED` | D3；返回体带 `currentConstraintsVersion` 让 UI 刷新 |
| G7 | 仅 approve：`evaluateProposal(proposal, await loadConstraintInputs(ctx, roomId)).ok` | `PROPOSAL_INVALID`（reasonCodes 按查看者角色过滤） | 防御性；INV-R1 保证正常情况下必过 |
| G8 | 去重：当前 (proposalId, userId, cv) 上最新决定与本次相同 | 非错误，返回 `{ status: 'unchanged', decisionId }` | withdraw 在无当前决定时 → `NOTHING_TO_WITHDRAW` |
| G9 | 幂等成功：OCC 重试后若发现 proposal 已 executed 且本人已在该版本上 approve | 返回 `{ status: 'executed', changeOrderId }` | 双击最后一票时第二次调用走这里 |

通过后：插入决定行（seq = last + 1）→ 写事件 `approval_recorded`（角色、决定、版本，不含 note）→ 若 approve 则 `summarizeApprovals` 判完成 → 完成则调用 08 的 `executeProposalInTx(ctx, { room, run, proposal })`（同事务）；reject 则调用 04/05 的 `onProposalRejected`（run → negotiating 或 needs_input）。

### 4.2 `withConstraintChange` 的守卫

| 守卫 | 失败码 |
| --- | --- |
| 调用者身份与角色由各业务 mutation 先行校验（finance 改预算、customer 确认简报、provider 确认目录、目标角色回答请求） | 各自 |
| `room.status === 'open'` | `ROOM_CLOSED` |
| `apply` 内金额 `assertCents`、日期格式校验（03 F03.14） | `INVALID_CENTS` / `INVALID_DATE` |
| bump 后 `reconcileAfterBump` 不得抛错；它只做本表列出的迁移，任何非法迁移经 `assertTransition` 抛错并回滚整个 mutation（包括约束写入本身） | `ILLEGAL_TRANSITION` |

### 4.3 回合持久化守卫（修订 F04.2）

见 INV-T1。任一不满足：turn → `stale`，写 `turn_rejected_stale` 事件（带 runId、turnSeq、turn.constraintsVersion、room.constraintsVersion），不分配 proposalVersion、不插提案、不改 run。另在 action 开始组装上下文时做一次**提前退出**检查（同样四条），命中则不调用模型，省一次调用费用；它只是优化，正确性仍由 completeTurn 守卫保证。
