# 02 · 领域模型（part3）：版本化对象、计数器、run / turn / attempt 三层

> 分片清单见 `02-domain-model.md` 顶部。

## 2.5 版本化对象与"人批准的到底是什么"

| 版本化对象 | 身份 | 不可变内容 | 谁产生新版本 |
| --- | --- | --- | --- |
| 简报版本 | `(roomId, role, version)` | `hardFields`、`softFields`、`disclosures`、`source`、`confirmedBy` | 本人 `briefs.confirm`；finance `budget.setCap`；`toRole` 回答带约束效果的请求 |
| 目录行 | `(roomId, itemKey, revision, editNo)` | 该行全部字段；`revision` 只随价格 / 工期 / 状态变化，`editNo` 只随标题 / 任务模板变化 | provider `catalog.confirm` / `catalog.retire`；`startFollowUp` 把旧房间未执行的条目复制为草稿（12 §12.6） |
| 共享事实 | `(roomId, fromRole, field, seq)` | 值（或撤回）、受众、所属简报版本 | `materializeDisclosures`、`sharedFacts.add` |
| 约束版本 | `rooms.constraintsVersion` + 一行 `constraintRevisions` | `cause`、`actorUserId`、`sourceRefs`、`localDate` | `constraints.bump`（开房、硬投影变化、时间结论翻转） |
| 提案 | `proposalId`（展示 `version`） | `terms`、`termsKey`、`lines[]`、`plannedTasks[]`、`requiredApprovals`、`createdAtConstraintsVersion` | `insertProposal`（代理提案或人选候选） |
| 审批决定 | `(proposalId, userId, seq)` | `decision`、`boundConstraintsVersion`、`boundTermsKey`、`reasonKey`、`note` | 人经 `approvals.record` |
| 执行 | `executionKey = exec:${proposalId}` | `constraintsVersion`、`termsKey`、`approvalIds[]`、已承诺前后快照 | 最后一票同事务的 `executeIfComplete` |

**人批准的具体版本** = 不可变条款（`proposalId`，以 `termsKey` 复核）× 当时的约束版本（`boundConstraintsVersion`，其硬输入可由 `constraintRevisions` 折叠重放）× 当前成员身份。任一侧变化——条款换了提案、约束版本前进、成员不是当前成员——旧审批就不再计数（INV-26），但审批行原样保留。执行再把"计数的那几行"冻结进 `executions.approvalIds`，之后任何事都不会把它们重新评估为失效（INV-53）。

为什么不需要内容哈希：提案行写后不改，`proposalId` 已证明"批准的是哪份条款"；`termsKey` 是规范 JSON 串，人可读、可在服务端做一次相等比较（D25）。为什么提案不随约束变化复制：条款没变就不该出现两行相同的版本（RA-R11 否决），约束绑定由审批行承担；约束变化后若同一提案仍通过全部检查，新 run 直接指向同一 `proposalId` 重批（D06、INV-32(a)）。

## 2.6 计数器与版本号

| 计数 | 所在 | 分配方式 | 何时前进 | 是否重置 | 唯一写者 |
| --- | --- | --- | --- | --- | --- |
| `constraintsVersion` | `rooms` | 当前 + 1，同事务插 revision 行 | 开房（0 → 1）、硬投影变化、`clock` 结论翻转 | 从不（follow-up 新房间从 0 起） | `constraints.bump` |
| `nextProposalVersion` | `rooms` | 读后 + 1 | 守卫通过、提案真正插入时；被拒收的回合与被阻断的候选不消耗 | 从不（不因新 run 或 bump 重置，F04.7） | `insertProposal` |
| `nextRunNo` | `rooms` | 读后 + 1 | 每个新 run | 从不 | `startRunTx` |
| `writeSeq` | `rooms` | + 1 | 每个房间业务事务 | 从不 | `openRoomTx` |
| 简报 `version` | `briefs` | 当前最大 + 1 | 内容或披露有任何变化的确认 | 从不 | `insertBriefVersion` |
| 目录 `revision` / `editNo` | `catalogItems` | 见 03 §3.7 契约 | 定价变化 / 展示变化 | `editNo` 随新 revision 归 0 | `appendCatalogRow` |
| 共享事实 `seq` | `sharedFacts` | 每键最大 + 1 | 值或受众变化 | 从不 | `appendSharedFact` |
| `roundNo` / `maxRounds` | `runs` | + 1 | 进入下一轮；`keep_as_is` 延长时 `maxRounds + 1`（每 run 一次） | 新 run 从 1 起 | `advanceRun`、`approvals.record(reject)`、`humanRequests.answer` |
| `turnSeq` | `turns`（`runs.nextTurnSeq`） | 读后 + 1 | 每个新 turn（跨轮连续） | 新 run 从 1 起 | `createTurnTx` |
| `attemptNo` | `attempts`（`turns.currentAttemptNo`） | + 1 | 每次调度调用 | 每个 turn 从 1 起 | `turns.beginAttempt` |
| 审批 `seq` | `approvals` | 本人在本提案的最大 + 1 | 每次写入的决定（`unchanged` 不前进） | 跨 cv 不重置 | `approvals.record` |
| 事件 `seq` | `events` | 0..n-1 | 同一事务内 | 每事务从 0 起 | `appendEvents` |
| 变更单 `number` | `changeOrders` | 前序 + 1 | 每次执行 | follow-up 链内连续 | `executeIfComplete` |
| `watchdogArmCount` | `attempts` | + 1 | 看门狗发现 action 仍 `pending / inProgress` | 每 attempt 从 0 起，≤ 3 | `agents.watchdog` |

