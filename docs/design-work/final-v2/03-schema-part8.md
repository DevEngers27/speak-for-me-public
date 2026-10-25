# 03 · Convex schema v1（part8）：执行产物与运维表

> 分片清单见 `03-schema.md` 顶部。执行事务的 17 步、金额链推导与对账 R1–R11 见 08；排空与花费上限见 10、15。

## 3.10 执行产物（字段按 08 §8.3.3 定稿）

### executions（幂等锚点与审计记录，只追加）

```ts
executions: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  proposalId: v.id("proposals"),
  proposalVersion: v.number(),
  executionKey: v.string(),                   // "exec:" + proposalId（canon D03：不含 cv、不哈希、服务端派生）
  constraintsVersion: v.number(),             // 执行时 room.constraintsVersion
  termsKey: v.string(),                       // = proposal.termsKey
  approvalIds: v.array(v.id("approvals")),    // 冻结快照，按 requiredApprovals 顺序（canon D04、R-J）
  executedByUserId: v.id("users"),            // 提交最后一票的人
  scenarioKey: v.literal("scope_change"),
  scenarioVersion: v.number(),                // 类型随 rooms.scenarioVersion（3.2 第 7 条）
  amountCents: v.number(),                    // = proposal.terms.amountCents
  committedBeforeCents: v.number(),           // 快照：仅展示 / 对账，不参与任何计算（08 A11）
  committedAfterCents: v.number(),            // = committedBeforeCents + amountCents <= capCentsAtExecution
  capCentsAtExecution: v.number(),
  provenance: provenanceV,
  executedAt: v.number(),
}).index("by_executionKey", ["executionKey"])
  .index("by_room", ["roomId"])
  .index("by_proposal", ["proposalId"]),
```

- 唯一写者 `executions.executeIfComplete`（helper，只能经 `approvals.record` 同事务到达，INV-21）：先查 `by_executionKey`，命中即 fail closed（`internal` + `opsLog`）；再查 `by_room`（v1 一房一执行，D04）；与 `ledgerEntries(commit)`、`changeOrders`、`tasks`、`rooms.executionId / status / executedAt`、`proposals.status`、`runs.status` 同事务写入；执行**不** bump（canon D03）。
- 客户端不传任何幂等键；`requestId` 之类只用于请求去重与追溯（spikes §1：客户端 operationId 两次点击写出两条 execution）。
- 披露类：`proposalVersion` / `constraintsVersion` / `termsKey` / `approvalIds` / `amountCents` / `executedAt` / `provenance` 为 `room`；`committedBeforeCents` / `committedAfterCents` 为 finance 类（customer 仅当执行时生效的 `sharedFacts` 行把 `committedCents` 共享给它，07 §7.8.5），`capCentsAtExecution` 同理按 `capCents` 开关；`executionKey` / `executedByUserId` / `runId` 为 `system`。不变量：INV-21、INV-46 – INV-48、INV-53、INV-60、08 E1–E11。

### changeOrders（执行派生的变更单文档，AIA G701 金额链，只追加）

```ts
changeOrders: defineTable({
  roomId: v.id("rooms"),
  executionId: v.id("executions"),
  proposalId: v.id("proposals"),
  proposalVersion: v.number(),
  number: v.number(),                         // 链内序号：followsExecutionId ? 前序变更单 number + 1 : 1；显示 CO-{number}
  terms: termsV, lines: v.array(lineV), termsKey: v.string(),
  baselineCents: v.number(),                  // G701 (1) 原合同额 ← 本房 baseline 账本行
  priorApprovedDeltaCents: v.number(),        // G701 (2) 已批准变更累计 ← 本房此前 commit 之和（v1 恒 0）
  amountBeforeCents: v.number(),              // G701 (3) 本次前金额 = (1) + (2)
  deltaCents: v.number(),                     // G701 (4) 本次增减 = terms.amountCents
  amountAfterCents: v.number(),               // G701 (5) 新金额 = (3) + (4) <= capCentsAtExecution
  constraintsVersion: v.number(),
  followsExecutionId: v.optional(v.id("executions")),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_execution", ["executionId"])
  .index("by_room", ["roomId"]),
```

- 金额链由纯函数 `computeChangeOrderChain`（08 §8.4）生成并校验连续性；`amountBeforeCents === executions.committedBeforeCents`、`amountAfterCents === committedAfterCents` 由对账 R1–R11 断言。工期链：v1 只有新完工日 `terms.deliveryDate`（没有"原完工日"可比，G701 的 days delta 列入 17）。
- 不存 `deferredItemKeys`（canon D11）、不存 `operationKey`。
- 披露类：`number` / `terms` / `lines` / `termsKey` / `deltaCents` / `proposalVersion` / `constraintsVersion` / `provenance` 为 `room`（金额 = 公开目录价之和）；`baselineCents` / `priorApprovedDeltaCents` / `amountBeforeCents` / `amountAfterCents` 为 finance 类（customer 按执行时生效的 `committedCents` 共享行判定，禁止溯及既往，07 PV-12）。不变量：08 G9、R1–R11。

