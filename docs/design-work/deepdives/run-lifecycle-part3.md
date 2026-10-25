# 专题深潜：run / turn 生命周期与调度（part 3/3）：反例、测试、接口、待验证

## 7. 反例与边界

| # | 场景 | 结果 | 保证它的机制 |
| --- | --- | --- | --- |
| E1 | 成员连点 Start 两次 / 两个成员同时 Start | 只有一个 run；第二次返回同一 runId（`created: false`） | startRun 读 `room.currentRunId` 并写 rooms；OCC 串行化 |
| E2 | Start 与 updateBudget 并发 | 两者都写 rooms，串行；若 Start 先：其 run 被 supersede；若 updateBudget 先：Start 看到它启动的活跃 run，直接返回 | rooms 文档上的 OCC |
| E3 | 看门狗判超时后原 action 返回 | 结果丢弃，用量照记 | G0 |
| E4 | 自动重试已调度（延迟 2s），成员又点 Retry | run 状态是 negotiating（自动重试时 run 未进入 failed），`retryTurn` 返回 `retried: 0` | retryTurn 只在 failed 时动作 |
| E5 | Retry 双击 | 第一次 run → negotiating；第二次 status 不是 failed → 返回 0 | 同上 |
| E6 | 两个并行 completeTurn 同时到达 | 恰好一个调用 `planAfterStep` 并推进 | 两者都读对方 turn 行、都写 `runs.updatedAt`；Convex 可串行化 OCC（待验证 V2） |
| E7 | stub run 进行中环境改为 live | 该 run 仍是 stub；新 run 才是 live | `run.agentMode` 快照 |
| E8 | 中途 `AGENTS_ENABLED=false` | 在途 live 回合 → failed(agents_disabled)，run failed；重新打开后 Retry | runTurn 二次检查；reserveCall 检查 |
| E9 | 模型输出 `parsed_output` 为空 / 只有 thinking 块 | `stop_reason` 为 `max_tokens` → invalid_output → 自动重试一次；绝不当作"无动作" | runTurn 先查 stop_reason（F10.12） |
| E10 | 模型回显错误的版本号或 roomId | 被忽略：输出 schema 里没有这些字段；信封来自 turn 快照 | F05.1 |
| E11 | completeTurn 因代码 bug 抛错 | action catch → failTurn(internal_error)（不再调模型）；若 failTurn 也抛错 → 看门狗 → 仍抛错则 run 卡在 negotiating，靠运维 `forceFailTurn`（internal，`npx convex run`）与 `by_status_and_deadlineAt` 告警查询发现 | 不在 action 内重复付费调用 |
| E12 | 拒绝后轮次用尽 | pending_approval → needs_input，05 生成取舍请求 | `resumeRun(rejected)` |
| E13 | 每 run 上限在一个 step 中途触发（例如 evaluate step 第二个 slot） | run → failed(call_cap_reached)；已调度的第一个 slot 继续，成功则持久化但不推进；之后只能 cancelRun + startRun | `beginStep` 返回错误而不抛出，failRun 不被回滚 |
| E14 | UTC 跨日 | 房间/全局日计数按 `createdAt` 的 UTC 日；前一日 failed(room_daily_cap) 的 run 次日可 Retry | `utcDay()` |
| E15 | 部署发生在回合进行中 | 等同 E3 / 6.2；运维规则仍是"有活跃回合时不部署"（15），看门狗只是兜底 | — |
| E16 | 被取代的 run 的延迟自动重试 attempt 到期 | 该 attempt 已被 `supersedeRun` 标 stale → `loadTurnContext` 返回 null → 不调模型 | D7 早退 |
| E17 | 客户端直接调用 runTurn | 不可能：internalAction | `scheduler.d.ts:23-24` 建议 |

反例（本设计**不**做的事）：
- 不在 action 内重试模型调用以"补救"持久化失败（会重复付费，F10.2）。
- 不在 action 里写任何业务表；action 的唯一写入口是 completeTurn / failTurn。
- 不把"迟到但内容正确"的结果补收进当前 step：一次 attempt 一旦终态就不再改变，简化推理。
- 不做 token 级流式（04 §4.9）。

## 8. 测试

### 8.1 convex-test（确定性，假时钟；API 名称待验证 V9）

1. 迁移表穷举：对 `RUN_TRANSITIONS`/`TURN_TRANSITIONS` 每个 (from, to) 断言 `assert*Transition` 结果；所有改 status 的函数都经过它（grep 检查 `status:` 写入点）。
2. 守卫：分别制造 G0–G3 不通过，调用 `completeTurn`，断言 turn 状态、`modelCalls.outcome = discarded_stale`、事件。
3. 看门狗：推进时钟越过 `WATCHDOG_DELAY_MS` 且不运行 action → turn failed(timeout) + 新 attempt(auto_retry)；第二次超时 → run failed。
4. 自动重试上限：schema_invalid → 自动重试一次 → 再 schema_invalid → run failed；user_retry 产生的 attempt 再得一次自动重试。
5. 上限：`maxCalls` 用尽、房间日上限、全局日上限分别触发，断言 reasonCode 与无新调度。
6. stub 端到端：seed → startRun → 提案 → pending_approval；再 updateBudget → 旧 run superseded、新 run 开始（16 的 stub 全流程用例）。
7. `TURN_BUDGET` 断言：改坏常量时模块加载抛错（单测直接 import）。

### 8.2 真实 dev 部署脚本（convex-test 不模拟并发，04 §1.12）

