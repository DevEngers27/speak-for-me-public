# 10 · 代理运行时（part1：目标、决定总表、运行时不变量、三层对象）

> 分片（按顺序读）：
> - `10-agent-runtime.md`（本文件）：§10.0 目标与范围、§10.1 决定总表 R01–R18、§10.2 运行时不变量 RT1–RT12、§10.3 run / turn / attempt 三层与运行时字段
> - `10-agent-runtime-part2.md`：§10.4 生命周期时序（标准路径与四条故障路径）、§10.5 `turns.beginAttempt`（唯一调度接缝）
> - `10-agent-runtime-part3.md`：§10.6 `agents.runAttempt` 与 `agents.loadTurnContext`、§10.7 `turns.complete` / `turns.fail`、§10.8 `agents.watchdog`、§10.9 `runs.reconcile`
> - `10-agent-runtime-part4.md`：§10.10 重试策略、§10.11 时间预算与不等式（`budget.ts`）、§10.12 上限四层 + `draining` + `AGENTS_ENABLED`、§10.13 并发与部署
> - `10-agent-runtime-part5.md`：§10.14 `modelGateway`（运行时白名单、请求形状、`stream().finalMessage()`、回退开关）、§10.15 错误分类、§10.16 用量与成本、§10.17 缓存验证
> - `10-agent-runtime-part6.md`：§10.18 驱动（live / stub / replay / scripted）与故障注入、§10.19 失败模式总表 F01–F32、§10.20 可观测性
> - `10-agent-runtime-part7.md`：§10.21 不变量与测试、§10.22 待验证、§10.23 开放问题、§10.24 与 canon 的对照
>
> 底稿：`candidates/runtime/10-agent-runtime*.md`（run / turn / attempt 三层、attempt 与看门狗同事务登记、单层重试、故障计划 F01–F28）。吸收：`deepdives/run-lifecycle*.md` 与 `run-lifecycle/*.ts`（D1–D7、`budget.ts`、守卫 × 函数矩阵）及其反驳 r01–r15 的全部修正、`spikes/README.md` §2/§4/§7/§8、`techstack/README.md` D07/D13–D19/X2/X4、`foundation/model-call/README.md`。命名与关键决定以 `00-canon*.md` 为准，§10.24 逐条列出与底稿不同之处。协议语义（动作、快照、轮次、请求）在 05，本章只引用。

## 10.0 目标与范围

**要解决的问题**：

1. 被调度的 action 至多执行一次、不重试；被部署或平台打断时没有任何回调。任何中断都必须被发现，房间永远不能停在"协商中"却没有在途工作。
2. 约束变更、取消、看门狗判定之后，在途 action 仍可能跑完并尝试写入：必须有确定的拒收规则，且拒收后 run 仍有出路。
3. SDK 重试 × 应用重试 × 组件重试会把一次回合放大成几十次计费调用：每类错误只能由一层负责，最坏次数可算。
4. 成本必须有上限、可暂停、可排空，且用量在调用当时落库，不事后估算。
5. 模型调用参数必须在运行时被白名单约束（类型系统挡不住会 400 的写法，inputs/05 A4）。
6. 无模型额度时仍能开发、测试、演示：stub 与 live 共用全部下游，并在数据与界面上标注模拟。

**范围外**：协议动作与轮次规则（05）、状态迁移全表（04）、表的最终字段与索引（03，本章 §10.3 给出运行时必需字段）、代理上下文白名单（07）、价目表与告警通道（15）、测试矩阵（16）。

