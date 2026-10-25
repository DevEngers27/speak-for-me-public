# 10 · 代理运行时（part7：不变量与测试、待验证、开放问题、与 canon 的对照）

> 分片清单见 `10-agent-runtime.md` 开头。

## 10.21 不变量与测试

RT1–RT12 见 §10.2。测试分工以 16 为准（L1 convex-test 串行逻辑；L2 真实 dev 部署验证并发、OCC 与平台限额），本章要求的用例：

**纯函数（vitest，node）**

- `budget.ts`：I1–I6 在默认值下成立；把 `assumedMinOutputTps` 改成 25、`sdkMaxRetries` 改成 1、或 `gatewayTransportRetries` 改成 2 时模块加载抛错。
- 网关重试（`callNegotiationModel` 注入假 transport 与假时钟）：429 与连接错误恰重发 1 次、`retry-after` 被遵从但不超过 8 s；408 / 409 / 5xx / 529 只发 1 次；`max_tokens` 在同一次调用内重发 1 次，第二次截断返回 `retryable: false` 且 usage 为两次之和；总截止分别在发送前、退避等待中、发送中到期，三处都返回不可重试的 `model_timeout` 且之后不再发请求；SDK `maxRetries` 非零时构造即抛 `GatewayConfigError`。
- `decideRetry`：§10.10.2 每一行；`auto_retry` 的 attempt 永不再重试；延迟抖动在 `[0.8, 1.2] × base`。
- `classifyError`：对每个 SDK 异常类构造实例断言映射；`err.message` 不出现在返回值中。`classifyResponse`：手写 Message 夹具覆盖每个 `stop_reason`、无 text 块、多个 text 块、thinking 在前，断言 usage 在所有分支都被返回。
- `assertWhitelisted`：逐一注入 `thinking`、`temperature`、`tools`、`tool_choice`、assistant 预填、第二条 system、5 个 cache 断点、错误模型名、`effort: 'low'`，全部抛错；RQ-01 用真实 SDK 客户端 + 假 fetch 断言请求体顶层键与 `authorization` 脱敏。
- `ATTEMPT_ERROR_CODES` 与 `attemptErrorCodeV`、`ERROR → retry` 表三者编译期双向对账（run-lifecycle-review r14）。

**convex-test（edge-runtime、假时钟、逐个推进到期任务；模块 glob 用 `['./**/*.*s', '!./**/*.*.*s']`）**

