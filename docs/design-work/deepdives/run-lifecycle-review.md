# 反驳评审：run / turn 生命周期与调度（part 1/2）

> 评审对象：`run-lifecycle.md`、`run-lifecycle-part2.md`、`run-lifecycle-part3.md`、`run-lifecycle/*.ts`。
> 对照：任务书 §3 核心、inputs/04、`/Users/zhennn/cal-hack-2026-main/node_modules` 中 convex 1.48.0 与 @anthropic-ai/sdk 1.1.0 的真实类型与源码，以及 `negotiation-protocol/`、`versioned-approvals/` 专题草图。
> 分片：本文件（结论 + r01–r07）→ `run-lifecycle-review-part2.md`（r08–r15 + 15 条待验证声明逐条核对）。
> 引用缩写：`CVXT:` = `node_modules/convex/dist/esm-types/`；`CVX:` = `node_modules/convex/src/`；`SDK:` = `node_modules/@anthropic-ai/sdk/`。

## 0. 结论

骨架是对的：mutation 写状态 + 同事务调度、看门狗兜底、每次尝试一行且只追加、按错误类别只让一层负责重试、不调 `scheduler.cancel`，这几条和平台语义一致，也比引入 workflow 组件简单。问题集中在三处：

1. **"守卫不通过只把回合标 stale"会让 run 永久卡住**（r01），而 `versioned-approvals` 的"约束变了但提案仍可行时保留 pending_approval"恰好会触发它。
2. **step 是否完成由"已存在的尝试行"判断，而不是由"计划的角色集合"判断**（r02）。调用上限在 step 中途触发时会出现部分 step，导致一个已 failed 的 run 被推进，或一份合法、已付费的结果被标成 internal_error。
3. **与 negotiation-protocol、versioned-approvals 的字段和函数签名直接冲突**（r03、r04）：`turnSeq` 的语义、`turnKind`/`stepKind`、`agentMode` 的取值、round 从 0 还是 1 起、守卫集合、`supersedeRun` 签名、trigger 字面量，以及"尽力 cancel"与 D7 相悖。

SDK 预算的推导前提有两处与源码不符（r05、r06）：`retry-after` 不受 8s 上限约束；21,333 的保护在显式设置 timeout 时根本不会触发。此外，45s 的单次超时与 8000 的 `max_tokens`（含思考）很可能互相矛盾。

## 1. 问题清单（part 1）

### r01 [high] 守卫 G3（以及 loadTurnContext 早退）只把回合标 stale，run 卡在 negotiating；与 versioned-approvals D6 组合后必然发生

- **反例（逐步）**：
  1. run 处于 pending_approval，提案 P 绑定约束版本 k。finance 下调预算，`bumpConstraints` 把版本递增到 k+1。按 `versioned-approvals/constraints.ts:134-139`，P 在新约束下仍可行，于是返回 `kept_pending_approval`，**不取代 run**，`run.constraintsVersionAtStart` 仍是 k。
  2. customer 拒绝 → 08 调 `resumeRun(rejected)` → `planFirstStep` → `beginStep` → `createAttempt` 写入 `constraintsVersion: run.constraintsVersionAtStart`（k）。
  3. `runTurn` 调 `loadTurnContext`：G3 不通过（`room.constraintsVersion = k+1`），返回 null，action 直接退出，不写任何东西。回合保持 running，UI 显示 "drafting…" 130 秒。
  4. 看门狗运行 → `checkPersistGuards` 的 G3 仍不通过 → `discardStale` 把回合标 stale。**run 没有任何迁移**：仍是 negotiating，没有在途回合，不会再被推进。`retryTurn` 只在 failed 时动作，`startRun` 看到活跃 run 直接返回它。房间被锁死，只能 cancel。