## 10.1 决定总表

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| R01 | 自建 `ctx.scheduler` 链；`turns.beginAttempt` 是**唯一调度接缝**：同一事务写 attempt 行 + `runAfter(delay, agents.runAttempt, {attemptId, actorUserId})` + `runAfter(WATCHDOG_FIRST_MS, agents.watchdog, {attemptId})` | canon D01：run / turn / attempt 状态无论如何都在自有表；workflow 再加一份工作流日志，在途实例遇步骤变更报 `Journal entry mismatch`；带组件后 codegen 不能离线 | `@convex-dev/workflow`（spike 倾向）、agent 组件（要求 Vercel AI SDK）、action-retrier（spike 实测不认 `NonRetryableError`、`onComplete` 清理静默卡死） |
| R02 | 升级路径只换接缝：并发 run > 50 或 429 成为常态 → `beginAttempt` 内把 `runAfter(0, runAttempt)` 换成 workpool `enqueueAction`；出现多步长流水线（如履约提醒）→ 为那条流水线单独用 workflow | 切换面 ≈ 1 个函数 + 配置；守卫、表、提交 mutation 不变 | 现在就引入 workpool（v1 每房间同时至多 1 个在途调用） |
| R03 | 三层对象 run / turn / attempt；**attempt 即用量账本**，不另设 `modelCalls` 表 | canon §1.1；迟到结果的用量记在它自己的 attempt 行上，不改终态回合 | run-lifecycle D6 / 底稿的独立 `modelCalls` 表（两份行要对账） |
| R04 | 每个 attempt 只有**一次**提交：`turns.complete` 或 `turns.fail`；不做 record → apply 两阶段 | 两阶段的收益是"apply 出缺陷时不必重调模型、usage 一定先落库"；代价是多一个 `received` 状态、多一个被调度函数、看门狗多一条分支、守卫写两遍。本设计用"complete 抛错 → action 捕获后调用极简的 `turns.fail(internal)` 记 usage，且 internal 不自动重试"拿到同样的保证，只有双重失败时 usage 退化为 `opsLog` 字段 | 底稿 §10.6 的 `recordAttemptResult` + `applyAttemptResult` |
| R05 | 持久化守卫 G0–G3（canon D07）只在 `turns.complete` / `turns.fail` / `agents.watchdog` / `agents.loadTurnContext` 使用；任一不符 → attempt `stale`、用量照记、写事件（G0 除外）、**调用 `runs.reconcile`** | run-lifecycle-review r01：只标 stale 会让 run 永久停在 negotiating | 守卫失败只标 stale；比较 `run.constraintsVersionAtStart`（D06 下等价，但回合快照更精确） |
| R06 | 看门狗以 `attemptId` 登记，每个 attempt 一个；到期先读 `_scheduled_functions`（`ctx.db.system.normalizeId` + `get`）：`pending` / `inProgress` → 重登记（≤ 3 次），`failed` → `action_crashed`，`success` 而 attempt 仍 running → `internal`；新 attempt 创建时**不** cancel 旧看门狗（G0 使其成为空操作） | run-lifecycle-review r07：以调度时刻计时的看门狗会在调度积压时误判并双付费；agentquality 评委："以 turnId 登记的看门狗误杀 attempt 2" | `{turnId}` + `turn.startedAt` 计时；`scheduler.cancel`（对已完成函数抛错、对在途 action 无效） |
| R07 | 回合串行，每 run 任意时刻至多一个 `running` attempt（canon D08） | 消除并行屏障死锁（07 中 5 份候选各有一例） | 并行评估 + 计数器屏障 |
| R08 | `modelGateway` 运行时白名单：请求体是网关内新建的字面量，顶层键 ⊆ `{model, max_tokens, system, messages, output_config}`，`output_config` 键 ⊆ `{effort, format}`，模型 ∈ `{claude-opus-5-5}`，effort ∈ `{medium}`；不传 `thinking`、采样参数、prefill、`tools` / `tool_choice`、`stop_sequences` | inputs/05 A4：`thinking: disabled`、强制 `tool_choice`、prefill、非字面量里的 `temperature` 都能通过 tsc 并在运行时 400 | 透传调用方对象；靠类型约束 |
| R09 | 统一 `client.messages.stream(body, { signal }).finalMessage()`（非 beta）；不用 `messages.parse()`；拿到响应先把 usage / `stop_reason` / `requestId` 写进 attempt，再分类 | canon D09；`parse()` 失败抛错并丢失 usage；流式避开非流式约 21,333 tokens 的上限与长空闲连接 | `messages.parse()`；非流式 + 8,000 tokens + 45–90 s 超时（三者不自洽） |
| R10 | `max_tokens = 16000`；单次发送的 `timeout` 由 `max_tokens` 推导；总截止 `CALL_DEADLINE_MS` 覆盖一次调用的首发 + 退避 + 重试（每次发送取 `min(timeout, 剩余预算)`），且早于看门狗首次判定 `WATCHDOG_FIRST_MS`；模块加载时断言不等式 `加载余量 + 总截止 + 落库余量 < action 上限` 与 `加载余量 + 总截止 < WATCHDOG_FIRST_MS` | run-lifecycle-review r05、np-review r04：45 s 超时与 8,000 tokens 互相矛盾，且 `retry-after` 不受 SDK 退避上限约束，真正的墙钟上界只能来自 AbortSignal | 手填常量；靠 SDK 的 21,333 守卫（显式设 timeout 时根本不检查） |
| R11 | SDK 重试关闭（`maxRetries: 0`，传输层拒绝非零值）；网关 `callModel` 是传输错误的唯一重试层：只对 429 与连接错误重试 1 次（退避遵从 `retry-after`，上限 8 s，且不超过剩余总截止），408 / 409 / 5xx / 529 不重试；`stop_reason: max_tokens` 记 `output.truncated` 并在同一次调用内重试 1 次，第二次截断返回 `retryable: false`；**截止到期一律是不可重试的超时**（`model_timeout`），无论发生在发送前、退避中还是发送中；attempt 层只为网关不处理的失败（非截断的输出问题、action 崩溃、看门狗超时）开至多 1 个 `auto_retry`，网关已重试过或判为不可重试的失败不再重试；每次调用至多 3 次发送（首发 + 1 次传输重试 + 1 次截断重试），每条回合链最坏 HTTP 次数 = 3 × 2 = 6 | canon D09；每类错误只有一层在重试，最坏次数是乘积；SDK 重试会与网关重试相乘，且退避不受总截止约束；W0-F 验证评审 r01：截止到期后（含退避中）再发请求会越过看门狗首次判定 | SDK `maxRetries: 1`（流开始前由 SDK 重试：总截止须按 SDK 次数放大到 448 s，晚于 `WATCHDOG_FIRST_MS`）；attempt 层再重试传输错误或超时（同一类错误两层重试）；截断作为新 attempt 重试（与调用内重试叠加成两次截断）；组件重试与 SDK 重试相乘 |
| R12 | `fallbacks` 默认关（开关 `MODEL_FALLBACKS`）；不传任何 `thinking` | canon D09 / C16 / C17：与 `output_config.format` 同用待验证，开启需改走 `beta.messages` 且 usage 按 `iterations` 拆行；`thinking` 参数能 400 | techstack D17 默认开；D14 显式 `thinking: {type: 'adaptive'}` |
| R13 | 输出 schema 在 action 内由 `TurnSpec` 构造（05 §5.4），不经 `runQuery` 传递 Zod 对象或 JSON Schema | 07 评委实测：`zodOutputFormat` 产生的 `$defs` / `$ref` 过不了 Convex 值校验，`runQuery` 抛错后每个回合都等看门狗超时 | 在 `getTurnContext` query 里返回 schema |
| R14 | 上限四层（每用户每房间每小时节流 / 每 run attempt 上限 / 每 run 美元预留与结算 / 全局日美元）+ Console 兜底；`opsFlags.draining` 独立于 `AGENTS_ENABLED`；被调度路径遇上限不 throw | canon D17、techstack X2 | 每房间累计 `modelCallBudget`；`usageCounters` 分片；用 `AGENTS_ENABLED=false` 排空 |
| R15 | 回合失败（自动重试用尽、拒答、不可重试错误）→ turn `failed` → run `needs_input` + `agent_failed` 请求给该角色（05 §5.11）；没有 `paused` / `failed` run 状态，也没有评估方 fail-open | canon D15 / C6；fail-open 让一方代理"沉默"却照常送审，违背"该方本人决定"（PD-11） | 底稿 F20 评估方 `no_recommendation` fail-open；run `failed` + 24 h 看门狗 |
| R16 | `runs.reconcile(runId)` 维护活性：run 为 `negotiating` 却没有在途 attempt、也没有待执行的延迟调度（`beginFnId`）时，重新调度当前回合、补开替代回合或按上限转 `needs_input`；另有每 5 分钟的 `ops.livenessSweep` 巡检兜底（04 §4.3.5、15 §15.8） | canon D07；INV-49 | 只靠看门狗（看门狗只覆盖 running 的 attempt） |
| R17 | stub 与 live 共用 `AgentDriver.decide()` 与全部下游；replay / scripted 只在测试；stub 不受 `draining` 与 `AGENTS_ENABLED` 影响 | canon D26 / D17 | stub 走另一条代码路径 |
| R18 | `AGENT_MODE`（`live` \| `stub`）在 run 创建时快照到 `runs.agentMode`；preview 部署强制 stub；live 缺 `ANTHROPIC_API_KEY` 时启动检查失败而不是静默改用 stub | 一个 run 不会混用真假代理；fail-closed | 每个 attempt 读环境变量 |

