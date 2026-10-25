# 03 Convex schema v1（part3：执行记录、事件、计数器、唯一性与不变量落点、演进）

## 3.10 执行记录

```ts
changeOrders: defineTable({                           // R，不可变；它就是"执行记录"
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  proposalId: v.id("proposals"),
  proposalVersion: v.number(),
  constraintsVersion: v.number(),                     // 执行时的 cv（执行后 cv 再 +1）
  operationKey: v.string(),                           // `exec:${proposalId}:${constraintsVersion}`
  terms: termsV,                                      // 冻结副本
  priceCents: v.number(),
  termsKey: v.string(),
  decisionIds: v.array(v.id("decisions")),            // 构成执行条件的各席位当前 approve
  executedByParticipantId: v.id("participants"),      // 投出最后一票的席位
  rulesVersion: v.string(),
  templateVersion: v.string(),                        // 任务派生模板版本
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_operationKey", ["operationKey"])
  .index("by_room", ["roomId"])
  .index("by_proposal", ["proposalId"]),

commitments: defineTable({                            // F（finance；X2 投影给 customer）
  roomId: v.id("rooms"),
  changeOrderId: v.id("changeOrders"),
  amountCents: v.number(),                            // = changeOrder.priceCents
  constraintsVersion: v.number(),                     // = changeOrder.constraintsVersion
  snapshot: v.object({                                // 执行当时的预算快照，结果页直接读取
    capCents: v.number(),
    committedBeforeCents: v.number(),
    committedAfterCents: v.number(),
    headroomAudience: v.array(v.string()),            // 执行时 headroom 已披露给哪些角色
  }),
  isSimulated: v.boolean(),
  createdAt: v.number(),
}).index("by_room", ["roomId"]).index("by_changeOrder", ["changeOrderId"]),

tasks: defineTable({                                  // R
  roomId: v.id("rooms"),
  changeOrderId: v.id("changeOrders"),
  itemKey: v.string(),
  title: v.string(),                                  // 来自目录条目 taskTitle
  assigneeRoleKey: v.string(),                        // 场景模板决定（首场景 provider）
  assigneeParticipantId: v.id("participants"),
  dueDate: v.string(),                                // = terms.deliveryDate
  status: v.union(v.literal("todo"), v.literal("in_progress"), v.literal("done")),
  isSimulated: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
}).index("by_room", ["roomId"])
  .index("by_changeOrder", ["changeOrderId"])
  .index("by_assignee_status", ["assigneeParticipantId", "status"]),
```

不另设 `executions` 表：变更单与执行一一对应，合并后少一张表、少一次 join，`operationKey` 的唯一性落在变更单上（ADR-09）。基线已承诺额不在 `commitments` 中，而在 finance 简报的硬字段里（带 `baselineSource` 来源说明），因为它是 finance 声明的事实而不是本系统执行的结果（ADR-02）。

## 3.11 事件