### tasks（只有完成字段可变）

```ts
tasks: defineTable({
  roomId: v.id("rooms"),
  executionId: v.id("executions"),
  taskKey: v.string(),                        // `${executionId}:${itemKey}:${templateIndex}`（canon §1.2，三段）
  itemKey: v.string(),
  templateIndex: v.number(),                  // 从 0 起
  title: v.string(),                          // 来自 proposal.plannedTasks 快照，执行时不重算模板
  assigneeRole: roleV,
  dueDate: v.string(),                        // = terms.deliveryDate
  status: v.union(v.literal("open"), v.literal("done")),
  doneByUserId: v.optional(v.id("users")),
  doneAt: v.optional(v.number()),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_taskKey", ["taskKey"])
  .index("by_execution", ["executionId"])
  .index("by_room_assignee", ["roomId", "assigneeRole", "status"]),
```

- 插入只在 `executeIfComplete`（来自 `proposal.plannedTasks`，所见即所写，08 G9）；`taskKey` 唯一由"executionId 唯一 × `(itemKey, templateIndex)` 在 `plannedTasks` 内唯一"推出，`by_taskKey` 供对账复核。
- 唯一可变写入：被指派角色把 `open → done`（终态），并写 `doneByUserId` / `doneAt` 与 `task_completed` 事件。这是 `executed` 房间允许的两个写入之一（07 §7.7；函数名 `tasks.markDone`，12 定名，04 / 08 同），`openRoomTx` 对它显式放行 `executed`。
- 披露类：整行 `room`，`doneByUserId` 为 `system`（DTO 给角色）。不变量：INV-49（taskKey 与快照派生）。

## 3.12 运维表

### opsFlags（单行）

```ts
opsFlags: defineTable({
  key: v.literal("global"),                   // 恰一行
  draining: v.boolean(),                      // 排空开关（canon D17）：置位后 turns.beginAttempt 不建 attempt、人工开局拒绝
  changedAt: v.number(),
  changedBy: v.union(v.id("users"), v.null()),// 经 `npx convex run ops:setDraining` 时为 null
}).index("by_key", ["key"]),
```

- 唯一写者 `ops.setDraining`（internal，15 的部署手册调用）；`setDraining(false)` 时对 `runs.by_status = negotiating` 的每一行调度 `runs.reconcile`（04 §4.3.5）。读者：`turns.beginAttempt`（置位 → turn 记 `waitingReason: 'draining'`，返回 `run.draining`）、`runs.start` / `runs.requestRenegotiation`（拒绝 `run.draining`）、`ops.activeAttemptCount`（`attempts.by_status_deadline` 前缀 `eq('running')` 且 `provenance = 'live'` 的计数，等于 0 才部署）。stub 不受排空约束（canon D17；10 R17、12 §12.18）：stub attempt 在同一事务内完成，不会跨部署。
- `AGENTS_ENABLED` 仍是环境变量（紧急止血），不入表（canon D17、techstack D33）；与排空一样只作用于 live attempt，stub 不受影响（canon D17："stub 模式不受两者影响"）。
- 披露类：`system`。

### spendCounters（全局日美元）

```ts
spendCounters: defineTable({
  scope: v.literal("global"),
  day: v.string(),                            // UTC "YYYY-MM-DD"
  reservedMicroUsd: v.number(),               // 在途 attempt 的预留
  spentMicroUsd: v.number(),                  // 已结算估算
  attempts: v.number(),                       // 当日 live attempt 数（ops.metrics）
  unknownCostAttempts: v.number(),            // 无响应、成本未知的 attempt 数（不编造金额，10 §10.12.2）
}).index("by_scope_day", ["scope", "day"]),
```

- 写者：`turns.beginAttempt`（预留；`spent + reserved + 本次预留 > 日上限` 时不 throw，turn 记 `waitingReason: 'spend_deferred'` 并 `runAfter` 到次日 UTC 0 点，canon D17）、`turns.complete / fail`、`agents.watchdog`（结算）。日上限来自 `config.ts` 白名单解析的环境变量（10、15）。
- 跨房间的同一行是热点：v1 规模（个位数并发房间）下由 OCC 自动重试吸收（techstack X2）；观测到冲突率上升再按 `day + shard` 分片（接口不变）。不经 `openRoomTx`。
- 披露类：`system`。没有 `usageCounters`、没有房间级累计计数（canon D17 修正草稿）。
