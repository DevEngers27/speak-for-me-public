# 反驳评审：版本化审批与约束失效（part2：问题清单与裁决建议）

严重度：high = 会违反核心或导致卡死/重复写入；medium = 跨专题不一致或自相矛盾，实现时必然出错；low = 局部瑕疵或过度设计。

## 1. 问题清单

### r01 [high] 硬投影与 06 的真实输入不一致，INV-C3 不成立
- **证据**：constraints.ts:9-14 中目录投影只有 `{ itemKey, catalogItemId, priceCents, deliveryDate }`。06 的 `CatalogItem` 有 `revision`、`standardDeliveryDate`、`rushDeliveryDate`、`validUntil`、`status`，`Catalog` 还有 `rushFee`（rules-engine/types.ts:6-16）。06 的 `source_unchanged` 检查按 **revision** 与价格逐行比对快照（rules-engine.md:76），`items_current` 检查 `today > validUntil`。
- **反例**：provider 确认一次只改 `validUntil` 或 `rushDeliveryDate` 的目录变更，06 规定 revision +1。本稿的投影没有变化，所以不 bump。但 06 对当前提案报 `SOURCE_CHANGED`（阻断）。结果：run 停在 pending_approval；旧审批按 INV-A1 仍"有效"；新的 approve 在 G7 失败；没有任何迁移把 run 带出来。这违反 INV-R1，也违反核心 3（"条款或约束变了必须重新审批"）。
- **建议**：投影由场景插件从 06 的输入类型直接派生，签名为 `scenario.hardProjection(input: Omit<ScopeChangeInput, 'today' | 'terms' | 'pricingSnapshot'>)`。目录条目只投影 `(itemKey, revision, status)`：revision 已经概括所有经过确认的变化，再加上 `rushFee`。再加一条属性测试：today 固定时，两份输入投影相等 ⇒ `evaluateScopeChange` 的 blocking 集合相等。

### r02 [high] 随时间变化的阻断（today）绕过了整套失效机制
- **证据**：06 的输入含 `today`（rules-engine.md:93），阻断码 `ITEM_EXPIRED`、`DELIVERY_IN_PAST` 只随时间变化。本稿 D5 和 INV-C3 没有提到时钟，INV-R1 只在 bump 的那一刻成立。
- **反例**：v3 进入 pending_approval 后报价过了 `validUntil`。没有任何写入发生，所以不 bump、不 reconcile；处境派生为 blocked；approve 在 G7 失败；只有某个人主动 reject 才能离开这个状态。界面同时显示"审批有效"和"blocked"。
- **建议**：在 09 写明"时钟失效"。进入 pending_approval 时，用 `runAt` 调度一个 internal mutation `reconcileOnClock`，时刻取最近的边界（validUntil 次日、交付日，按房间时区）。它重算规则；不合规就按 reconcile 的 `!ok` 分支取代 run，cause 记 `clock`。建议也 bump，让旧审批统一变成 stale，保持"每次结论变化都有一条 constraintRevisions"。执行事务里的重算仍是最后防线。

### r03 [high] 回合持久化守卫 INV-T1 漏掉回合身份，会重复落库
- **证据**：INV-T1 / D8 只检查 `currentRunId`、`run.status === 'negotiating'`、`nextTurnSeq === turnSeq`、`turn.constraintsVersion === room.constraintsVersion`。run-lifecycle 的一个 turnSeq 下可以有多个角色的并行 slot，还有 attempt 重试（agentTurns 唯一键是 `(runId, turnSeq, role, attempt)`），并且有 G0 `turn.status === 'running'`，G1 也允许 `failed`（run-lifecycle.md:75-79，part2:60-75）。
- **反例**：attempt#1 超时，watchdog 把它标为 failed，`retryTurn` 在同一 turnSeq 上建了 attempt#2。attempt#1 的 action 取消不掉（V5），之后返回：本稿的四条守卫全部通过，于是同一个 slot 被持久化两次，可能插入两份提案。
- **建议**：采用 run-lifecycle 的 G0+G1+G2，只把 G3 换成本稿 D8 的 `turn.constraintsVersion === room.constraintsVersion`。INV-T1 改写为"G0–G2 ∧ D8"，提前退出检查也一样。

