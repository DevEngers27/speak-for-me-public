# 03 · Convex schema v1（part2）：写门面、房间写锁、共享 validator

> 分片清单见 `03-schema.md` 顶部。

## 3.3 写门面与房间写锁（M-ROOM）

### 3.3.1 为什么需要房间写锁

Convex 没有行锁与唯一约束，只有 mutation 级可串行化（OCC：读集被并发提交改动的事务自动重试）。本设计的大量守卫是"先查后写"：`approvals.record` 读本提案全部审批区间后插入、`invites.accept` 读两条成员索引后插入、`insertProposal` 读 `nextProposalVersion` 后插入、`executeIfComplete` 读 `by_executionKey` 后插入。它们在并发下正确，前提是"并发插入会让读过同一索引区间的事务冲突"。这一点有源码注释旁证（versioned-approvals review V3），但 convex-test 测不了（spikes §1），真实部署验证排在 spikes §8 #1。

**M-ROOM**：任何改变某房间业务状态的 mutation，在第一次写之前调用 `openRoomTx(ctx, roomId)`，它重读房间并 `patch(roomId, { writeSeq: room.writeSeq + 1 })`。同房间的两个业务事务因此都读写 `rooms` 同一文档，OCC 必然让后提交者重试，重试时它会看到前者的全部写入。于是：

- 上述"先查后写"即使区间读冲突在某种情况下不成立，也仍然串行；
- `approvals` 的 withdraw（不写 run）与最后一票并发、`turns.complete` 与 `constraints.bump` 并发、两个 `invites.accept` 争同一角色，都有确定的冲突点；
- 代价：同房间写入串行化。每房间 3 人、每分钟个位数写入（加上至多一个在途回合），可以接受；不同房间互不冲突。

`openRoomTx` 不放进 query；`users.ensureViewer`、`opsFlags`、`spendCounters` 是全局写，不经它。`clock.rollLocalDate` 与各类巡检 cron 必须**每个房间一个 mutation**（cron 只列出房间 id 再逐个 `runAfter(0)`），否则一个巡检事务会与所有房间的活动冲突。

### 3.3.2 写门面 `convex/lib/db.ts`

业务代码对数据库的写只能经门面；ESLint `no-restricted-properties` 禁止门面外出现 `ctx.db.patch / replace / delete`，CI grep 保证关键表的 `insert` 只出现在其唯一写入口文件（3.13）。

```ts
// convex/lib/db.ts（形状；实现细节归 11）
export const APPEND_ONLY = ["briefs", "sharedFacts", "catalogItems", "ledgerEntries",
  "constraintRevisions", "approvals", "executions", "changeOrders", "events"] as const;

export const MUTABLE_FIELDS = {
  users:         ["displayName", "isTestAccount", "updatedAt"],
  rooms:         ["status", "constraintsVersion", "localDate", "nextProposalVersion", "nextRunNo",
                  "writeSeq", "currentRunId", "executionId", "openedAt", "executedAt", "closedAt"],
  invites:       ["status", "acceptedBy", "acceptedAt"],
  runs:          ["status", "roundNo", "maxRounds", "roundsExtended", "activeTurnSeq", "nextTurnSeq",
                  "currentProposalId", "attemptCount", "reservedMicroUsd", "spentMicroUsd",
                  "endedReason", "lastFailure", "endedAt"],
  turns:         ["status", "currentAttemptNo", "waitingReason", "beginFnId", "result", "outcome", "completedAt"],
  attempts:      ["status", "actionFnId", "watchdogFnId", "watchdogArmCount", "deadlineAt", "schemaVersion",
                  "usage", "stopReason", "stopCategory", "requestId", "messageId", "responseModel",
                  "latencyMs", "costMicroUsd", "priceTableAsOf", "lateUsage", "errorCode", "issuePaths",
                  "staleGuard", "httpStatus", "retryAfterMs", "rationaleTruncated",
                  "move", "outputBytes", "rawOutputRef", "finishedAt"],
  proposals:     ["status", "statusChangedAt"],
  humanRequests: ["status", "answeredBy", "answerOptionKey", "answeredAt", "closedReason", "closedAt"],
  tasks:         ["status", "doneByUserId", "doneAt"],
  opsFlags:      ["draining", "changedAt", "changedBy"],
  spendCounters: ["reservedMicroUsd", "spentMicroUsd", "attempts", "unknownCostAttempts"],
} as const;                               // members 无可变字段（v1 不换人，D24）

export type RoomTx = {
  readonly room: Doc<"rooms">;            // 已 patch writeSeq 之后重读的文档
  insert<T extends RoomScopedTable>(t: T, doc: WithoutSystemFields<Doc<T>>): Promise<Id<T>>;
  patch<T extends keyof typeof MUTABLE_FIELDS>(t: T, id: Id<T>,
    fields: Partial<Pick<Doc<T>, (typeof MUTABLE_FIELDS)[T][number]>>): Promise<void>;
};
export async function openRoomTx(ctx: MutationCtx, roomId: Id<"rooms">,
  opts: { allow: readonly RoomStatus[] }): Promise<RoomTx>;
export type RoomCtx = MutationCtx & { readonly tx: RoomTx };   // 04 §4.1.2：一切写 helper 的上下文；入口只 openRoomTx 一次，
                                                               // helper 只经 ctx.tx 写，被内联调用时复用调用方的 tx（不二次加锁）
```