1. 并行 20 次 startRun（同一房间）→ 恰好 1 个 run。
2. 构造并行 evaluate step，stub 加可配置延迟使两个 completeTurn 同时到达，重复 50 次 → 每次 `nextTurnSeq` 只加 1、只有一次 `planAfterStep`。
3. startRun 与 updateBudget 并发 → 至多一个活跃 run。
4. live 冒烟：一次真实回合，断言 `modelCalls` 各字段非空、第二次同前缀 `cacheReadInputTokens > 0`。
5. 延迟实测：10 次 live 回合记 p50/p95，回填 `TURN_BUDGET.sdkTimeoutMs`（V4）。

## 9. 与其他专题的接口（任务书 §5 文件编号）

| 文件 | 本专题提供 | 本专题依赖 |
| --- | --- | --- |
| 03-schema | `runs`、`agentTurns`、`modelCalls`、`usageCounters` 的 validator 与索引；唯一性落点 | `rooms.currentRunId / constraintsVersion / currentProposalId / status`、`roleV` |
| 04-state-machines | run / turn 迁移表、`assertRunTransition`、触发者与守卫 | humanRequest、proposal 状态机（05/08） |
| 05-protocol | `beginStep / resumeRun / applyDecision` 的调用约定；信封来自 turn 快照 | `planFirstStep(ctx, run)`、`planAfterStep(ctx, run, latestTurns)` 返回 `step \| await_approval \| needs_input`；`persistTurnOutput`；`agentModelOutput`（Zod）及其 Convex 镜像 |
| 06-rules-engine | 在 completeTurn 内调用 | `validateAgentOutput → { ok, normalized } \| { ok:false, reasonCode }`；`assertRoomReadyForRun`；stub 用的可行组合枚举 |
| 07-permissions-privacy | `loadTurnContext` 只返回本方可见上下文；`modelCalls`/`agentTurns.output` 只对本方与运维可见 | `requireRoomMember`；`assembleTurnContext(role)` |
| 08-approval-execution | pending_approval 由本专题进入；`resumeRun(rejected)` | 执行 mutation 负责 pending_approval → confirmed（用审批/执行守卫） |
| 09-constraint-changes | `supersedeRun(ctx, room)`、`startRunInternal(trigger: constraint_change)` | bumpConstraints 在同一事务里按顺序调用二者 |
| 10-agent-runtime | 本专题是其生命周期、调度、重试/超时、上限、stub、用量部分 | 模型选择、effort、prompt 组装、缓存规范 |
| 11-architecture | 文件布局：`convex/agentRuntime/{budget,lifecycle,usage,prompt,stub}.ts`、`convex/agentRuntime.ts`（mutations）、`convex/agentRuntimeAction.ts`（action） | — |
| 12-api | `startRun`、`retryTurn`、`cancelRun`（public）；`completeTurn`、`failTurn`、`turnWatchdog`、`loadTurnContext`、`runTurn`、`forceFailTurn`（internal） | — |
| 13-frontend | 回合级状态（"Provider agent drafting…"、failed + Retry、Simulated 标签）由订阅 runs/agentTurns 的裁剪 query 提供 | — |
| 15-operations | 环境变量 `AGENT_MODE`、`AGENTS_ENABLED`、`ANTHROPIC_API_KEY`；上限常量；卡住 run 查询；部署纪律 | — |
| 16-testing | §8 用例 | — |
| 18-decisions | ADR：编排路线（D1/D1a）、重试分层（D3）、上限落点（D4）、总开关语义（D5）、用量表（D6）、不用 cancel（D7） | — |

## 10. 待验证清单

| # | 事项 | 依赖它的决定 | 验证方式 |
| --- | --- | --- | --- |
| V1 | Convex action 最长运行时间（假设 10 分钟）；`ACTION_WALL_MAX_MS` 断言基于它 | D3、看门狗期限 | limits 文档；最小实验 |
| V2 | 两个并发 mutation 互读对方写入的文档时，Convex 保证可串行化（一个重试） | E6、并行 step 恰好推进一次 | §8.2 第 2 项 |
| V3 | mutation 内可读 `process.env`（及 1.48 类型化 `env` 的用法） | D5 在 startRun/reserveCall 读开关 | 最小实验；否则把开关存成 `settings` 表一行，由运维 mutation 修改 |
| V4 | Opus 5.5 回合 p95（medium effort） | `sdkTimeoutMs`、`WATCHDOG_DELAY_MS` | §8.2 第 5 项 |
| V5 | `ctx.db.system.get("_scheduled_functions", id)` 在 mutation 中可用，且 action 被平台中断后 `state.kind` 为 `failed`（而不是停在 `inProgress`） | timeout vs action_crashed 区分（仅影响 errorCode，不影响恢复） | 部署中途打断实验 |
| V6 | `v.id("_scheduled_functions")` 能否用于应用表字段；v1 用 `v.string()` 存并强转，回避该问题 | `dispatchRef` | 推一次 schema |
| V7 | SDK `create(params, { signal })` 中 AbortSignal 触发时抛出的错误类型（归为 `api_error`） | classifySdkError | 小实验 |
| V8 | 被 SDK 内部重试的失败 HTTP 尝试是否计费 | 成本解释 | 定价文档 |
| V9 | convex-test 0.0.65 的假时钟/调度推进 API 名称 | §8.1 | 安装后读类型 |
| V10 | workpool `onComplete` 是否在平台中断 attempt 时也被调用（决定切换后能否删看门狗） | D1a | 读组件源码 |
| V11 | 在 action 中被调度的函数是否随 action 失败撤销（本设计不在 action 中调度，若 V11 为"撤销"也不受影响） | 无（记录在案） | — |
| V12 | `scheduler.cancel` 对已取消/已完成函数的行为（文档写"已完成会抛错"）——本设计不调用 cancel | D7 | — |