| 编号 | 用例 |
| --- | --- |
| RT-01 | 分别制造 G0、G1、G2、G3 不成立，调用 `turns.complete` / `turns.fail` / 看门狗：G1–G3 → attempt `stale`、`turn_rejected_stale` 事件、reconcile 被调用恰一次；G2 / G3 且回合非终态 → 回合 `stale`；G0 → 无事件、迟到 usage 只补写一次 |
| RT-08b | 只有回合快照 cv 漂移、run cv 与房间一致：G3 → 回合 `stale` → reconcile → `replaceTurnTx` 建出替代回合；断言无递归、run 不停在 `negotiating`、无 attempt 留在 `running` |
| RT-02 | 看门狗：`pending` → 重登记且 `watchdogArmCount ≤ 3`；`failed` → `action_crashed` → 自动重试；`success` 而 attempt 仍 running → `internal`；重登记用尽 → `watchdog_timeout`；最终判定时 action 仍 `pending` 或刚进入 `inProgress`、`physicalLeaseUntil` 晚于判定后 2 s 时，`auto_retry` 的 `beginFnId` 登记在租约到期时刻，推进时钟到租约到期前不建新 attempt、驱动未被调用（租约内不开 `auto_retry`） |
| RT-03 | `loadTurnContext` 返回 null → `stale_context`，驱动从未被调用（spy） |
| RT-04 | 重试表逐行；每条链至多 2 个 attempt；`retry_turn` 开新回合（新 `turnSeq`） |
| RT-05 | attempt 上限 → `rounds_exhausted(call_limit)`；美元上限 → `spend_limit`；全局日上限 → `deferred`、不抛错、次日自动恢复 |
| RT-06 | 排空：live 回合停泊、stub 不受影响；公开 `runs.start` → `run.draining`；bump 照常建 run 且首回合停泊；解除排空后恢复 |
| RT-07 | `AGENTS_ENABLED=false` → `agents_disabled` → `agent_failed`；stub 不受影响 |
| RT-08 | reconcile：cv 漂移 → supersede 并重开；当前 cv 下的 stale 回合 → 补开替代回合；`failed` 回合 → 幂等地恰好一个 `agent_failed` 请求；无延迟调度的 `scheduled` 回合 → `beginAttempt` |
| RT-09 | `commit_throw` → `turns.fail(internal)` 带 usage、不重试；双重失败 → 看门狗 `internal` |
| RT-10 | 每个分支都把 usage 写进 attempt：`completed`、`invalid_output`、`refused`、无响应的 `timeout`、带 usage 的 `stale`、迟到结果 |
| RT-11 | stub 走查（05 §5.15.1）：7 个 attempt、`provenance: 'stub'`、不预留美元 |
| RT-12 | 美元结算：整数微美元；跨 UTC 午夜的 attempt 结算回 `reservedDay` 行 |
| RT-13 | `SYSTEM_START_DELAY_MS` 内连续两次 bump：第一个新 run 的 attempt 不调用驱动 |
| RT-14 | 房间 24 h 内第 7 个由 `react()` 开局的 run：首回合 `waitingReason: 'run_cap'`、`beginFnId` pending，`runs.reconcile` 与巡检均为 noop、驱动未被调用；推进时钟到窗口滑出后自动派发（B6a） |
| RT-15 | 人为让 reconcile 在链已用尽（`currentAttemptNo = 2`）的 running 回合上重派：B4a → 回合 `failed`、失败方恰好一个 `agent_failed` 请求；正常重试路径从不触发 |
| RT-16 | 房间本地午夜后、cron 推进前到达的 `turns.complete`：步骤 2b 先推进 `localDate`，提案交付日按当日物化，不 bump（05 §5.7.3、09 §9.6.7） |

每个用例 afterEach 断言 RT3（每 run 至多一个 `running` attempt）与 RT7（`negotiating` 的 run 必有在途工作或延迟 / 停泊）。含看门狗的流程逐个推进定时器，不用一次性 `runAllTimers`（spikes §4：会在 0 ms action 跑完前触发看门狗）。

**真实部署（L2，实现第 1 周按 spikes §8 分配）**：20 个并发 `runs.start` → 恰好 1 个 run（#1）；`turns.complete` 与 bump 竞争（#1）；被打断的 action 在 `_scheduled_functions` 中的状态（#2、V3）；live 冒烟：attempt 各字段非空、第二回合 `cacheReadInputTokens > 0`；10 次 live 回合测 TTFT 与输出速率并回填 `budget.ts`（#15）；部署档位的被调度函数并发与积压时看门狗重登记。

## 10.22 待验证

| # | 事项 | 影响 | 验证方式 |
| --- | --- | --- | --- |
| V1 | Convex action 墙钟上限（假设 600 s） | I1、I2 | limits 文档 + 最小实验（spikes §8 #4） |
| V2 | SDK 1.1.0 在 Convex 默认运行时可打包并发起流式请求 | 是否需要 `"use node"` | 部署最小 action |
| V3 | 平台中断后 `_scheduled_functions.state.kind` 为 `failed`；`normalizeId` 在 mutation 中可用；`v.id('_scheduled_functions')` 能否作应用字段 | 看门狗分支 | 部署中途打断实验（spikes §8 #2、#9） |
| V4 | 默认运行时是否提供 `AbortSignal.timeout` | `abortAfter` 退路 | 最小实验 |
| V5 | Opus 5.5 在 effort medium 下的 TTFT 与输出速率（含 thinking） | `assumedMinOutputTps`、`ttftBudgetMs`（`REQUEST_TIMEOUT_MS`、`CALL_DEADLINE_MS` 与看门狗随之重算） | 10 次 live 回合（spikes §8 #15） |
| V6 | 流式下 `requestId` 的取法（`stream.request_id` 或 `withResponse()`） | 对账字段 | 读 SDK 1.1.0 源码 + 冒烟 |
| V7 | SDK 1.1.0 对流式请求的 `timeout` 语义（只到响应头，还是含空闲超时） | `REQUEST_TIMEOUT_MS` 的解释 | 源码 + 慢速假服务器 |
| V8 | 网关重试前失败的 HTTP 尝试（429 / 连接错误）是否计费 | 成本口径（`unknownCostAttempts`、`RESERVE_MICRO_USD`） | 定价文档 + 账单核对（spikes §8 #16） |
| V9 | `billing_error` 对应的 HTTP 状态与 SDK 异常类 | §10.15 映射 | 错误码文档 |
| V10 | 中途 `role:'system'` 与 `output_config.format` 同用 | 05 §5.13 的退路 | 预发布真实调用 |
| V11 | `fallbacks` 与 `output_config.format` 同用、回退模型是否遵守 schema | `MODEL_FALLBACKS` | 预发布（spikes §8 #16） |
| V12 | 部署档位的被调度函数并发上限 | 积压时延迟与看门狗重登记频率 | dev 部署压测 |