- **根因**：D2 把 G3 定为"纵深防御、正常路径不会触发"，但另一专题的正常路径就会让它触发；而且 stale 分支对 run 没有任何处置。
- **修正**：
  1. 在 `discardStale` 中，G3 不通过时同事务执行 `failRun(ctx, runId, "constraints_drift")`（新增 errorCode，不可自动重试），并写 ops 告警事件。这样"纵深防御"命中时至少可见、可恢复。
  2. 与 09 二选一定稿：(a) 约束版本每次递增都 `supersedeRun`（最简单，G3 才真正只是纵深防御）；(b) 若保留 D6 的 kept_pending_approval，就把字段改名为可变的 `runs.constraintsVersion`（语义：本 run 当前绑定的约束版本），由 09 在 keep 分支同事务更新它并写事件；`createAttempt` 从它取快照。
  3. `runTurn` 在 `loadTurnContext` 返回 null 且回合仍是 running 时，调一个轻量的 `markTurnStale` mutation（内部复用 `discardStale`），不要让回合空挂到看门狗。
- **证据**：`run-lifecycle/mutations.ts` 的 `discardStale` 只 patch turn；`lifecycle.ts` 的 `resumeRun` 不更新 `constraintsVersionAtStart`；`versioned-approvals/constraints.ts:134-139`。

### r02 [high] maybeAdvance 用"已存在的最新尝试"判断 step 完成；部分 step 会推进已 failed 的 run

- **反例（E13 的实际走向）**：evaluate step 计划角色是 [customer, finance]。`beginStep` 为 customer 建了 attempt 并调度；为 finance 建 attempt 时 `reserveCall` 返回 `call_cap_reached` → `failRun`（run → failed）。注意 `beginStep` 注释里写的"已调度的 slot 标 stale"在代码中**并没有实现**。customer#1 随后成功，G1 允许 failed，于是持久化。`maybeAdvance` 调 `latestAttemptsOfStep`，结果只有 customer 一行，`some(status !== "succeeded")` 为 false，于是**推进**：
  - 若 `planAfterStep` 返回 `step`：`maybeAdvance` 直接 patch `status: "negotiating"`，**绕过 `assertRunTransition`**，把 failed 的 run 拉回 negotiating，再 `beginStep` 时又撞上限 → failed。状态抖动，还多出一个事件。
  - 若返回 `await_approval`：`applyDecision` 做 failed → pending_approval，这条迁移不在 `RUN_TRANSITIONS` 中，于是抛错 → `completeTurn` 整体回滚 → action 的 catch 调 `failTurn(internal_error)` → 一份合法、已付费的结果被标成 failed。
  - 只基于一个评估者的意见就进入 pending_approval（如果迁移表放行），违反"step 内每个 slot 都 succeeded"的守卫。
- **连带问题**：房间日上限、全局日上限在 `beginStep` 中途触发时，缺失的 slot 没有任何行。`retryTurn` 只重试已有行中 failed/invalid 的 slot，于是 `toRetry` 为空、返回 0，这与 E14 写的"次日可 Retry"矛盾。
- **修正**：
  1. 在 run 上存计划：`currentStep: v.object({ turnSeq: v.number(), roles: v.array(roleV), stepKind, base: v.optional(...) })`，由 `beginStep` 写入。
  2. `beginStep` 先整体预检：`callCount + roles.length <= maxCalls`，日上限也按 `roles.length` 预留。一个 step 要么全部创建，要么一个都不创建（不建行就 `failRun`）。
  3. `maybeAdvance` 的前置条件：`run.status === "negotiating"`，并且 `currentStep.roles` 中**每个角色**的最新尝试都是 succeeded。
  4. `retryTurn` 遍历 `currentStep.roles`：没有行，或最新行是 failed/invalid_output/stale 的，都建新尝试。
  5. 所有 `status` 写入都经过 `assertRunTransition`，包括 `maybeAdvance` 里那一处。
- **证据**：`mutations.ts` 的 `maybeAdvance`、`latestAttemptsOfStep`、`retryTurn`；`lifecycle.ts` 的 `beginStep`；`state.ts` 中 `RUN_TRANSITIONS.failed = ["negotiating","superseded","cancelled"]`。

### r03 [high] 与 negotiation-protocol、versioned-approvals 的命名、语义、签名冲突