```ts
const actorV = v.union(
  v.object({ kind: v.literal("system") }),
  v.object({ kind: v.literal("participant"), participantId: v.id("participants"), roleKey: v.string() }),
  v.object({ kind: v.literal("agent"), roleKey: v.string() }));

export const eventPayloadV = v.union(
  v.object({ type: v.literal("room_created"), scenarioKey: v.string() }),
  v.object({ type: v.literal("seat_filled"), roleKey: v.string() }),
  v.object({ type: v.literal("brief_confirmed"), roleKey: v.string(), version: v.number(), hardChanged: v.boolean() }),
  v.object({ type: v.literal("disclosure_changed"), ownerRoleKey: v.string(), version: v.number(),
             added: v.array(disclosureV), removed: v.array(disclosureV) }),
  v.object({ type: v.literal("catalog_published"), version: v.number(), itemCount: v.number() }),
  v.object({ type: v.literal("room_activated") }),
  v.object({ type: v.literal("constraints_changed"), fromCv: v.number(), toCv: v.number(),
             changedByRoleKey: v.string(), source: v.union(v.literal("brief"), v.literal("catalog")) }),
  v.object({ type: v.literal("run_started"), runSeq: v.number(), trigger: v.string() }),
  v.object({ type: v.literal("proposal_created"), proposalVersion: v.number(), authorKind: v.string(),
             authorRoleKey: v.string(), priceCents: v.number() }),
  v.object({ type: v.literal("reviews_completed"), proposalVersion: v.number(), round: v.number() }),
  v.object({ type: v.literal("run_awaiting_approval"), proposalVersion: v.number() }),
  v.object({ type: v.literal("run_needs_human"), targetRoleKeys: v.array(v.string()), publicReason: v.string() }),
  v.object({ type: v.literal("run_failed"), publicErrorClass: v.string() }),
  v.object({ type: v.literal("run_ended"), runSeq: v.number(), outcome: v.string() }),
  v.object({ type: v.literal("stale_result_discarded"), roleKey: v.string() }),
  v.object({ type: v.literal("decision_recorded"), proposalVersion: v.number(), constraintsVersion: v.number(),
             roleKey: v.string(), kind: v.string(), reasonCode: v.optional(v.string()) }),
  v.object({ type: v.literal("request_opened"), targetRoleKey: v.string(), kind: v.string() }),
  v.object({ type: v.literal("request_closed"), targetRoleKey: v.string(), kind: v.string(),
             outcome: v.string(), changedConstraints: v.boolean() }),
  v.object({ type: v.literal("change_order_executed"), proposalVersion: v.number(),
             constraintsVersion: v.number(), priceCents: v.number(), taskCount: v.number() }),
  v.object({ type: v.literal("task_status_changed"), itemKey: v.string(), status: v.string() }),
  v.object({ type: v.literal("room_closed") }));

events: defineTable({                                 // R，只追加
  roomId: v.id("rooms"),
  actor: actorV,
  payload: eventPayloadV,
  runId: v.optional(v.id("runs")),
  proposalId: v.optional(v.id("proposals")),
  constraintsVersion: v.optional(v.number()),
  commitTs: v.commitTs(),                             // 按提交顺序的全序（convex 1.48）
  createdAt: v.number(),
}).index("by_room_commitTs", ["roomId", "commitTs"]),
```

载荷分类表（TC-PRIV-03 的依据）：上面每个字段都属于"公开"类——id、版本号、roleKey、itemKey、计数、提案价格、事件枚举、披露的字段名与受众（不含值）。`decision_recorded` 不含 note（渲染时从 `decisions` 表读取，同为 R 表）。`commitTs` 在 convex-test 中的行为待验证；不可用时退回 `_creationTime` 排序并接受同毫秒乱序。

## 3.12 计数器

```ts
counters: defineTable({                               // S
  key: v.string(),                                    // 如 "renegotiate:user:<id>"、"publish:room:<id>"、"dup_exec:room:<id>"
  window: v.string(),                                 // "2026-11-02"（按 UTC 日）或 "total"
  count: v.number(),
}).index("by_key_window", ["key", "window"]),
```

计数与被限流的动作在同一 mutation 内读写；热点只在单用户或单房间粒度，OCC 冲突可接受。全局花费上限不用单文档计数（热点），由模型供应商 workspace 上限与 `AGENTS_ENABLED` 承担（15）。

## 3.13 唯一性落点

Convex 索引不保证唯一（inputs/04 §1.6）。每条逻辑唯一性都有"覆盖索引 + 唯一写入口 + 先查后写"，并依赖 OCC 串行化并发写入（并发下的冲突行为需在真实部署上验证，TC-EXE-02）。