规则：

1. `RoomTx.insert` / `patch` 只接受"房间作用域表"（除 `users`、`opsFlags`、`spendCounters`、`rawOutputs` 外的全部表），并断言文档的 `roomId === tx.room._id`。没有 `RoomTx` 就写不了房间作用域表——房间写锁因此是**类型层面**的强制，而不靠记忆。
2. `opts.allow` 是房间状态白名单：`executed` / `closed` 房间默认拒绝（`run.invalid_state`，canon D04、04 §4.2.2）；`tasks.markDone` 与 `rooms.startFollowUp`（只读旧房间）显式传入 `executed`（07 §7.7 的两个例外）。
3. 类型层 `patch` 只接受白名单字段，运行时再断言一次；`status` 字段只能经 04 §4.1.2 的 `setStatus`（内部调用 `tx.patch`）写入。
4. **写一次字段**：`attempts.usage`、`requestId`、`costMicroUsd` 等用量字段只允许从 `undefined` 写成值（迟到结果补记用量，D07），门面对这些字段断言"原值为空"。
5. **删除只有两个入口**：`seed.reset`（dev / preview、只删 `provenance !== 'live'` 的房间及其全部行，canon D18，入口 `assertTier`）与 `ops.purgeRawOutputs`（删过期的 `rawOutputs`），无其他。生产没有 reset。
6. **第二种、也是最后一种对只追加表的写**：`privacy.redact`（internal sysMutation，全部层级都有，只能由运维经 CLI 人工发起；v1 不提供自助删除 / 账户删除，07 §7.24 第 11 条、12 §12.20、17）只把 `REDACTABLE_FIELDS`（3.16）覆盖为固定串 `"[redacted]"` 并写 `pii_redacted` 事件；编译期断言该清单与 `termsKey` 覆盖字段不相交（techstack D38）。它不删除任何行；canon D18 已写明它是只追加表的唯一例外（跨章核对阶段同步，3.20 Q11 已关闭）。

### 3.3.3 provenance 继承

```ts
// core/engine/provenance.ts
export const inheritProvenance = (...src: Provenance[]): Provenance =>
  src.includes("seeded") ? "seeded" : src.includes("stub") ? "stub" : "live";
```

| 行 | 取值 |
| --- | --- |
| `rooms` | `rooms.create` 写 `live`；`seed.fromFixture` 经同一入口写 `seeded`；`startFollowUp` = `inheritProvenance(旧房间, followedExecution)`（旧执行非 `live` 时，后续房间及其全部派生行——含重新录入的基线——都不是 `live`） |
| `briefs` / `catalogItems` / `sharedFacts` / `ledgerEntries(baseline)` | = 房间 provenance（seed 走生产写入口，canon D18） |
| `runs` / `humanRequests` | run = `inheritProvenance(room, agentMode)`；请求 = `inheritProvenance(room, run)` |
| `attempts` | `live` 或 `stub`（= `runs.agentMode`），再与房间继承 |
| `proposals` | `agent`：`inheritProvenance(room, attempt)`；`human_choice`：`inheritProvenance(room, run, sourceRequest)`——人的选择不清除模拟来源，stub run 中选出的提案仍是 `stub` |
| `executions` / `changeOrders` / `tasks` / `ledgerEntries(commit)` | `inheritProvenance(room, proposal, 所引用目录行…)` |
| `events` | = 房间 provenance（与触发者无关；界面对 seeded / stub 统一徽章） |

## 3.4 共享 validator（`convex/lib/validators.ts`）