| 概念 | run-lifecycle | 冲突方 | 冲突点 |
| --- | --- | --- | --- |
| `turnSeq` | 同一 step 的并行回合**共享** | `negotiation-protocol/envelope.ts:12`："two evaluate turns get two seqs" | G2 `run.nextTurnSeq === turn.turnSeq` 在对方语义下必然拒收第二个评估回合 |
| 回合类型 | `stepKind: propose \| evaluate` | `turnKindV: draft \| evaluate \| revise` | 名字和取值都不同 |
| `agentMode` | `live \| stub` | `agentModeV: live \| stub \| replay` | replay（录制结果）同样需要 §3.8 标注，本专题的 stub/live 分支没有处理它 |
| round | 0 起（`schema.ts` 注释 "0-based"） | 1..maxRounds | `resumeRun` 中的 `round + 1 >= maxRounds` 与对方的边界差一 |
| 持久化守卫 | G0–G3；G1 允许 failed | `persistenceGuard`：要求 `run.status === "negotiating"`、尝试号匹配（同一行改 attempt）、`STALE_ROUND`、`STALE_PROPOSAL` | 两套守卫，`completeTurn` 只能用一套；"每次尝试一行"与"同一行 attempt 匹配"是两种模型 |
| 取代 | `supersedeRun(ctx, room)` | `supersedeRun(ctx, runId, "constraints_changed")`，注释写"尽力 cancel 已调度 action" | 签名不同；"尽力 cancel"与 D7（不调用 cancel）相悖 |
| 起 run | `startRunInternal(ctx, { room, trigger, startedBy, previousRunId, scenario })` | `startRun(ctx, { roomId, trigger, constraintsVersionAtStart })` + `scheduleFirstTurn` + `moveToNeedsInput` | 函数名、参数、职责切分都不同 |
| trigger 字面量 | `constraint_change` | `constraints_change` | 拼写不同 |

- **修正**：由本专题（10-agent-runtime）作为 `runs`/`agentTurns` schema 和持久化守卫的唯一所有者，导出 `turnEnvelopeV`、`checkPersistGuards`、`supersedeRun(ctx, runId, reason)`、`startRunInternal(ctx, { roomId, trigger, startedBy, previousRunId })`，05 和 09 只 import。在 18-decisions 中记一条 ADR，定稿"共享 turnSeq + 每次尝试一行 + 0 起 round"，或者采纳对方的方案。`STALE_PROPOSAL` 很有价值（评估回合基于的提案已被替换），建议吸收为 G4，而不是丢掉。
- **证据**：见表中各文件位置。

### r04 [medium] G1 允许 failed，却没约束 `persistTurnOutput` 的副作用

- **反例**：evaluate step 中 customer 拒答（refusal），run → failed。finance 的评估回合随后成功，G1 放行，`persistTurnOutput` 可能**追加一份反提案**并更新 `room.currentProposalId`（05 的职责）。之后成员 Retry customer，customer#2 的 `baseProposalId` 取自旧回合行，已经不是当前提案。按 negotiation-protocol 的 `STALE_PROPOSAL` 它会被拒；按本专题它会被接受，却是在评估一份过期的提案。
- **修正**（二选一，写进 ADR）：(a) G1 只接受 negotiating，迟到的成功只记用量；`retryTurn` 把最新行为 stale 的角色也纳入重试（多一次调用，但语义简单，与 05 一致）。(b) 保留 G1 允许 failed，但在 failed run 中只保存 `turn.output`、不调 `persistTurnOutput`，把提案追加推迟到 step 关闭时由 `maybeAdvance` 统一执行。建议选 (a)。

### r05 [medium] SDK 时间预算：`retry-after` 不受 8s 上限；超时计时器只覆盖 fetch；45s 与 8000 tokens 可能矛盾

- **源码事实**：
  - `SDK:client.js:868-896`：有 `retry-after-ms` 或 `retry-after` 时**按服务端给的值等待**，只要大于 0 且不超过 2^31-1 ms。8s 上限（`client.js:899-904`）只用于没有该头的默认退避。429 一般带 `retry-after`。
  - `SDK:client.js:779-786`：`timeout` 计时器只包住底层 `fetch`，响应头到达后就清除。body 读取只受 `signal` 约束（`armAbandonmentBackstop` 另说）。非流式响应的头部是否在生成完成后才到达：待验证（通常如此，所以 timeout 实际约等于整段生成时间）。
  - `SDK:client.js:622-635`：signal 触发后抛 `APIUserAbortError`（继承 `APIError`，`status` 为 undefined）。`sleep(timeoutMillis, options.signal)`（`client.js:896`）能被 signal 打断。
