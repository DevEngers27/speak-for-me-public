# 12 后端函数目录（part2）：查询、internal 函数、helper

> 分片清单见 part1。所有查询对未认证或非参与者返回 `null`；返回值全部经过 07 §7.3 的投影。

## 12.3 public query

| 函数 | 参数 | 返回（摘要） | 鉴权 |
| --- | --- | --- | --- |
| `users.me` | — | `{ userId, displayName } \| null` | — |
| `health.viewer` | — | `{ tokenIdentifier } \| null`（只返回调用者自己的，供运维取 seed 账号 id） | 已登录 |
| `health.status` | — | `{ convexAuth: boolean, agentMode, agentsEnabled, circuit, modelVerifiedAt? }`（不含任何密钥或配置值） | 已登录 |
| `rooms.listMine` | — | `RoomCard[]`：标题、场景、状态、我的角色、待办徽标（待确认简报、待我审批、待我回答、我的旧审批已失效） | 已登录 |
| `rooms.workspace` | `{ roomId }` | `WorkspaceDTO`（12.4），一个查询给出各窗口一致的快照 | 参与者 |
| `briefs.mine` | `{ roomId }` | 我的草稿、我的全部确认版本、委托条款文本与版本 | 本人 |
| `briefs.disclosurePreview` | `{ roomId }` | 每个他方角色看到的我的字段（用 `projectBriefFor` 生成） | 本人 |
| `briefs.previewConstraintImpact` | `{ roomId, fields }` | 只给本人：确认后是否递增版本、当前提案的新评估（按本人可见投影）、将失效的审批数、剩余候选数 | 本人 |
| `catalog.list` | `{ roomId }` | 当前有效条目 + 每个 itemKey 的版本历史 | 参与者 |
| `proposals.history` | `{ roomId }` | 全部提案：版本、作者、条款、派生状态；当前提案另带可执行性与按查看者渲染的检查 | 参与者 |
| `proposals.executionPreview` | `{ proposalId }` | 批准后将创建的记录（08 §8.7），按查看者投影 | 参与者 |
| `runs.list` | `{ roomId }` | run 摘要：序号、触发、约束版本、状态、结局、调用数 | 参与者 |
| `runs.timeline` | `{ runId }` | 每个 turn：角色、轮次、公开结果（模板文本）、状态、每个 attempt 的元数据（状态、重试原因、耗时、token、stale 原因）；本角色 turn 另带 `privateRationale` | 参与者 |
| `decisions.forProposal` | `{ proposalId }` | 全部决定行（含撤回与 stale），备注按 `reasonNoteAudience` 投影 | 参与者 |
| `requests.mine` | `{ roomId }` | 目标为我的请求全文；他方请求只有摘要 | 参与者 |
| `events.list` | `{ roomId, paginationOpts }` | 分页的渲染后事件（按 `by_room_and_commitTs` 倒序，服务端按受众过滤；只返回文本与安全 refs） | 参与者 |
| `results.view` | `{ roomId }` | 执行记录、变更单（预算快照按投影）、任务、追溯链（变更单 → 决定 → 提案 → 条目版本 → 约束版本） | 参与者 |
| `usage.roomSummary` | `{ roomId }` | 调用数、token、估算成本（含价格表版本）、未知成本请求数、按 run 分组 | 参与者 |
| `invites.listForRoom` | `{ roomId }` | 邀请状态、角色、过期时间（不含令牌） | 创建者 |

## 12.4 `rooms.workspace` 的 DTO（声明 `returns`）