## 10.2 运行时不变量

| # | 不变量 | 主要落点 |
| --- | --- | --- |
| RT1 | 每房间至多一个非终态 run，`rooms.currentRunId` 指向它 | `runs.start` / `startRunTx`（读写 rooms 文档，OCC 串行化） |
| RT2 | 非终态 run 的 `constraintsVersionAtStart === room.constraintsVersion`（否则已被 supersede） | 09 `constraints.bump` 同事务 supersede；`runs.reconcile` 纵深 |
| RT3 | 每 run 至多一个非终态回合、至多一个 `running` attempt | `beginAttempt` B1 |
| RT4 | 每个 attempt 的看门狗与它在同一事务登记 | `beginAttempt` 步骤 7 |
| RT5 | 每个收到的 HTTP 响应都把 usage 写进它的 attempt 行（双重失败时退化为 `opsLog`） | `turns.complete` / `turns.fail` |
| RT6 | 模型结果只在 G0–G3 全部成立时生效 | §10.7 |
| RT7 | run 为 `negotiating` ⇒ 当前回合有 `running` attempt，或有待执行的延迟 `beginAttempt`，或被 `draining` 暂停 | `runs.reconcile` + 巡检 |
| RT8 | 重试只在两层、按错误类别互不重叠、各有固定上界：网关每次调用 ≤ 1 次传输重试（429 / 连接错误）+ ≤ 1 次截断重试，SDK 0 次；attempt 层 ≤ 1（每条链，只针对网关不处理的失败）；截止到期不重试；每 run attempt ≤ `maxAttempts` | §10.10 |
| RT9 | `draining`、`AGENTS_ENABLED=false`、任一上限命中时不发起 live 模型调用；stub 只受 attempt 上限约束 | §10.5、§10.12 |
| RT10 | action 除经 `turns.complete` / `turns.fail` 外不写任何表 | 代码结构 + lint |
| RT11 | 没有公开 action；`agents.runAttempt` 是 internal action，鉴权在调度前完成并显式传 `actorUserId`（被调度函数里 `getUserIdentity()` 为 null，inputs/05 B4） | 12 构造器 |
| RT12 | 每个 attempt 记录 `provenance`、`model`、`effort`、`maxTokens`、`schemaVersion`、`promptVersion`、`protocolVersion` | §10.5、§10.16 |