### r04 [high] part5 的冲突表已过时；真实未决冲突在别处
- **证据**：idempotent-execution 已经采纳 `exec:${proposalId}` 和 `createdAtConstraintsVersion`（idempotent-execution.md:55、77-80）。目前仍然冲突的有：
  (a) idempotent-execution/decide.ts:76、:91 通过 `proposal.runId` 读 run，并要求 `room.currentRunId === proposal.runId`，与本稿 G5 "看当前 run，不看 proposal.runId"冲突；
  (b) rules-engine-part2.md D10 用 `(proposalId, constraintsVersion)` 判断 already_executed，与 D12 冲突；
  (c) 同一处又规定"`decision.userId` 与快照里的 userId 不一致的决定被忽略"，也就是快照用户；本稿 INV-E3 / X16 用的是当前成员；
  (d) 同一个"审批集合是否齐全"的判定写了三份：本稿 `summarizeApprovals`、idempotent-execution `evaluateApprovalSet`、06 `evaluateExecutionReadiness`。
- **建议**：判定函数只保留一份，归 08 或 06 引擎层，另外两处调用它。执行键统一为 `exec:${proposalId}`，06 改为按 proposalId 判断 already_executed。成员语义统一为"当前成员"：快照只存 `{ role, kind }`。G5 的分歧通过删除 accept_base 消解（见 r06）。

### r05 [medium] 与 run-lifecycle 的裁决：取 D6/D8 的语义，取 run-lifecycle 的名字
- **证据**：run-lifecycle-part2.md:42、:115 规定 bump 总是取代 run；G3 比较 `constraintsVersionAtStart`。字面量不一致：`runTriggerV` 是 `constraint_change`（run-lifecycle/schema.ts:30），本稿是 `constraints_change`；endedReason 是 `superseded_by_constraint_change`，本稿是 `constraints_changed`。签名不一致：`supersedeRun(ctx, room)`（lifecycle.ts:125）对本稿的 `supersedeRun(ctx, runId, reason)`；`startRunInternal`（helper）对本稿调用的 `startRun`（在 run-lifecycle 中是 public mutation）。
- **建议**：语义上采纳 D6（pending_approval 且仍合规就保留 run）和 D8（看回合快照），run-lifecycle 的迁移表要补"pending_approval 跨版本保持"这一行。命名上本稿改用 run-lifecycle 已入 schema 的字面量和 helper 名，以免 03 出现两套枚举。

### r06 [medium] `accept_base` 是本稿自造的动作，属于过度设计，而且引出了 G5 的分歧
- **证据**：negotiation-protocol 全文没有 accept_base（grep 无结果）。它只在一种情况下有用：negotiating / needs_input / failed 状态下发生无关的 bump，而桌上的提案恰好仍合规。
- **建议**：v1 删掉它。新 run 总是由自己的回合产出提案；条款相同也插入新版本，termsKey 相同时界面标注"条款与 vN 相同"。删掉之后，D6 保留分支里 run 本来就没变，`proposal.runId === room.currentRunId` 恒成立，idempotent-execution 的守卫可以原样保留，X24 也随之删除。

### r07 [medium] 回归 5（先拒、后撤、再批）在本稿自己的守卫下不可能发生
- **证据**：reject 会立刻调用 `onProposalRejected`，run 迁到 negotiating 或 needs_input（decide.ts:90-92；回归 12 也这样要求）。之后同一提案上的 withdraw / approve 都会在 G5 返回 `NOT_AWAITING_APPROVAL`。X9 和测试 6 只验证了纯函数，集成层走不到。
- **建议**：明确 withdraw 只用于撤回本人的 approve（idempotent-execution D2 已是这个语义），reject 对该 (proposal, cv) 是终局。回归 5 改写为"拒绝 v3 → 重谈出 v4 → 批准 v4，v3 上的拒绝保留"。若产品坚持可以撤回拒绝，就需要"拒绝冷静期"（延迟迁移），复杂度明显上升，不建议在 v1 做。

### r08 [medium] userId 的类型与兄弟专题不一致
- **证据**：本稿 `approvals.userId: v.string()`，值为 tokenIdentifier（schema.ts:96）。idempotent-execution 的 members / approvals 与 run-lifecycle 的 `startedBy.userId` 都是 `v.id("users")`，users 表以 tokenIdentifier 为键（inputs/04 §1 含义 7）。inputs/02 F02.6 又写的是"userId = tokenIdentifier"。
- **建议**：由 03 拍板，推荐 `v.id("users")`。这样 tokenIdentifier 只出现在 users 表一处（privacy-disclosure-part3/part4 要求它不出现在视图和日志中），Clerk 实例迁移时也只改一处。`constraintRevisions.actorUserId` 同样改成 `v.id("users")`。

