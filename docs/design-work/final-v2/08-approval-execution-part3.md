# 08 审批与执行（part3）：8.3 数据形状

> 03 是 schema 的唯一定稿处；本节列出 08 读写的表、字段与索引，作为 03 的需求。名称冲突时以 canon §1 为准并回改 03。`v.*` 只校验形状（spikes B5：负数、小数、NaN、空串都能写入），金额 / 日期 / 长度在代码里校验（§8.3.5）。

## 8.3.1 共享 validator（唯一定义在 03 §3.4，08 只引用）

`convex/lib/validators.ts` 的唯一定义处是 03 §3.4；本章不再复述字段，避免两处漂移（早稿把 `executions.scenarioVersion` 写成 `v.string()`、`lineV` 漏了 `kind`，names-28）。08 用到的 validator 与要点：

```ts
import {
  roleV, provenanceV,                 // 03 §3.4
  decisionV, approvalKindV, requiredApprovalV,
  rejectReasonKeyV,                   // 场景封闭枚举，取值表归 14 §3；人类拒绝理由另带受众（A13）
  termsV,                             // { itemKeys, modifiers, deliveryDate（插入时物化的绝对日期，D22）, amountCents = Σ lines[].priceCents（D25） }
  lineV,                              // { itemKey, kind: 'item' | 'modifier', revision, title, priceCents, leadDays }：条目与修饰项各一行
  plannedTaskV,                       // { itemKey, templateIndex, title, assigneeRole, dueDate }
} from './lib/validators';
```

`lines` 字段含 `kind`（修饰项 rush 也占一行）：03 §3.4、12 的 DTO 与 canon D25 现文一致（跨章核对阶段补入 canon）。

## 8.3.2 08 消费的他表字段（03 / 04 / 06 定义，08 只读）

| 表 | 字段 | 08 的用法 |
| --- | --- | --- |
| `rooms` | `status`、`constraintsVersion`、`localDate`、`timeZone`、`currentRunId`、`scenarioKey`、`scenarioVersion`、`provenance`、`followsExecutionId?`、`writeSeq`（M-ROOM）、`executionId?` / `executedAt?`（执行时写） | 守卫、`boundConstraintsVersion` 来源、规则的 `today`（= `localDate`）、场景版本守卫、provenance 继承、变更单链内序号、房间写锁、结果页定位 |
| `runs` | `status`、`currentProposalId`、`roundNo`、`endedReason` | 当前性守卫（**看当前 run 的 `currentProposalId`，不看 `proposal.runId`**：D06 预检保留时提案被新 run 沿用，versioned-approvals G5）；reject 后的轮次分支 |
| `proposals` | `status`、`runId`、`version`、`terms`、`termsKey`、`lines[]`、`plannedTasks[]`、`requiredApprovals[]`、`candidateKey`、`origin`、`createdAtConstraintsVersion`、`provenance` | 绑定、判定、执行快照；`createdAtConstraintsVersion` 只作来历，不参与可执行性 |
| `members` | `roomId`、`userId`、`role`（索引 `by_room_user`、`by_room_role`） | 调用者角色、当前成员解析 |
| `briefs` | finance 最新版本的 `hardFields.capCents`、customer 最新版本的 `requiredItemKeys` / `deadline` | `RuleInput`（经 06 的 `loadRuleInput`） |
| `sharedFacts` | 每个 `(fromRole, field)` 的有效行（`seq` 最大、撤回行 `value === null` 不进入；07 §7.8.3） | `loadRuleInput` 同时返回的 `shared` 账本（06 §5.1 第 2 步）：他方字段的可见性来源、金额投影开关 |
| `catalogItems` | 每个 `itemKey` 的最新 `revision`、`status`、`priceCents`、`leadDays` | `RuleInput`、R9 价格来源复核 |
| `humanRequests` | `roomId`、`status` | 执行时防御性 supersede（应为 0 条） |

`plannedTasks[]` 的默认派生（06/14 定稿）：按 `terms.itemKeys` 顺序，对每个 item 的当时修订的 `taskTemplates[i]` 生成 `{ itemKey, templateIndex: i, title, assigneeRole, dueDate: terms.deliveryDate }`；修饰项（rush）默认无任务模板。插入后不变。

## 8.3.3 08 拥有的表

