# 03 Convex schema v1（part2：其余表、唯一性与不变量落点）

```ts
  proposals: defineTable({
    roomId: v.id('rooms'), runId: v.id('runs'), turnId: v.optional(v.id('turns')),
    seq: v.number(), parentProposalId: v.optional(v.id('proposals')),
    authorKind: v.union(v.literal('agent'), v.literal('rule'), v.literal('human_option'), v.literal('seed')),
    authorRole: v.optional(roleKey),
    selection: unknownPayload, derived: unknownPayload, contentKey: v.string(),
    ledgerImpact: v.array(v.object({ accountKey: v.string(), amountCents: v.number() })),
    requiredApprovals: v.array(v.object({ roleKey, kind: approvalKind })),   // 快照
    constraintsVersion: v.number(),              // 创建时版本（审计用；审批另绑决策时版本）
    status: proposalStatus,                      // 'active' | 'superseded' | 'executed'
    validationSnapshot: v.object({ constraintsVersion: v.number(), codes: v.array(v.string()) }),
    publicLine: v.object({ templateKey: v.string(), params: v.any() }),
    simulated: v.boolean(), createdAt: v.number(),
  }).index('by_room_seq', ['roomId', 'seq']).index('by_run', ['runId']),

  decisions: defineTable({
    roomId: v.id('rooms'), proposalId: v.id('proposals'), userId: v.id('users'), roleKey,
    kind: approvalKind, decision: decisionValue,  // 'approve' | 'reject' | 'withdraw'
    reasonCode: v.optional(v.string()), note: v.optional(v.string()),  // note 只给本人与同侧，见 07
    constraintsVersion: v.number(), contentKey: v.string(), decidedAt: v.number(),
  }).index('by_proposal_user', ['proposalId', 'userId']).index('by_proposal', ['proposalId']),

  humanRequests: defineTable({
    roomId: v.id('rooms'), runId: v.id('runs'), targetRole: roleKey,
    origin: v.union(v.literal('infeasible'), v.literal('deadlock'), v.literal('agent_topic'), v.literal('turn_failed')),
    templateKey: v.string(), params: v.any(),
    options: v.array(v.object({ optionKey: v.string(), labelTemplateKey: v.string(), labelParams: v.any(), effect: v.any() })),
    status: requestStatus, constraintsVersion: v.number(),
    answerOptionKey: v.optional(v.string()), answeredBy: v.optional(v.id('users')), answeredAt: v.optional(v.number()),
    cancelReason: v.optional(v.string()), createdAt: v.number(),
  }).index('by_room_status', ['roomId', 'status']).index('by_run', ['runId']),

  executions: defineTable({
    roomId: v.id('rooms'), proposalId: v.id('proposals'), operationId: v.string(),
    constraintsVersion: v.number(), approvingDecisionIds: v.array(v.id('decisions')), createdAt: v.number(),
  }).index('by_operation', ['operationId']).index('by_room', ['roomId']),

  outcomeDocuments: defineTable({
    roomId: v.id('rooms'), executionId: v.id('executions'), docKind: v.string(),
    audienceRoles: v.array(roleKey), templateKey: v.string(), body: v.any(), createdAt: v.number(),
  }).index('by_execution', ['executionId']).index('by_room', ['roomId']),

  tasks: defineTable({
    roomId: v.id('rooms'), executionId: v.id('executions'), taskKey: v.string(), title: v.string(),
    assigneeRole: roleKey, status: v.union(v.literal('open'), v.literal('done')), createdAt: v.number(),
  }).index('by_execution_task', ['executionId', 'taskKey']).index('by_room', ['roomId']),

  events: defineTable({
    roomId: v.id('rooms'), type: eventType, audience,   // {kind:'room'} | {kind:'roles', roles}
    templateKey: v.string(), params: v.any(),
    actorKind, actorRole: v.optional(roleKey), runId: v.optional(v.id('runs')),
    proposalId: v.optional(v.id('proposals')), constraintsVersion: v.number(),
    commitSeq: v.commitTs(), createdAt: v.number(),
  }).index('by_room_commit', ['roomId', 'commitSeq']),
});
```

