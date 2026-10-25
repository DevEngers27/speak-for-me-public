# 反驳评审：run / turn 生命周期与调度（part 2/2）

## 1. 问题清单（续）

### r08 [low] stop_reason 映射：`model_context_window_exceeded` 等被当成 schema_invalid 自动重试

- `SDK:resources/messages/messages.d.ts:3870`：`StopReason = end_turn | max_tokens | stop_sequence | tool_use | pause_turn | refusal | model_context_window_exceeded`。`runTurn` 把非 `end_turn` 的情况一律归为 `schema_invalid`，而它可以自动重试。上下文溢出时用同样的上下文重试必然再次溢出；`tool_use`/`pause_turn` 在没有工具的请求里出现意味着请求构造有错。
- **修正**：新增 `context_overflow`（failed，不可自动重试，提示运维检查 07 的上下文裁剪）；`tool_use`/`pause_turn`/`stop_sequence` 归为 `bad_request` 类（编程错误）。

### r09 [medium] 隐私：06 的 reasonCode 计划写进房间事件，可见性没有定义

- `mutations.ts` 的 `handleTurnFailure` 注释说"reasonCode (06) goes into the turn_failed event payload"（代码里实际被 `void reasonCode` 丢掉了，注释和代码不一致）。规则拒绝的 reasonCode 可能编码了**他方**的私密约束，例如提案超出 finance 的预算上限。如果 `turn_failed` 事件对房间所有成员可见，就违反核心 §3.1"对他方可见的内容必须经过显式披露决定"。
- **修正**：reasonCode 只写在 `agentTurns.errorDetail`（仅本方与运维可见，与 `output` 同级）和运维日志里；房间事件只带通用的 `errorCode`。在 07 的事件可见性矩阵里补上 `turn_failed`、`turn_rejected_stale`、`run_started` 三行。

### r10 [low] 用量字段：`usage.iterations` 只在 beta 类型中；`output_tokens_details` 不需要强转

- 稳定版 `Usage`（`messages.d.ts:4440-4485`）没有 `iterations`；它只出现在 `resources/beta/messages/messages.d.ts:4575`（`BetaUsage.iterations`）。设计用的是 `client.messages.create`（稳定版），所以 `fallbackIterations` 永远取不到值。`output_tokens_details: OutputTokensDetails | null` 已经在稳定版类型里（`messages.d.ts:4473`），`(u as any)` 没有必要。
- **修正**：v1 删掉 `fallbackIterations`。如果要用服务端回退，就明确改用 `client.beta.messages.create`，并在 10 中记录这个决定。去掉 `as any`。

### r11 [low] 事件链有缺口（核心 §3.6"可从事件追溯"）

- `retryTurn`（成员把 run 从 failed 拉回 negotiating）不写事件；`maybeAdvance` 推进 step 或换 round 不写事件；`startRunInternal` 的 `run_started` 没有 `actorUserId`；`retryTurn` 还会把 `endedReason` 清成 undefined，抹掉了"上次为什么失败"的直接线索（事件里还有，但前提是事件确实写了）。
- **修正**：增加 `run_retried{actorUserId, roles}`、`step_started{turnSeq, roles, stepKind, round}` 事件；`run_started` 带上 `actorUserId`；`endedReason` 只在终态时写，failed 的原因放进 `lastFailure: v.optional(v.object({ code, at }))`，不在 retry 时清掉。

### r12 [low] 过度设计：全局日计数文档是跨房间热点，与平台花费上限重复

- 每次创建 live 尝试都要写 `usageCounters` 的同一行，使所有房间的 `completeTurn → beginStep` 在 OCC 上互相冲突。它保护的是 Anthropic 控制台的 workspace 花费上限本来就保护的东西（D4 表最后一行）。v1 规模是个位数房间，用不上这一层。
- `runs.updatedAt` 的显式 patch 被说成"强制 OCC 串行化"，但 `maybeAdvance` 读了整个 step 的索引区间，已经把对方的回合行纳入读集，所以这次 patch 是冗余的。它无害，但文档不应把正确性只押在它上面。
- **修正**：v1 只保留每 run 上限 + 每房间日上限 + 控制台花费上限；`usageCounters` 推迟到 D1a 的"并发上来"触发条件出现时再加。文档把 E6 的论证改为"互读对方回合行 + 同写 run 行"双重保证。

### r13 [low] `startRunInternal` 用调用方传入的内存中 room 快照来取约束版本

- `constraintsVersionAtStart: a.room.constraintsVersion` 用的是参数里的 room 对象。如果 09 先读 room、再 patch 递增版本、然后把旧对象传进来，新 run 就带着旧版本出生 → 每个回合都过不了 G3 → 落入 r01 的卡死路径。
- **修正**：参数改为 `roomId`，在函数内重新 `ctx.db.get`；或者显式传入 `constraintsVersion`，并断言它等于当前 `room.constraintsVersion`。

### r14 [low] `ERROR_POLICY` 与 `turnErrorCodeV` 没有编译期一致性检查

- 状态枚举有 `_RunEq`/`_TurnEq` 双向检查，错误码两处列表（validator 和策略表）却没有。新增 errorCode（r01、r05、r08 都要加）时容易漂移。
- **修正**：照搬同样的 `[A] extends [B]` 双向检查，或者从 `ERROR_POLICY` 的 key 生成 validator。

### r15 [low] 语义失败后的自动重试用的是完全相同的上下文

- `rules_rejected`/`schema_invalid` 自动重试时，attempt#2 的上下文与 #1 一样，模型很可能犯同样的错，白花一次调用。
- **修正**：把上一次尝试的 `errorCode` 和**本方可见**的规则 reasonCode 作为一条服务端 `role: "system"` 中途消息（04 要点 19）放进下一次尝试的上下文；或者对 `rules_rejected` 不做自动重试。由 05/10 决定，本专题提供 `previousAttempt` 字段。