```ts
// 只追加（A2）。"当前决定" = (proposalId, userId) 上 seq 最大的行。
approvals: defineTable({
  roomId: v.id('rooms'),
  proposalId: v.id('proposals'),
  runId: v.id('runs'),                    // 决定时的 room.currentRunId；仅来历，判定不读
  userId: v.id('users'),
  role: roleV,                            // 取自 members；不接受客户端
  kind: approvalKindV,                    // 取自 proposal.requiredApprovals；只影响文案
  decision: decisionV,
  seq: v.number(),                        // (proposalId, userId) 内 1..n，跨 cv 不重置
  boundConstraintsVersion: v.number(),    // = 写入时 room.constraintsVersion = expectedConstraintsVersion
  boundTermsKey: v.string(),              // = proposal.termsKey = expectedTermsKey
  reasonKey: v.optional(rejectReasonKeyV),// decision === 'reject' 时必有，其余必无；受众按场景 humanReasonKeys[].audience（A13）
  note: v.optional(v.string()),           // 仅本人；≤ 500 码点；不进事件 / 他方上下文
  decidedAt: v.number(),                  // 仅展示；任何排序都不读它
}).index('by_proposal_user', ['proposalId', 'userId', 'seq']),

// 引擎的幂等锚点与审计记录（A7）。只由 executeIfComplete 写，写后不改。
executions: defineTable({
  roomId: v.id('rooms'), runId: v.id('runs'),
  proposalId: v.id('proposals'), proposalVersion: v.number(),
  executionKey: v.string(),               // `exec:${proposalId}`
  constraintsVersion: v.number(),         // 执行时 room.constraintsVersion
  termsKey: v.string(),
  approvalIds: v.array(v.id('approvals')),// 冻结快照，按 requiredApprovals 顺序（A9）
  executedByUserId: v.id('users'),        // 提交最后一票的人（并发时取决于提交顺序）
  scenarioKey: v.literal("scope_change"), scenarioVersion: v.number(), // 与 rooms.scenarioKey / scenarioVersion 同型（03 §3.5、03 Q8）
  amountCents: v.number(),                // = proposal.terms.amountCents
  committedBeforeCents: v.number(),       // 快照：仅展示 / 对账，不参与计算（A11）
  committedAfterCents: v.number(),
  capCentsAtExecution: v.number(),
  provenance: provenanceV,                // 'live' | 'seeded' | 'stub'
  executedAt: v.number(),
}).index('by_executionKey', ['executionKey'])
  .index('by_room', ['roomId'])
  .index('by_proposal', ['proposalId']),

// 执行派生的变更单文档（AIA G701）。写后不改。
changeOrders: defineTable({
  roomId: v.id('rooms'), executionId: v.id('executions'),
  proposalId: v.id('proposals'), proposalVersion: v.number(),
  number: v.number(),                     // 链内序号：followsExecutionId ? 前序变更单 number + 1 : 1；显示 CO-{number}
  terms: termsV, lines: v.array(lineV), termsKey: v.string(),
  baselineCents: v.number(),              // G701 (1) 原合同额 ← 本房 baseline
  priorApprovedDeltaCents: v.number(),    // G701 (2) 已批准变更累计 ← 本房此前 commit 之和（v1 恒 0）
  amountBeforeCents: v.number(),          // G701 (3) 本次前金额 = (1) + (2)
  deltaCents: v.number(),                 // G701 (4) 本次增减 = terms.amountCents
  amountAfterCents: v.number(),           // G701 (5) 新金额 = (3) + (4) ≤ capCentsAtExecution
  constraintsVersion: v.number(),
  followsExecutionId: v.optional(v.id('executions')),
  provenance: provenanceV,
  createdAt: v.number(),
}).index('by_execution', ['executionId'])
  .index('by_room', ['roomId']),

// 已承诺金额的唯一真相源（A11）。只追加。
ledgerEntries: defineTable({
  roomId: v.id('rooms'),
  kind: v.union(v.literal('baseline'), v.literal('commit')),
  amountCents: v.number(),
  executionId: v.optional(v.id('executions')), // commit 必有、baseline 必无（代码断言 + R5）
  recordedByUserId: v.id('users'),        // baseline：finance；commit：最后一票的人
  provenance: provenanceV,
  createdAt: v.number(),
}).index('by_room_kind', ['roomId', 'kind']),

// 执行派生任务。只有 status / doneByUserId / doneAt 可变（tasks.markDone）。
tasks: defineTable({
  roomId: v.id('rooms'), executionId: v.id('executions'),
  taskKey: v.string(),                    // `${executionId}:${itemKey}:${templateIndex}`
  itemKey: v.string(), templateIndex: v.number(),
  title: v.string(), assigneeRole: roleV, dueDate: v.string(),
  status: v.union(v.literal('open'), v.literal('done')),
  doneByUserId: v.optional(v.id('users')), doneAt: v.optional(v.number()),
  provenance: provenanceV,
  createdAt: v.number(),
}).index('by_taskKey', ['taskKey'])
  .index('by_execution', ['executionId'])
  .index('by_room_assignee', ['roomId', 'assigneeRole', 'status']),
```