```ts
export const roleV = v.union(v.literal("customer"), v.literal("provider"), v.literal("finance"));
export const provenanceV = v.union(v.literal("live"), v.literal("seeded"), v.literal("stub"));
export const agentModeV = v.union(v.literal("live"), v.literal("stub"));
export const approvalKindV = v.union(v.literal("terms"), v.literal("budget"));
export const decisionV = v.union(v.literal("approve"), v.literal("reject"), v.literal("withdraw"));
export const requiredApprovalV = v.object({ role: roleV, kind: approvalKindV });
export const reasonCodeV = /* 由 core/engine/reasonCodes.ts 的 REASON_CODES 手写镜像（06） */;
export const rejectReasonKeyV = /* 场景封闭枚举，05/14 定值（含 provider 的 'cannot_deliver'） */;

// 条款与快照（canon D25；08 §8.3.1 相同）
export const termsV = v.object({
  itemKeys: v.array(v.string()),        // 字典序、去重、非空；只含 kind: item
  modifiers: v.array(v.string()),       // 字典序、去重；只含 kind: modifier（v1 至多 ["rush"]）
  deliveryDate: v.string(),             // IsoDate：localDate(插入日) + 有效工期，插入后不重算（D22）
  amountCents: v.number(),              // = Σ lines[].priceCents
});
export const lineV = v.object({         // 插入时的目录快照，item 与 modifier 各一行
  itemKey: v.string(), kind: v.union(v.literal("item"), v.literal("modifier")),
  revision: v.number(), title: v.string(), priceCents: v.number(), leadDays: v.number(),
});
export const plannedTaskV = v.object({  // 插入时由 taskTemplates 派生；执行时原样写入 tasks
  itemKey: v.string(), templateIndex: v.number(), title: v.string(),
  assigneeRole: roleV, dueDate: v.string(),
});
export const candidateV = v.object({    // turns.candidateSnapshot 的一项（canon D10）
  optionKey: v.string(),                // "O1".."O12"，按 candidateKey 字典序编号
  candidateKey: v.string(),             // canonical(itemKeys, modifiers)，如 "audit_log_export+sso_login@rush"
  itemKeys: v.array(v.string()), modifiers: v.array(v.string()),
  amountCents: v.number(), deliveryDate: v.string(),
});
export const agentActionV = v.union(v.literal("propose"), v.literal("counter"), v.literal("clarify"),
  v.literal("recommend_accept"), v.literal("reject"), v.literal("escalate"));
export const agentMoveV = v.union(      // 05 的 Zod AgentModelOutput 规范化后的存储镜像（null 字段已去除）
  v.object({ action: v.literal("propose"), optionKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("counter"), optionKey: v.string(), baseProposalVersion: v.number(), rationale: v.string() }),
  v.object({ action: v.literal("clarify"), toRole: roleV, topicKey: v.string(), rationale: v.string() }),
  v.object({ action: v.literal("recommend_accept"), proposalVersion: v.number(), rationale: v.string() }),
  v.object({ action: v.literal("reject"), proposalVersion: v.union(v.number(), v.null()),
             reasonKey: rejectReasonKeyV, rationale: v.string() }),
  v.object({ action: v.literal("escalate"), kind: v.union(v.literal("infeasible"), v.literal("needs_tradeoff")),
             toRole: roleV, rationale: v.string() }),
);
export const usageV = v.object({        // Anthropic usage 的整数字段；stub 全 0
  inputTokens: v.number(), cacheCreationInputTokens: v.number(), cacheReadInputTokens: v.number(),
  outputTokens: v.number(), thinkingTokens: v.number(),
});
export const testFaultV = v.union(      // rooms.testFaultPlan[].fault：10 §10.18.2 的封闭故障词表（拼错即写入失败，不会被静默忽略）
  v.literal("transport_error"), v.literal("rate_limit_429"), v.literal("server_500"), v.literal("overloaded_529"),
  v.literal("timeout_abort"), v.literal("bad_request_400"), v.literal("auth_401"), v.literal("billing"),
  v.literal("refusal"), v.literal("max_tokens"), v.literal("invalid_json"), v.literal("schema_violation"),
  v.literal("unknown_option"), v.literal("context_overflow"), v.literal("lost_action"), v.literal("commit_throw"),
);
```

- `agentMoveV` 与 05 的 `buildTurnZod(...)['turn']` 由 CI 做双向可赋值断言（05 §5.2）；字段命名以 05 为准，本章只做镜像。
- `candidateKey` 规范串：`itemKeys` 字典序以 `+` 连接，若有修饰项再接 `@` 与字典序修饰项（`+` 连接）；它是服务端身份，同一 run 内重复提出 `excludedCandidateKeys(run)`（本 run 已提出过——含被阻断、未插提案的——∪ 被人拒绝 ∪ `choose_candidate` 复核失败的键，canon D10）中的 candidateKey → `action.repeats_blocked`（canon D25）。
- `termsKey = canonicalJson(terms)`：键按字典序、无空白、数组保持 `termsV` 规定的字典序，例 `{"amountCents":90000,"deliveryDate":"2026-11-18","itemKeys":["audit_log_export","sso_login","usage_dashboard"],"modifiers":[]}`。它是规范 JSON 字符串而不是哈希（canon §1.2，v1 不依赖 `crypto.subtle`）。