所有"读后 + 1"的分配都发生在持有房间写锁的事务里（DM-09），因此在 OCC 下不会产生重复号；没有任何排序依赖 `_creationTime`（墙钟，不保证提交序）。

## 2.7 运行时三层：run / turn / attempt

### 2.7.1 各层是什么、为什么需要

| 层 | 一行是什么 | 持有的关键事实 | 为什么不能并入相邻层 |
| --- | --- | --- | --- |
| run | 一次协商尝试：从开局到执行、被取代、未达成或取消 | 状态、原因、`constraintsVersionAtStart`、轮次、`activeTurnSeq`、`currentProposalId`、attempt 与美元上限 | 约束变化要"整体取代"一次协商并开新的（D06）；单活跃、上限、预留都按 run 计 |
| turn | run 内一个角色的一个回合（`propose` 或 `evaluate`） | `constraintsVersion` 快照、`candidateSnapshot`、`allowedActions`、`baseProposal*`、被接受的 `result` 与服务端 `outcome` | 持久化守卫比较的是回合的快照（G2 / G3）；重试必须沿用**同一**快照，否则 `optionKey` 会错位（D10） |
| attempt | 该回合的一次模型调用（含 stub） | 状态、`usage`、`stopReason`、`requestId`、`schemaVersion`、预留与成本、看门狗登记 | 每次调用都可能迟到、超时、被拒收，但费用已经发生；G0 用 `attemptNo` 识别"是不是当前这次调用"，看门狗以 `attemptId` 登记，新 attempt 不会被旧看门狗误杀（agentquality 评委反例） |

### 2.7.2 attempt 即用量账本

1. **每次模型调用恰一行**：`turns.beginAttempt` 在调度 `agents.runAttempt` 的同一事务里插入 attempt 行（canon D01 唯一调度接缝）；stub 调用也插行（`model: 'stub:v1'`、`usage` 全 0、`provenance: 'stub'`）。
2. **无论成败先记用量**：action 拿到响应后，第一件事是把 `usage` / `stop_reason` / `requestId` 交给 `turns.complete / fail` 写入（D09、INV-40）；`messages.parse()` 会丢 usage，所以不用。
3. **迟到结果照记**：守卫 G1–G3 失败 → attempt 标 `stale`、用量照记；G0 失败（attempt 已被看门狗判 `timeout`）→ 只补写一次用量字段并置 `lateUsage: true`，不改状态（写门面断言这些字段"只能从空写成值"）。
4. **美元预留与结算**：调度前按 `RESERVE_MICRO_USD`（输入预留 12,000 token 与 `maxTokens` 输出各乘 `MAX_BILLED_RESPONSES_PER_CALL = 2`——一次调用至多两次带响应的发送：首发与截断后的调用内重试——再按价目表估算，10 §10.5.2）预留到 `runs.reservedMicroUsd` 与 `spendCounters(global, day)`；提交时按实际 `usage` 结算到 `spentMicroUsd`；超时无用量时按预留结算，迟到结果到达再按实际回补差额（10）。每 run 美元上限（或 attempt 上限）用尽 → 不调度下一 attempt，run 转 `needs_input` + customer 的 `rounds_exhausted`（码 `run.call_limit`，`questionKey` 后缀 `spend_limit` / `call_limit`），选项 `choose_candidate` ×≤ 3 与 `end_run`，不提供 `keep_as_is`（D15、D17）；全局日上限满 → 不 throw，turn 记 `spend_deferred` 并调度到次日（D17）。
5. **聚合只走索引**：房间用量 `attempts.by_room`、run 复核 `by_run`、卡住告警 `by_status_deadline`；成本是估算并带 `priceTableAsOf`，界面标 "estimate"。v1 没有非回合调用（简报抽取列入 17），所以账本不需要"turn 可选"的通用形状。