不存在的表与字段（防止回潮）：`budgets`、`commitments`、`decisions`、`signoffs`、任何 `committedCents` 计数器、`operationId` / `operationKey`、`deferredItemKeys`（D11）、`approvalRequired`、`contentHash`、`approvals.constraintsVersion`（改名 `boundConstraintsVersion`）。

## 8.3.4 逻辑唯一性落点（Convex 没有唯一约束：每条写明索引 + 唯一写入口 + 机制）

| 逻辑唯一性 | 索引 | 唯一写入口 | 机制 |
| --- | --- | --- | --- |
| 每 `(proposalId, userId, seq)` 一行 | `approvals.by_proposal_user` | `approvals.record` | seq = 本人最大 seq + 1：approve 从本提案**整个**区间（`eq('proposalId')`）取，reject / withdraw 只读本人区间（`eq(proposalId).eq(userId)`，S9）；并发同键由 M-ROOM（`rooms.writeSeq`，03 SC-05）确定冲突，区间读冲突（V2，有源码注释佐证）为第二道 |
| 每 proposal 至多一条 execution | `executions.by_executionKey`、`by_proposal` | `executeIfComplete`（只能经 `approvals.record` 到达） | 守卫（`proposal.status === 'active'`、`run.status === 'pending_approval'`）为主；`by_executionKey` 查重为辅，命中 fail closed |
| 每 room 至多一条 execution（D04） | `executions.by_room` | 同上 | `room.status === 'open'` 守卫 + `by_room` 查重 |
| 每 execution 恰一张变更单、恰一条 commit | `changeOrders.by_execution`、`ledgerEntries.by_room_kind` | 同上 | 与 execution 同事务插入，无其他写路径 |
| 每 room 恰一条 baseline | `ledgerEntries.by_room_kind` | `ledger.recordBaseline` | `room.status === 'setup'` + 先查后写；`runs.start` 前置要求 baseline 已存在（04） |
| `taskKey` 唯一 | `tasks.by_taskKey` | `executeIfComplete` | 由 executionId 唯一与 `(itemKey, templateIndex)` 在 `plannedTasks` 内唯一推出；R6 复核 |
| 成员 `(roomId, userId)`、`(roomId, role)` | `members.by_room_user` / `by_room_role` | `invites.accept`（07） | D24；本章在判定中对 `holders.length !== 1` 拒绝算齐 |

## 8.3.5 唯一写入口白名单与字段校验

- **CI 结构测试（AST / grep）**：`ctx.db.insert('approvals'` 只出现在 `convex/approvals.ts`；`insert('executions' | 'changeOrders' | 'tasks'` 只出现在 `convex/model/executions.ts`；`insert('ledgerEntries'` 只出现在 `convex/ledger.ts`（`recordBaseline`）与 `convex/model/executions.ts`；对 `approvals` / `executions` / `changeOrders` / `ledgerEntries` 的 `patch` / `replace` 零处；`patch('tasks'` 只在 `tasks.markDone` 且只改 `status` / `doneByUserId` / `doneAt`；这些表的 `delete` 只在 dev-only 的 `seed.reset`（只删 `provenance !== 'live'` 的房间，D18）。seed 走生产写入口，禁止 `t.run` 直插（spikes B 注意项：直插重复行会让 `.unique()` 之后永久失败关闭）。
- **执行模块纯度**：`convex/model/executions.ts`、`convex/approvals.ts`、`convex/ledger.ts` 不得 import `"use node"` 模块、任何 action、`fetch`、外部 SDK；不得调用 `ctx.scheduler`（reject 分支的回合调度由 04/10 的 helper 完成，位于 `convex/runs/*`）。lint 规则写进 11。
- **代码校验**：所有金额过 `assertCents`（安全整数，0 ≤ n ≤ 1e11）；`dueDate` / `deliveryDate` 过 `isIsoDate`；`note` 为可选，≤ 500 码点、不含 `\r` 与 U+0000–U+001F（`\n` 除外），否则 `input.invalid`；`reasonKey` 由 validator 限定在场景枚举内，且 `decision !== 'reject'` 时不得出现（handler 断言）；`seq`、`number`、`templateIndex` 为正整数（`templateIndex` 可为 0）。
- **披露旁注**：`note`、`reasonKey` 不在 `termsKey` 覆盖范围内；`REDACTABLE_FIELDS` 与 `termsKey` 覆盖字段不相交（03 must_absorb）。
