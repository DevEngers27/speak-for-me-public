# 03 · Convex schema v1（part5）：运行时三层（runs / turns；attempts / rawOutputs 见 part6）

> 分片清单见 `03-schema.md` 顶部。三层的职责划分见 02 §4.3：run = 一次协商的生命周期与上限；turn = 可被持久化守卫拒收的逻辑槽位（持有 cv 快照与候选快照）；attempt = 一次计费调用，**同时是用量账本**（canon §1.1、D01、D07、D08、D17）。状态迁移见 04 §4.3–4.5，运行时细节见 10。

## 3.8 运行时三层

### runs

```ts
runs: defineTable({
  roomId: v.id("rooms"),
  runNo: v.number(),                          // = rooms.nextRunNo（房间内从 1 连续，展示 "Run #2"）
  status: v.union(v.literal("negotiating"), v.literal("pending_approval"), v.literal("needs_input"),
    v.literal("executed"), v.literal("superseded"), v.literal("ended_no_agreement"), v.literal("canceled")),
  cause: v.union(v.literal("room_opened"), v.literal("constraints_changed"),
    v.literal("renegotiation_requested"), v.literal("manual_start")),           // 04 §4.3.1
  constraintsVersionAtStart: v.number(),      // 插入时重读的 room.constraintsVersion；D06 下非终态时恒等于它
  agentMode: agentModeV,                      // 开局时快照 AGENT_MODE；本 run 全部 attempt 同一模式
  roundNo: v.number(),                        // 1 起
  maxRounds: v.number(),                      // 场景快照，默认 3；keep_as_is 延长一次时 +1
  roundsExtended: v.boolean(),                // 每 run 至多延长一次（canon D15）
  activeTurnSeq: v.union(v.number(), v.null()), // 唯一可持久化的回合；非 negotiating 时为 null（G2）
  nextTurnSeq: v.number(),                    // 下一 turn 的序号，从 1 起
  currentProposalId: v.optional(v.id("proposals")), // 本 run 当前提案；D06 沿用时指向旧 run 创建的提案
  attemptCount: v.number(),                   // 已创建的 attempt 数（含 stub）
  maxAttempts: v.number(),                    // 快照：默认 maxRounds × 3 × 2（canon D17）
  reservedMicroUsd: v.number(),               // 在途 attempt 的美元预留之和（调度前预留、提交时结算）
  spentMicroUsd: v.number(),                  // 已结算估算成本之和
  spendCapMicroUsd: v.number(),               // 快照：每 run 美元上限（10 定默认值）
  previousRunId: v.optional(v.id("runs")),
  startedBy: v.optional(v.id("users")),       // 人工开局者，或引起系统开局的成员；纯系统为空
  endedReason: v.optional(v.union(v.literal("executed"), v.literal("constraints_changed"),
    v.literal("renegotiation_requested"), v.literal("no_agreement"), v.literal("request_expired"),
    v.literal("canceled_by_creator"), v.literal("room_closed"))),
  lastFailure: v.optional(v.object({ code: v.string(), at: v.number() })), // 最近一次回合失败（不随重试清除）
  provenance: provenanceV,
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
}).index("by_room_runNo", ["roomId", "runNo"])
  .index("by_status", ["status"]),            // ops.livenessSweep / setDraining(false) 只列 negotiating
```

- 唯一插入者 `startRunTx`（04 §4.3.3）：重读房间（run-lifecycle r13），断言 `currentRunId` 为空或已终态，`runNo = room.nextRunNo`，同事务写 `rooms.currentRunId` 与 `nextRunNo + 1`；房间写锁使并发开局只成功一个（E1/E2）。
- **不存的计数**（派生，避免漂移）：每角色 `propose / counter` 次数、clarify / escalate 是否已用、本 run 的 `excludedCandidateKeys`（已提出过——含被阻断、未插提案的 `outcome.blockedCandidateKey`——∪ 被人拒绝的 `candidateKey` ∪ `choose_candidate` 复核失败的键，后者由 `superseded(regenerated)` 请求的 `answerOptionKey` 派生）、`providerRejectLocked`（本 run 是否有 toRole = provider 的 `agent_escalated` 请求以 `keep_as_is` 回答）——由 `turns.by_run_turnSeq`（`result` / `outcome`）、`approvals.by_run_decision`（`(runId, 'reject')` 的行经 `proposalId` 取 `candidateKey`：被拒按决定所在的 run 计，D06 沿用的旧 run 提案在本 run 被拒同样进入本 run 的集合；不按 `proposals.runId` 取，3.9）与 `humanRequests.by_run_status` 在创建回合的 mutation 内现算（每 run ≤ 约 15 个 turn），05 §5.3.3 的 `ActionCtx` 与 canon D10 的剔除集合都从这里取。
- 披露类：`runNo` / `status` / `cause` / `roundNo` / `maxRounds` / `endedReason` / `startedAt` / `endedAt` 为 `room`（07 DX-4、DX-8）；美元字段（`reservedMicroUsd` / `spentMicroUsd` / `spendCapMicroUsd`）与 `attemptCount` 为 `system`（privacy-15：creator 可能是任一角色，实时增长的花费会泄露他方每次调用的 token 量即简报长度；成本汇总只在 `ops.metrics`，或 run 终态后按整 run 汇总给 creator，不实时更新）；`lastFailure` 为 `system`（失败的本方经自己的 turn / attempt 得知，他方只见 "finished"，privacy-06）；`startedBy` 为 `system`。不变量：INV-32、INV-33、INV-67、INV-68、INV-72、INV-76。