### 2.7.3 重试分层与上限（每个错误类只有一层负责）

| 错误类 | 负责层 | 次数 |
| --- | --- | --- |
| 429、连接错误 | 网关 `callModel`：同一次调用内重发（SDK `maxRetries: 0`，退避不超过剩余总截止；canon D09） | 每次调用 ≤ 1 |
| `output.truncated`（`max_tokens`） | 网关：同一次调用内重发，第二次截断 `retryable: false`、不再开新 attempt | 每次调用 ≤ 1 |
| `output.not_json` / `schema_violation` / 语义校验失败、action 丢失（`action_crashed`）、看门狗重登记用尽（`watchdog_timeout`） | 应用层：同 turn 新 attempt（`auto_retry`） | 每条链 ≤ 1（`MAX_ATTEMPTS_PER_TURN = 2`，10 定） |
| 总截止到期（`model_timeout`）、网关重试后仍失败的 429 / 连接错误、408 / 409 / 5xx / 529、第二次截断、`refusal`、400 / 401 / 403、上下文溢出、`agents_disabled` | 无 | 0 → turn `failed` → `needs_input(agent_failed)` 给失败方（`retry_turn` / `end_run`） |

每条回合链最坏 HTTP 次数 = 每次调用 3 次发送 × 2 个 attempt = 6（10 §10.10.1）；每 run attempt 总数 ≤ `runs.maxAttempts`（默认 `maxRounds × 3 × 2 = 18`）。没有 `paused`：失败的去向永远是一个有收件人、有期限的请求（D15）。

### 2.7.4 走查：D27 主线在三层上留下的行

1. 第三份简报确认 → 房间打开（cv 0 → 1）→ run#1（`cause: room_opened`）→ turn 1（provider，`propose`，快照 O1 $800、O2 $900（provider 视图按已披露必需项与截止日过滤，14 S3；O1 为锚定的最低价候选））→ attempt 1.1（stub）→ provider 选 O2（必需 + `usage_dashboard`，$900）→ `insertProposal` 得 v1（$900，`deliveryDate` 由当日 `localDate` 物化）→ turn 2（customer，`evaluate`）→ attempt 2.1 → `recommend_accept` → turn 3（finance）→ attempt 3.1 → `recommend_accept` → run#1 `pending_approval`。此时 6 行（3 turn + 3 attempt），v1 `active`。
2. customer、provider 在 cv1 批准（approvals 各 seq 1）。finance `budget.setCap(480000)` → 新 finance 简报 v2 → 投影变化 → cv 2，`constraintRevisions` v2 行（`cause: brief_confirmed`）→ run#1 `superseded`、v1 `stale`、两条审批派生为 `stale_approve` → 预检：v1 在新约束下 `budget.over`（400000 + 90000 > 480000），不能 R2 沿用 → 全量约束下的可行集（`buyerFeasible`，04 §4.3.3）非空 → run#2 `negotiating`。
3. run#2：turn 1（provider，第 1 轮快照 O1 $800、O2 $900：新 run 不剔除 v1 的候选）→ attempt（stub）按愿望清单选 O2（$900）→ `checkProposal`（全量）= `budget.over`（400000 + 90000 > 480000）→ **不插提案、不消耗版本号**，turn 记 `outcome.blockedCandidateKey`，不花评估调用（05 P10）→ turn 2（provider，第 2 轮，快照剔除被阻断的键后只剩 O1 $800）→ attempt → 选 O1 → v2（$800）→ customer、finance 各一回合 `recommend_accept` → `pending_approval` → 三方在 cv2 批准，最后一票同事务执行：`committedBeforeCents = 400000`、`committedAfterCents = 480000 = capCents`（恰等于上限通过，D27）、`ledgerEntries(commit, 80000)`、`changeOrders.number = 1`、`tasks` 来自 v2 的 `plannedTasks`；run#2、v2、房间 → `executed`。run#2 留下 4 turn + 4 attempt；live 模型也可能在第 1 轮直接选锚点 O1，两条路径都得到 v2（D27）。

全程每个模型调用都在 `attempts` 留下一行（stub 主线共 7 个：run#1 3 个、run#2 4 个）；v1 的两条 cv1 审批与 v2 的三条 cv2 审批全部保留；`executions.approvalIds` 只含 v2 的三条。