## 2. 作者列出的 15 条待验证声明：逐条核对

| # | 声明 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | 被调度的 mutation 恰好一次、自动重试；action 至多一次、不重试 | **真** | `CVXT:server/scheduler.d.ts:17-21` |
| 2 | mutation 内 `runAfter(0)` 在提交后才到期；回滚则调度不存在 | **前半句真**；后半句是合理推论，本地源码没有直接写 | `scheduler.d.ts:64`（"after this mutation commits"）、`:74-76`（"after the scheduling one completes"）；`CVX:server/registration.ts:114` 只写 "after this mutation commits"。待验证的子问题：1.48 中 mutation 内 `ctx.runMutation` 子事务抛错时，其中登记的调度是否一并回滚（本设计没用到） |
| 3 | cancel 语义（未开始不运行 / 在途继续但新调度被取消 / 已完成抛错 / mutation 原子） | **真** | `scheduler.d.ts:113-122` |
| 4 | `_scheduled_functions.state.kind` 的取值；可用 `ctx.db.system.get` | **取值与读取方式为真**；"平台中断后变为 failed"仍待验证 | `CVXT:server/schema.d.ts:586-600`；`database.d.ts:111-128`（`system: BaseDatabaseReader<SystemDataModel>`，同时提供 `normalizeId`，见 r07） |
| 5 | 并发 completeTurn 由可串行化 OCC 保证只推进一次 | **很可能真，本地无法证明**；即使没有 `updatedAt` 也成立（r12） | 04 §1.3 只引用组件 README 的 OCC 重试描述；仍需 §8.2 的真实部署测试 |
| 6 | mutation 内可读 `process.env` | **基本确认** | `CVX:cli/codegen_templates/server.ts:57-70`：`_generated/server` 在模块顶层导出 `env = globalThis.process.env`，而这个模块也导出 `mutation/query`，并在默认运行时加载；1.48 的类型化 `env` 需要在 `convex.config.ts` 中声明（语法待验证，04 #16） |
| 7 | action 上限约 10 分钟；断言 `ACTION_WALL_MAX_MS` 小于其 50% | **算术为真**（113s×2 = 226s < 600s）；10 分钟本身待验证；`ACTION_WALL_MAX_MS` 的公式前提有误（r05） | `budget.ts` |
| 8 | SDK 逐请求覆盖；重试类别；8s 上限；错误类；`_request_id` 不可枚举 | **大部分为真，"8s 上限"为假** | 覆盖：`resources/messages/messages.js:31`（timeout）、`client.js:893`（maxRetries）、`:896`（signal）；重试：`client.js:848-866`（408/409/429/≥500、`x-should-retry` 优先）、`:641-668`（连接错误与超时）；错误类：`core/error.js:11-132`、`client.js:1036-1049`；`_request_id`：`internal/parse.js:61`；`retry-after` 不受上限：`client.js:868-896` |
| 9 | 非流式 `max_tokens` 大于约 21,333 时 SDK 拒绝 | **条件性为真**：只在没有设置任何 timeout 时检查；设计设置了 timeout，所以不适用（r06） | `messages.js:31-35`；`client.js:909-917` |
| 10 | usage 各字段存在且语义如述 | **真** | `messages.d.ts:4440-4485`；"总输入 = 三者之和"：`:3574-3575`；`thinking_tokens ≤ output_tokens`：`:3655-3666`；但 `iterations` 只在 beta 类型中（r10） |
| 11 | stop_reason 枚举含 refusal；refusal 是 HTTP 200 | **枚举为真**；HTTP 200 与 content 可能为空来自 04 引用的技能文档，本地类型无法证明 | `messages.d.ts:3870` |
| 12 | `v.id("_scheduled_functions")` 能否作为应用表字段 | **类型层面允许**；运行时推 schema 是否接受仍待验证；无论结果如何，`normalizeId` 都让强转不再必要 | `CVXT:values/validator.d.ts:103`（`id<TableName extends string>`）；`database.d.ts:43-54` |
| 13 | convex-test 不模拟并发/OCC；假时钟 API 名称 | **待验证**（两个仓库都没有安装 convex-test，04 §1.12 是一般认知） | — |
| 14 | workpool `onComplete` 在平台中断时是否被调用 | **待验证**（没有安装；04 part3：README 写 "always be called"，严格语义未确认） | — |
| 15 | p95 未实测；45s/130s 是占位值 | 占位属实；但两个占位值之间已经能看出矛盾（r05） | `budget.ts` |

附带回答作者的 V7：AbortSignal 触发时抛出 `APIUserAbortError`（`SDK:client.js:622-635`），它继承 `APIError`，`status` 为 undefined，按现有代码会被归为 `api_error`。建议改为 `model_timeout`（r05）。

## 3. 核实为成立、无需改动的设计点

- D7 不调用 cancel：与 `scheduler.d.ts:113-122` 一致。早退 query 加 G0 已经足够。
- 每次尝试一行、只追加：满足核心 §3.6，也让每次计费调用都有自己的行。
- E1/E2 由 rooms 文档上的 OCC 串行化：两个事务都读并写 `rooms`，后提交者重试时会看到前者的写入。论证成立（仍建议做 §8.2 的真实部署测试）。
- `messages.create` + 先查 `stop_reason` + 自行 `safeParse`，而不是 `messages.parse()`：与 04 要点 17 一致。
- 拒绝 workflow 与 agent 组件的理由成立（04 part3）。workpool 的切换接缝定义清楚。