| 逻辑唯一性 | 索引 | 唯一写入口 | 写入前检查 |
| --- | --- | --- | --- |
| `users.tokenIdentifier` | `by_tokenIdentifier` | `users.ensureMe` | `.unique()` 为空才插入 |
| `(roomId, roleKey)` 席位 | `by_room_role` | `rooms.create`（之后不再插入） | 按场景 roles 一次性插入 |
| `(roomId, userId)` 席位 | `by_room_user` | `invites.accept`、`rooms.create` | 该用户在本房间无席位 |
| 邀请 `tokenHash` | `by_tokenHash` | `internal.invites.store` | 256 位随机，碰撞概率可忽略；仍做 `.unique()` 断言 |
| 席位的 open 邀请至多一个 | `by_participant_status` | `internal.invites.store` | 先把旧 open 置 revoked |
| `(participantId, version)` 简报版本 | `by_participant_version` | `writeBriefVersion` | 读最大 version，+1 |
| `(roomId, version)` 目录版本 | `by_room_version` | `writeCatalogVersion` | 同上 |
| `(roomId, cv)` 约束快照 | `by_room_cv` | `activateRoom`、`bumpConstraints` | cv 来自房间文档计数器 |
| `(roomId, version)` 提案 | `by_room_version` | `insertProposal` | 读写 `rooms.proposalSeq` |
| `(roomId, seq)` run | `by_room_seq` | `startRun` | 读写 `rooms.runSeq` |
| 每房间至多一个非终态 run | `rooms.currentRunId` | `startRun` | 先终止 `currentRunId` 指向的非终态 run |
| `(runId, round, roleKey, attempt)` 回合 | `by_run_round` | `scheduleTurn` | 同 round 同角色只能有一个非终态尝试 |
| `operationKey` 变更单 | `by_operationKey` | `executeInTx`（只被 `decisions.decide` 调用） | 命中即返回已有记录 |
| 每变更单一条承诺 | `by_changeOrder` | `executeInTx` | 与变更单同事务插入 |

计数器字段（`proposalSeq`、`runSeq`、`constraintsVersion`）都放在 `rooms` 文档上：分配版本号的 mutation 必然读写房间文档，所以并发分配被 OCC 串行化，号码不会重复。代价是房间文档成为写热点；本系统每房间的写频率很低（人类操作与少量回合），可接受（inputs/04 §1.3）。

## 3.14 不可变表的写入约束

| 表 | 允许的写 | 静态测试（TC-VER-06）断言 |
| --- | --- | --- |
| `briefVersions`、`catalogVersions`、`constraintSnapshots`、`proposals`、`decisions`、`changeOrders`、`commitments`、`events`、`agentNotes`、`modelCalls` | 仅 `insert` | 源码中对这些表的 `db.patch/replace/delete` 调用为零（`admin.purgeRoom` 除外） |
| `tasks` | `insert`；`patch` 仅 `status`/`updatedAt` | 只有 `tasks.updateStatus` patch |
| `rooms` | `patch` 仅指针、计数器、lifecycle、closedAt | 只有引擎 helper patch |
| `runs`、`agentTurns`、`humanRequests`、`roomInvites`、`participants`、`briefDrafts`、`users`、`counters` | 状态迁移经各自 `assertTransition` | 迁移表单测（04） |

## 3.15 schema 演进

1. 新字段先 `v.optional`，部署后用 internal 迁移 mutation 回填，再收紧为必填（推送时 Convex 会校验已有数据）。
2. 新增场景只向 `briefContentV`、`catalogContentV`、`termsV`、`candidateV`、`briefHardPatchV` 联合追加成员，不改已有成员。
3. 场景插件版本升级（`scenarioVersion`、`rulesVersion`）不改写旧提案与旧变更单；旧记录按其记录的版本解释。规则代码保留旧版本求值器至少到所有引用它的房间关闭（17）。
4. 大表新增索引用 `staged: true` 后台回填（inputs/04 §1.6）。
5. 个人开发部署可以清表重新 seed；共享的预发布与生产部署只做前向迁移。