```ts
export const workspaceDTO = v.object({
  room: v.object({ id: v.id("rooms"), title: v.string(), goal: v.string(), status: roomStatusV, timeZone: v.string(),
                   constraintsVersion: v.number(), isSimulated: v.boolean(), agentMode: agentModeV }),
  me: v.object({ roleKey: v.string(), isCreator: v.boolean(), participantId: v.id("participants") }),
  participants: v.array(v.object({ roleKey: v.string(), displayName: v.string(),
                                   briefVersion: v.optional(v.number()), briefConfirmedAt: v.optional(v.number()) })),
  readiness: v.object({ ok: v.boolean(), missing: v.array(v.object({ code: v.string(), ownerRoleKey: v.string() })) }),
  sharedFacts: v.array(v.object({ fromRoleKey: v.string(), label: v.string(), valueText: v.string() })),
  budget: v.optional(v.object({ capCents: v.number(), committedCents: v.number(), headroomCents: v.number() })),  // 仅预算受众
  liveRun: v.optional(v.object({
    runId: v.id("runs"), seq: v.number(), status: runStatusV, outcome: v.optional(v.string()), round: v.number(),
    maxRounds: v.number(), agentMode: agentModeV,
    turns: v.array(v.object({ roleKey: v.string(), round: v.number(), status: v.string(), attemptNo: v.number(),
                              attemptStatus: v.optional(v.string()), resultText: v.optional(v.string()),
                              startedAt: v.optional(v.number()), expectedP95Ms: v.number() })),   // 客户端据此显示"比平时慢"
    failureText: v.optional(v.string()), canResume: v.boolean(), canProposeManually: v.boolean() })),
  candidates: v.array(v.object({ candidateKey: v.string(), label: v.string(), amountCents: v.number(),
                                 deliveryDate: v.string(), deliveryMode: v.string(), deferredLabels: v.array(v.string()) })),
  currentProposal: v.optional(v.object({
    proposalId: v.id("proposals"), version: v.number(), termsKey: v.string(), summaryText: v.string(),
    authorText: v.string(), isSimulated: v.boolean(), executable: v.boolean(),
    checks: v.array(v.object({ checkId: v.string(), ok: v.boolean(), text: v.string() })),   // 已按查看者渲染
    budgetLine: v.string(),                                                                     // 买方 / provider 两套文案
    approvals: v.array(v.object({ roleKey: v.string(), approvalKind: approvalKindV, state: decisionStateV })),
    myAction: v.optional(v.object({ approvalKind: approvalKindV, canApprove: v.boolean(),
                                    disabledReason: v.optional(v.string()) })) })),
  requestsForMe: v.array(requestCardV),
  todos: v.array(v.object({ code: v.string(), text: v.string(), href: v.string() })),
  banners: v.array(v.object({ code: v.string(), text: v.string() })),   // 模拟数据、代理不可用、协商受阻等
});
```

`budget` 与只有买方能看的文案字段在投影中按查看者填充；provider 的返回值里根本没有这些键。PV-01 以 provider 身份调用并断言返回 JSON 不含 `capCents` 等键、不含 fixture 中的预算数值与金丝雀串。

## 12.5 internal 函数

| 函数 | 类型 | 调用者 | 说明 |
| --- | --- | --- | --- |
| `agentRuntime.claimAttempt` | mutation | `executeAttempt` | 10 part3 §10.6.2 |
| `agentRuntime.recordAttemptResult` / `recordAttemptFailure` | mutation | `executeAttempt` | §10.6.4 |
| `agentRuntime.applyAttemptResult` | mutation（被调度） | record | §10.6.5 |
| `agentRuntime.attemptWatchdog` | mutation（被调度） | `scheduleAttempt` | §10.6.6 |
| `agentActions.executeAttempt` | action（被调度） | `scheduleAttempt` | §10.6.3 |
| `invites.storeInvite` | mutation | `invites.create` | 再次校验创建者；撤销同角色旧邀请；插入 |
| `extraction.claim` / `record` / `apply` / `watchdog`、`extractionActions.run` | mutation / action | 同运行时模式 | 10 part6 §10.22 |
| `ops.resetAgentCircuit` | mutation | CLI | 关闭熔断，写 ops 日志 |
| `ops.checkModelAccess` | action | CLI（部署后） | `models.retrieve(AGENT_MODEL)` |
| `ops.sweepStuckRuns` | mutation | cron 每 5 分钟（`convex/crons.ts`，API 名待验证） | 找 `deadlineAt` 已过 10 分钟仍非终态的 attempt、running 却没有非终态 attempt 的 run；告警，必要时补调 watchdog 逻辑 |
| `ops.metrics` / `ops.liveAttemptCount` | query | CLI / 运维面板 | 15 §15.4 |
| `ops.checkConfig` | query | 部署流水线 | 11 §11.4 的配置组合检查；失败即回滚 |
| `ops.setRoomModelCallLimit` | mutation | CLI | 调整单个房间的调用上限 |
| `ops.purgeRoom` | mutation | CLI | 07 §7.11 |
| `seed.seedFixtureRoom` | mutation | CLI | `{ fixtureKey, participants: {customer, provider, finance: tokenIdentifier}, agentMode }`；走生产写入路径（14 §14.8） |
| `seed.applyFixtureVariant` | mutation | CLI / 测试 | 以对应角色身份调用同一组 helper（例如变体 A 以 finance 身份确认新上限） |
| `seed.setTestFaultPlan` | mutation | 测试 | 仅 `ALLOW_FAULT_INJECTION=true` |

## 12.6 helper（普通函数，不是 Convex 函数）

`getOrCreateUser`、`requireUser`、`requireParticipant`、`requireRole`、`loadRuleInput`、`bumpConstraints`、`onConstraintsChanged`、`startRunTx`、`supersedeRunTx`、`startTurn`、`scheduleAttempt`、`onTurnFailed`、`concludeRound`、`applyTurnOutput`、`insertProposal`、`executeIfReady`、`planAndInsertRequests`、`emitEvent`、`incrementUsage`、`assembleAgentContext`、投影函数（`projectBriefFor`、`budgetViewFor`、`renderChecksFor`、`renderEventFor`）。按 inputs/04 §1.1 的建议用普通函数而不是 `ctx.runMutation` 组织事务内逻辑，避免额外的隔离上下文开销。