## 10.23 开放问题

1. **自动熔断**：401 / 403 / 计费错误时是否自动停止全部 live 调度（底稿有 `systemState.agents` 熔断；techstack r08 建议"401/403 全局告警并停调度"）。v1 只告警、由运维置 `AGENTS_ENABLED=false`，少一份全局状态；若运维响应不够快，再加一个由提交 mutation 写入的 `opsFlags.agentsHalted`。
2. **吞吐标定**：实测输出速率低于 80 tokens/s 时按实测值重算 `budget.ts`（总截止与看门狗同步推导）；低于 30.2 tokens/s（I1）则要改 canon D09 的 `max_tokens: 16000`。
3. **美元上限默认值**：每 run $3、全局每日 dev $5 / prod $15 是按 U5 月度预算推出的起点，需用户与 15 确认。
4. **运行时错误码的归属**：`AttemptErrorCode` 目前独立于 reasonCode（不给他方、不进模板）；06 若希望统一到 `core/engine/reasonCodes.ts`，可新增 `runtime.*` 域。
5. **`rawOutputs` 保留期**：按 03 §3.8 为 dev 30 天、prod 7 天（`ops.purgeRawOutputs`），单行 ≤ 64 KiB；是否再缩短由 07 / 15 决定（techstack D19：默认只存响应原文与请求哈希）。
6. （已关闭）运行时不再自创事件名：回合创建写 `turn_scheduled`（`createTurnTx`）、守卫拒收写 `turn_rejected_stale`（03 §3.11.1）、延期与停泊不写事件（由 `waitingReason` 渲染）；节流计数用 03 §3.11.3 的 `events.by_room_actor`。