### turns

```ts
turns: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  turnSeq: v.number(),                        // = run.nextTurnSeq；(runId, turnSeq) 唯一
  roundNo: v.number(),
  role: roleV,
  kind: v.union(v.literal("propose"), v.literal("evaluate")),
  status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("completed"),
                  v.literal("failed"), v.literal("stale")),
  constraintsVersion: v.number(),             // 创建时 room.constraintsVersion 快照（G3 比较它，canon D07 / C12）
  baseProposalId: v.optional(v.id("proposals")),   // evaluate 回合评估的提案
  baseProposalVersion: v.optional(v.number()),     // 同上的版本号（模型只引用小整数，05 P01）
  candidateSnapshot: v.array(candidateV),     // ≤ 12，按 candidateKey 字典序，optionKey O1..On；写后不变
  allowedActions: v.array(agentActionV),      // allowedActions(role, kind, ctx) 的结果（05 §5.3.3）；写后不变
  promptVersion: v.string(),                  // 提示模板版本（缓存与评测归因）
  currentAttemptNo: v.number(),               // 0 = 尚无 attempt；G0 比较它
  waitingReason: v.optional(v.union(v.literal("backoff"), v.literal("spend_deferred"), v.literal("draining"),
                                    v.literal("run_cap"))),   // run_cap：系统开局超出每房间 24h run_starts 桶（canon D12 ⑥、10 B6a），带 beginFnId
  beginFnId: v.optional(v.string()),          // runAfter(…, turns.beginAttempt) 的 _scheduled_functions id（字符串存、normalizeId 读）
  retryOfTurnId: v.optional(v.id("turns")),   // retry_turn / 修复新建的 turn 指向被替代者
  result: v.optional(agentMoveV),             // 被接受的模型 move（含 rationale），05 §5.2
  outcome: v.optional(v.object({              // 服务端对该 move 的处置（04 §4.3.4）
    candidateKey: v.optional(v.string()),     // propose / counter 解析出的候选
    proposalId: v.optional(v.id("proposals")),// 因此插入的提案（provider propose 通过规则时）
    blockedCandidateKey: v.optional(v.string()), // provider 候选被规则阻断（不插提案，provider 只得 blocked）
    answeredFromFacts: v.optional(v.boolean()),  // clarify 由已披露事实代答
  })),
  createdAt: v.number(),
  completedAt: v.optional(v.number()),
}).index("by_run_turnSeq", ["runId", "turnSeq"]),
```

- 唯一插入者 `createTurnTx`（04 U1），在**同一 mutation** 内用 `enumerateCandidates(viewFor(role))` 写 `candidateSnapshot` 与 `allowedActions`：候选只在 mutation 内枚举，没有只读 query 重算（privacy review r09），`turns.complete` 只在快照内解析 `optionKey`（canon D10）。
- "run 任意时刻至多一个非终态 turn"：`createTurnTx` 断言 `by_run_turnSeq` 上无非终态行，并设 `run.activeTurnSeq`；不存在 `pendingTurnSeqs` / `openTurnCount`（canon D08）。
- 终态 turn 不重开：重试与修复建新 turn（`retryOfTurnId`），每个 turn 的 attempt 历史与结果一一对应（04 §4.4）。
- turn 上**没有** `failureCode` / `deferredUntil` / `drainParked` 一类字段：失败原因记在该回合最后一个 attempt 的 `errorCode` 与 `runs.lastFailure.code`（10 `decideRetry` 返回的 `failureCode` 只是返回值名）；等待只写 `waitingReason` + `beginFnId`，到期时刻由被调度函数本身承载（10 §10.3 已按此对齐）。
- 披露类：`turnSeq` / `roundNo` / `role` / `kind` / 时间戳为 `room`（"Provider agent drafting…"）；`status` 对本方为 `self(role)`，对他方只投影为粗粒度 `scheduled | running | done`（`failed` / `stale` 折叠为 `done`，且 `needs_input` 前最后一个评估回合统一显示 `done`：否则 provider 能从 `failed` 或"评估结束紧接 `run_waiting`"推出 `agent_failed` 的 kind / toRole 或 customer 代理做了 clarify，privacy-06；12 §12.17 的视图模型负责）；`candidateSnapshot`、`allowedActions`、`result`、`outcome`、`baseProposal*`、`waitingReason` 为 `self(role)`（候选由委托人视图计算，07 §7.8.5）；`beginFnId` / `retryOfTurnId` 为 `system`。不变量：INV-09、INV-23、INV-33、INV-41、INV-68、INV-69。