`convex/lib/validators.ts` 中的联合类型（每个同时导出 TS 常量数组与编译期断言 `Infer<typeof x>` ⇄ `(typeof X)[number]`）：

| validator | 值 |
| --- | --- |
| `runStatus` | negotiating, pending_approval, needs_input, failed, confirmed, superseded |
| `turnStatus` | running, succeeded, invalid_output, failed, stale |
| `proposalStatus` | active, superseded, executed |
| `decisionValue` | approve, reject, withdraw |
| `requestStatus` | open, answered, cancelled |
| `entryStatus` | unconfirmed, confirmed, retired |
| `ledgerEntryKind` | baseline, execution, external |
| `approvalKind` | terms, commitment |
| `actorKind` | user, agent, system |
| `eventType` | room_created, participant_joined, brief_confirmed, catalog_changed, ledger_cap_changed, ledger_entry_added, constraints_changed, run_started, run_ended, turn_failed, turn_rejected_stale, proposal_created, proposal_superseded, decision_recorded, request_opened, request_answered, request_cancelled, executed |

## 唯一性：由哪个 mutation 守

| 逻辑唯一键 | 索引 | 唯一写入口 | 并发保证 |
| --- | --- | --- | --- |
| users.tokenIdentifier | by_token | `users.ensure` | 同 mutation 先 `.unique()` 后插，OCC |
| participants (roomId, roleKey) 与 (roomId, userId) | by_room_role / by_room_user | `invites.accept` | 同上；两条都查 |
| invites.tokenHash | by_token_hash | `rooms.create`、`invites.rotate` | 32 字节随机，碰撞忽略不计；仍先查 |
| briefVersions (roomId, roleKey, version) | by_room_role_version | `briefs.confirm`（取最大 version+1） | OCC |
| catalogEntries (roomId, entryKey, revision) | by_room_entry_rev | `catalog.upsertDraft`、`catalog.confirm`、`catalog.retire` | OCC |
| ledgerAccounts (roomId, accountKey) | by_room_account | `rooms.create`（按插件声明一次建齐） | 只建一次 |
| proposals (roomId, seq) | by_room_seq | `insertProposal` helper（读写 room.proposalSeq） | room 文档冲突串行化 |
| 每房间一个非终态 run | rooms.currentRunId | `startRunInternal` helper | 读写同一 room 文档 |
| turns (runId, turnSeq, attempt) | by_run_seq_attempt | `scheduleTurn` helper | run 文档冲突串行化 |
| executions.operationId | by_operation | `decisions.decide` 内的 `executeIfComplete` | 状态守卫为主，查重为辅 |
| tasks (executionId, taskKey) | by_execution_task | 同上（同事务） | 随 execution |

## 不变量落点

| 不变量（02 §5） | 代码落点 |
| --- | --- |
| I1 只追加 | 这些表只有 insert 写入口；`proposals` 只允许经 `setProposalStatus` 改 status；代码审查清单 + 测试扫描 `db.patch('proposals'` 调用 |
| I2 | `insertProposal(ctx, room, fields)` |
| I3 | `bumpConstraints(ctx, roomId, cause)`；`rooms.constraintsVersion` 的其他写入 lint 禁止 |
| I4 | `invites.accept` |
| I5 / I7 | `approvalSetComplete(decisions, proposal, room)` 纯函数（08） |
| I6 | `startRunInternal` + `assertTransition` |
| I8 | `rooms.view` 只返回模板参数与 rationale 的本方过滤 |
| I9 | `assertCents` 于全部金额入口；执行时引擎复算 `ledger.over_cap` |
| I10 | `executeIfComplete` |
| I12 | seed、stub 写入口强制 `simulated: true` |

## 演进
新增字段先 `v.optional` 再回填；插件 payload 升级用 `scenarioVersion`：房间绑定创建时的插件版本，插件同时保留旧版本 schema 的解析器，v1 不做跨版本迁移（17）。