- **含义**：`ACTION_WALL_MAX_MS` 的公式在有 `retry-after` 时不成立。真正的上界是 `AbortSignal.timeout(MODEL_CALL_ABORT_MS)`，这一点设计碰巧做对了，但文档把功劳记在了"退避上限 8s"上。另外，Opus 5.5 在 medium effort 下，`max_tokens` 8000（含思考）的完整生成很可能超过 45s。一旦超时，SDK 会以同样的 prompt 重试一次（同样很可能超时；被中断的请求是否计费见 V8）→ `api_error`，不可自动重试 → run failed。这是**系统性**失败，不是偶发失败。
- **修正**：
  1. 在 `budget.ts` 中加 `MIN_OUTPUT_TOKENS_PER_SEC`（实测后回填）和断言 `sdkTimeoutMs >= TTFT_MS + turnMaxTokens / MIN_OUTPUT_TOKENS_PER_SEC * 1000`，或者把 `turnMaxTokens` 降到与 45s 相容。
  2. 文档明确写"墙钟上界由 AbortSignal 保证；SDK 退避遵从 retry-after"，并删掉 `sdkMaxBackoffMs` 在公式中的"上限"含义（保留为默认退避的估计）。
  3. `classifySdkError` 增加 `APIUserAbortError`、`APIConnectionTimeoutError` → 新 errorCode `model_timeout`（不可自动重试，但与 `api_error` 分开统计）。
  4. 待验证：Convex 默认运行时是否提供 `AbortSignal.timeout`。退路是 `new AbortController()` + `setTimeout(() => c.abort(), ms)`。
  5. 可选：服务端用 `messages.stream(...).finalMessage()`（不向 UI 流式），让长生成不依赖单个空闲 HTTP 连接。是否值得，等 V4 实测后决定。

### r06 [low] 21,333 的保护在设计配置下根本不会触发

- `SDK:resources/messages/messages.js:31-35`：`let timeout = options?.timeout ?? this._client._options.timeout; if (!body.stream && timeout == null) { ... calculateNonstreamingTimeout(...) }`。只有**完全没有设置 timeout** 时才检查。设计在 client 和逐请求上都设置了 timeout，所以保护不会执行。`internal/constants.js:8-12` 的 `MODEL_NONSTREAMING_TOKENS` 也没有 opus-5-5 的条目。
- **修正**：断言可以保留（无害），但把理由改为"保持在非流式的合理范围内"。真正的约束是 r05 的超时与生成时长关系。

### r07 [medium] 看门狗的计时从调度时刻开始，不是从 action 开始；在途时提前判超时会导致双付费

- **反例**：部署的 action 并发配额或调度积压（具体数值待验证）让 `runTurn` 晚了 60s 才开始，此时它还在跑。看门狗在调度后 130s 到期，回合仍是 running → `timeout` → 自动重试 attempt#2 → 同一个 slot 同时有两次付费调用；#1 返回后被 G0 丢弃。
- **修正**：设计已经读了 `_scheduled_functions`，应该用它决定动作，而不只是决定 errorCode。
  - `pending`：action 还没开始，重新安排看门狗（`runAfter(WATCHDOG_DELAY_MS)`），设置次数上限。
  - `inProgress`：仍在跑，重新安排到 `assumedActionLimitMs + watchdogSlackMs` 的硬上限为止。
  - `failed`：`action_crashed`。
  - `success` 而回合仍是 running：action 结束了却没有提交（例如 failTurn 也抛了错），记 `internal_error`。
  - `canceled`：不会出现（D7）。
  - 用 `ctx.db.system.normalizeId("_scheduled_functions", turn.dispatchRef)`（`CVXT:server/database.d.ts:43-54`，system reader 是 `BaseDatabaseReader<SystemDataModel>`，`database.d.ts:128`）替代 `as any`，它会校验格式并返回带类型的 Id 或 null。
  - 重新安排需要在 `agentTurns` 上增加 `watchdogArmCount: v.number()`，并让 `deadlineAt` 随之更新，以便 `by_status_and_deadlineAt` 的告警保持准确。