### r09 [medium] 表名、返回值、错误码、reasonCode 的命名冲突
- **证据**：
  - 本稿 G9 查 `changeOrders.by_proposalId`，返回 `changeOrderId`。idempotent-execution 的幂等锚点是 `executions`（operationId），`changeOrders.executionId` 指向它，返回 `executionId`；回归 7 写的也是 executionId。
  - 错误码：`NOT_REQUIRED_APPROVER` 对 `NOT_A_REQUIRED_APPROVER`，`ALREADY_EXECUTED` 对 `PROPOSAL_ALREADY_EXECUTED`。
  - 字段：`reasonCode` 对 `reasonKey`；idempotent-execution 的 approvals 有 `runId`，本稿没有。
  - 本稿内部也不一致：part2 G1 用 `NOT_A_MEMBER`，decide.ts 与 X27 用 `NOT_FOUND`。
  - reasonCode：本稿的 `SOURCE_PRICE_CHANGED`、`SOURCE_ITEM_WITHDRAWN`、`APPROVER_SET_CHANGED` 在 06 的 `REASON_CODES` 里都不存在。06 用的是 `SOURCE_CHANGED`、`UNKNOWN_ITEM` / `UNCONFIRMED_ITEM`、`NO_REQUIRED_APPROVERS`。
- **建议**：执行相关的名字以 08（idempotent-execution）为准，reasonCode 以 06 的 codes.ts 为唯一来源；本稿删掉自造的三个码。如果确实需要"撤回报价"，由 06 给目录 status 加 `withdrawn` 并定义对应的码。

### r10 [medium] "硬"的定义自相矛盾
- **证据**：D4 说"规则读到的东西变了 ⇔ 版本变了"，D5 说"硬 = 被 evaluateProposal 读取的字段"。但 D9 排除了台账（06 的 `BudgetInput.commitments` 会被预算检查读到），D5 也排除了 `preferredDate`（06 的 info 检查会读它）。
- **建议**：重新定义为"阻断性检查读取、且由人显式确认的输入"，并逐项列出排除项及各自的替代防线：台账由执行时重算兜底（D9），时钟由 r02 处理，软偏好只产生 info 码。

### r11 [low] `producedConstraintsVersion` 回填是多余的，而且违反只追加
- **证据**：bumpConstraints 会 patch 源表行（constraints.ts:101-104），但 part3 §3 宣称这些源表"全部只追加"。同样的信息已经在 `constraintRevisions.sourceRefs` 里。
- **建议**：删掉这个字段和回填逻辑，"版本 N 的输入"通过 sourceRefs 反查即可。

### r12 [low] INV-P2 与提案迁移表矛盾
- **证据**：INV-P2 写的是"`active` ⇔ `room.currentProposalId === _id`"，但 part3 §1.2 说执行后 `currentProposalId` 仍指向这份已 executed 的提案。
- **建议**：改为"active ⇒ 是当前提案；是当前提案 ⇒ active ∨ executed"。

### r13 [low] `summarizeApprovals` 的两个边界
- **证据**：standing.ts:70 用 `find` 取角色持有人，存在重复持有人时结果不确定。`latestBefore` 跳过 withdraw（standing.ts:51），所以旧版本上"先批准后撤回"仍会显示 stale_approve。
- **建议**：`holders.length !== 1` 时判为不齐（与 idempotent-execution 一致）。旧版本按 seq 取最后一行，它若是 withdraw 就视为没有决定。

### r14 [low] failed 的 run 在 bump 后会自动重开，绕过调用上限
- **证据**：reconcile 对 `failed` 的处理是 → superseded 并调度新回合（constraints.ts:131-149）。run-lifecycle 里 failed 可能是因为 `call_cap_reached` 或 `room_daily_cap`。
- **建议**：failed 的 run 仍然取代，但新 run 只在 `startRunInternal` 的上限检查通过时才调度回合，否则进入 needs_input，或等成员显式 restart。

### r15 [low] part3 §2.5 对读写集的描述不准确
- **证据**：原文说 A 和 B 都"读写 room 与 budgets"，但 A（decide）并不写 budgets。冲突实际来自 B 写 room / budgets 而 A 读过它们，以及 A 写 commitments / run 而 B 读过它们。
- **建议**：逐项写出两边的读集与写集，结论不变。另外要说明 OCC 永久失败（V2）会以 mutation 错误返回，前端需要通用重试提示。

## 2. 过度设计检查（汇总）

建议删除或推迟：accept_base（r06）、producedConstraintsVersion（r11）、B10 的 `approver_set` cause 和 `APPROVER_SET_CHANGED`（v1 不触发，可只留在 17 号路线图）、`invalidatedDecisionCount` 的单独查询（可以从 summarize 的结果里算出来）。

保留不动：constraintRevisions 表（它回答"为什么是 v N"，满足核心 6）、stale_reject 派生状态（RA-B30）、`expectedConstraintsVersion`（D3）。