## 10.24 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| §1.1 `attempt` 即用量账本 | 不设 `modelCalls` 表；迟到用量记在原 attempt（R03、§10.3） |
| §1.2 `actorUserId` | 全部 internal mutation / action 显式接收（`Id<'users'> \| null`）；鉴权在调度前完成（RT11） |
| §1.3 状态 | run / turn / attempt 状态逐字采用，没有 `paused`；回合等待（退避 / 日美元延期 / 排空）不改变 turn 状态，只写 `waitingReason` + `beginFnId`——本章早稿的 `running → scheduled` 回退与 `drainParked` / `deferredFnId` 字段已删除（§10.3、§10.4.5、§10.5.2） |
| §1.6 函数名 | `turns.beginAttempt`、`turns.complete`、`turns.fail`、`runs.reconcile`、`agents.runAttempt`、`agents.watchdog({ attemptId })`、`ops.livenessSweep`、`ops.activeAttemptCount`；模型接缝 `callModel`（`convex/model/agents/modelGateway.ts`） |
| D01 | 自建 scheduler 链；`beginAttempt` 唯一接缝；不用 `scheduler.cancel`；升级触发条件（R01、R02、§10.5） |
| D07 | G0–G3 以 attempt 身份为准；任一不符 → stale + 用量 + 事件（G0 除外）+ `runs.reconcile`；看门狗读 `_scheduled_functions` 决定重登记 / 崩溃 / 内部错误；`loadTurnContext` 为 null 时 `turns.fail(stale)`（§10.7–§10.9） |
| D08 | 串行，每 run 至多一个 `running` attempt（R07、RT3） |
| D09 | `stream().finalMessage()`；先记 usage 再分类；`stop_reason` 分支；`modelGateway` 运行时白名单；`claude-opus-5-5`、显式 `effort: 'medium'`、`max_tokens: 16000`、`timeout` 由 `max_tokens` 推导并写出不等式、SDK `maxRetries: 0` 而网关单层重试（429 / 连接错误每次调用 ≤ 1 次，408 / 409 / 5xx / 529 不重试）、`max_tokens` 截断在调用内重试 1 次（第二次 `retryable: false`）、总截止早于 `WATCHDOG_FIRST_MS` 且到期在任何阶段都不可重试（R10、R11、§10.10）；不传 `thinking` / 采样 / 预填 / `tool_choice`；`fallbacks` 默认关（`MODEL_FALLBACKS`）；schema 在 action 内按 `TurnSpec` 构造（§10.11、§10.14） |
| D15 | 回合失败 → `needs_input` + `agent_failed`（R15）；run 的 attempt / 美元上限 → customer 的 `rounds_exhausted`（`questionKey` `call_limit` / `spend_limit`，B4 / B5；04 R6 / U5 同此） |
| D16 | `opsLog` 白名单；SDK 错误消息丢弃；模型原文只进 `rawOutputs`（§10.15、§10.20） |
| D17 | 上限四层 + Console；`draining` 与 `AGENTS_ENABLED` 分离；被调度路径不抛错；stub 不受两个开关影响（§10.12）；另按 04 U4 定义 `maxAttemptsPerTurn = 2`（B4a），并把 12 B7 的 `run_starts` 桶落到 `beginAttempt` B6a（`waitingReason: 'run_cap'` + `beginFnId`） |
| D22 | `turns.complete` 在 G1–G3 前调用 `rollLocalDateTx`（09 §9.6.7），物化读当日 `room.localDate`；万一因此 bump，本 attempt 经 G1 判 stale（§10.7.2 步骤 2b、05 §5.7.3） |
| D26 | live / stub 共用 `AgentDriver` 与全部下游；replay / scripted 只在测试（§10.18） |

对底稿与专题的主要取舍：`modelCalls` → `attempts`；record → apply 两阶段 → 单次提交（理由见 R04）；SDK `maxRetries: 0` 保留，应用层全包改为网关单层重试（只对 429 / 连接错误一次，截断调用内一次，R11）；非流式 60 s 超时 → 流式 + 推导的预算；按调用次数的四级预算（每回合 / 每 run / 每房间 / 每部署每日）→ canon 的美元四层；自动熔断 → 手动开关（Q1）；评估方 fail-open 与 run `failed` → `agent_failed`；并行评审与共享 `turnSeq` → 串行、`turnSeq` 唯一；`protocolVersion` 守卫 → 排空纪律；`claimAttempt` 预占步骤 → 预留发生在 `beginAttempt`、守卫由 `loadTurnContext` 与提交 mutation 承担；保留底稿的 3 s 防抖（`SYSTEM_START_DELAY_MS`）。run-lifecycle-review 的修正全部落实：r01（必 reconcile）、r02（串行下不存在部分 step）、r04（G1 只接受 `negotiating`）、r05（AbortSignal 上界、`APIUserAbortError` → `model_timeout`）、r06（不依赖 21,333 守卫）、r07（看门狗读 `_scheduled_functions`）、r08（`context_overflow` 不重试）、r09（运行时事件不带 reasonCode）、r10（稳定版 usage 字段）、r11（运行时事件：采纳"回合开始对房间可见"的要求，但事件名用 03 §3.11.1 的 `turn_scheduled` / `turn_rejected_stale`，不另造 `agent_turn_started` / `agents_deferred`）、r12（删 `usageCounters`）、r13（`startRunTx` 在函数内重读 room）、r14（错误码双向对账）、r15（重试提示）。