## 10.3 三层对象与运行时字段

| 层 | 表 | 含义 | 状态（canon §1.3） |
| --- | --- | --- | --- |
| run | `runs` | 在一个约束版本下的一次协商运行 | `negotiating` → `pending_approval` → `executed`；旁路 `needs_input`；终态 `executed` / `superseded` / `ended_no_agreement` / `canceled` |
| turn | `turns` | run 内第 `turnSeq` 个回合，属于一个角色 | `scheduled` → `running` → `completed` \| `failed` \| `stale` |
| attempt | `attempts` | 回合的第 `attemptNo` 次调用，也是用量账本 | `running` → `completed` \| `invalid_output` \| `timeout` \| `error` \| `refused` \| `stale` |

字段、枚举与索引**一律以 03 §3.8（runs / turns / attempts / rawOutputs）与 §3.12（opsFlags / spendCounters）为准**，本章不再自列字段；下面只说明运行时如何使用它们，以及本章向 03 补登记的字段：

- `runs`（03 §3.8）：`agentMode`、`maxRounds`（`keep_as_is` 延长时 +1）、`roundsExtended`、`roundNo`、`activeTurnSeq`（`number | null`）、`nextTurnSeq`、`attemptCount`、`maxAttempts`、`reservedMicroUsd`、`spentMicroUsd`、`unknownExposureMicroUsd`（成本未知的暴露，§10.12.2，本章提出）、`spendCapMicroUsd`、`constraintsVersionAtStart`、`cause`、`startedBy`（`Id<'users'> | undefined`，缺省 = 系统 / cron）、`previousRunId?`、`lastFailure?`；索引 `by_status`（巡检、排空恢复只列 `negotiating`）。`providerRejectLocked` **不存**：由本 run 的 humanRequests 派生（存在 toRole = provider、kind = agent_escalated 且以 keep_as_is 回答的请求，05 §5.3.3）。
- `turns`（03 §3.8）：`turnSeq`、`roundNo`、`role`、`kind`、`status`、`constraintsVersion`（快照）、`currentAttemptNo`、`waitingReason?`（`backoff | spend_deferred | draining | run_cap`；`run_cap` 是 12 B7 `run_starts` 桶对系统开局 run 的首回合延期，见 §10.5.2 B6a，03 §3.8 已登记）、`beginFnId?`（延迟调度 `runAfter(…, turns.beginAttempt)` 的 id）、`retryOfTurnId?`、`result?`、`outcome?`；索引 `by_run_turnSeq`。回合等待**不改变 status**：`scheduled` 留在 `scheduled`、`running` 留在 `running`，只写 `waitingReason` 与 `beginFnId`（canon §1.3 没有 `running → scheduled`，04 §4.4）。
- `attempts`（03 §3.8）：`roomId`、`runId`、`turnId`、`attemptNo`、`role`、`origin`（`turn_start` \| `auto_retry` \| `retry_turn`）、`status`、`provenance`（`live` \| `stub`）、`actionFnId`、`watchdogFnId`、`watchdogArmCount`、`deadlineAt`、`reservedMicroUsd`、`reservedDay`、`protocolVersion`、`promptVersion`、`schemaVersion`（= `turnSpecKey(spec)`，05 §5.4.1）、`model`、`effort`、`maxTokens`、`usage?`、`responseModel?`、`stopReason?`、`stopCategory`（`string | null`）、`requestId?`、`messageId?`、`latencyMs?`、`errorCode?`（reasonCode `output.*` / `action.*`，或 §10.15 的 `AttemptErrorCode`）、`issuePaths?`、`staleGuard?`（`G1` \| `G2` \| `G3`）、`httpStatus?`、`retryAfterMs?`、`costMicroUsd?`、`priceTableAsOf?`、`rawOutputRef?`、`rationaleTruncated?`、`retryNote?`、`move?`（通过结构解析的 move，含被语义校验拒绝的，本方可见）、`outputBytes?`、`lateUsage`、`costState`（`reserved | unknown | known`，§10.12.2）、`inProgressSeenAt?` / `physicalLeaseUntil?`（物理 action 租约，§10.8）、`startedAt`、`finishedAt?`（其中 `reservedDay`、`protocolVersion`、`promptVersion`、`staleGuard`、`httpStatus`、`retryAfterMs`、`rationaleTruncated`、`retryNote` 由本章提出、03 已收录；`protocolVersion` 在 03 是 `v.string()`，写入 `String(PROTOCOL_VERSION)`）；索引 `by_turn`（`turnId, attemptNo`）、`by_run`（run 级对账）、`by_status_deadline`（排空计数与巡检）、`by_room`（成本报表）。`usage` 的形状是 03 §3.4 的 `usageV`：五个整数字段（`inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens`），没有 `serviceTier`。
- `spendCounters`（03 §3.12）：`scope: 'global'`、`day`（UTC `YYYY-MM-DD`）、`reservedMicroUsd`、`spentMicroUsd`、`attempts`、`unknownCostAttempts`（后两者由本章提出、03 已收录）、`unknownExposureMicroUsd`（§10.12.2，本章提出）；索引 `by_scope_day`。
- `opsFlags`（03 §3.12，单行 `key: 'global'`）：`draining: boolean`、`changedAt`、`changedBy`。`modelVerifiedAt` 不在 opsFlags：`ops.checkModelConfig` 的结果只写 `opsLog('model_config_verified')`。
- `rawOutputs`（03 §3.8，internal，无任何 query 暴露）：`attemptId`、`roomId`、`text`（≤ 64 KiB，超出截断并记 `truncated`）、`createdAt`、`expiresAt`（dev 30 天、prod 7 天，15 §15.8 `ops.purgeRawOutputs`）。

attempt 行在进入终态后只允许一种修改：看门狗先判 `timeout`（或其他无响应的终态）、之后迟到的结果到达时补写 `usage`、`costMicroUsd` 与 `lateUsage: true`，并把 `costState` 从 `unknown` 推进到 `known`（钱已花，账要记，§10.12.2；这些字段只能从空写成值）；迟到的未发请求证明（`stale_context` / `agents_disabled` / `config_invalid`）是同一修改的零成本形式：只写 `costMicroUsd: 0` 并把 `costState` 从 `unknown` 推进到 `known`；其余字段不再改动。
