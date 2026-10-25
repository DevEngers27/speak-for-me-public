# 专题深潜：run / turn 生命周期与调度（part 1/3）

> 分片：本文件（目标与范围、决定与理由）→ `run-lifecycle-part2.md`（表、状态机、守卫矩阵、函数职责与时序）→ `run-lifecycle-part3.md`（反例与边界、测试、接口、待验证）。代码草图在 `run-lifecycle/`：`schema.ts`（表）、`budget.ts`（唯一预算）、`state.ts`（迁移表与错误策略）、`lifecycle.ts`（守卫、上限、调度接缝、run 级 helper）、`mutations.ts`（startRun/retryTurn/cancelRun/completeTurn/failTurn/turnWatchdog）、`runTurn.ts`（action）。代码是草图：名字与控制流是设计的一部分，函数体示意。
> 平台事实以 inputs/04 为准；本文直接引用 `node_modules/convex/dist/esm-types/server/scheduler.d.ts`（下称 `scheduler.d.ts`）的行号。

## 1. 目标与范围

### 1.1 要解决的问题

1. **被调度的 action 至多执行一次、不重试**（`scheduler.d.ts:17-21`："Scheduled actions execute at most once. They are not retried and may fail due to transient errors"）。原仓库没有 try/catch、失败状态与恢复，action 抛错或被部署打断后房间永远停在 negotiating（F10.1）。
2. **迟到结果**：约束变更、取消、看门狗判超时之后，在途 action 仍可能跑完并尝试写入（`scheduler.d.ts:113-116`：已开始的 action 被 cancel 后"will continue running"）。必须有确定的拒收规则。
3. **重试相乘**：SDK 重试 × 应用重试 × 组件重试会把一次回合放大成几十次计费调用（F10.4）。
4. **成本失控**：没有每 run / 每房间 / 全局的调用上限与总开关（F10.5）。
5. **无模型额度时仍要能开发、测试、演示**：stub 模式（F10.7），且必须在数据与界面上标注为 simulated（任务书 §3.8）。
6. **用量不能事后估算**：每次调用的 token、请求 ID、stop_reason、耗时、尝试序号必须在调用当时落库（F10.15）。

### 1.2 范围

- 包含：`runs`、`agentTurns`、`modelCalls`、`usageCounters` 四张表；run 与 turn 两个状态机；`startRun / beginStep / runTurn / completeTurn / failTurn / retryTurn / cancelRun / supersedeRun / resumeRun / turnWatchdog` 的职责、守卫和时序；重试与超时的单一预算；调用上限；`AGENTS_ENABLED` 与 `AGENT_MODE`；编排路线 ADR。
- 不包含（只定义接口）：一个 step 里由哪些角色出场、step 结束后去哪（05-protocol 的 `planAfterStep`）；代理上下文如何组装与裁剪（07 的 `assembleTurnContext`）；模型输出的业务校验（06 的 `validateAgentOutput`）；审批与执行（08）；约束变更何时递增（09）。

### 1.3 术语（本专题内固定用法）

| 术语 | 含义 |
| --- | --- |
| run | 一次协商运行：从 startRun 到 pending_approval / needs_input / confirmed / superseded / cancelled / failed。每房间同一时刻至多一个"活跃" run。 |
| step | run 内的一个推进单位，序号 `turnSeq`（0 起）。一个 step 含 1–N 个并行的角色回合，例如 step 0 = provider 提议，step 1 = customer 与 finance 并行评估（F05.5）。 |
| slot | step 内的一个角色位置：`(runId, turnSeq, role)`。 |
| attempt / turn | slot 的一次尝试，对应 `agentTurns` 一行，`attempt` 从 1 起。**一行 = 一次逻辑模型调用**（stub 也算一次）。 |
| HTTP 尝试 | SDK 内部对一次逻辑调用的重发；对应用不可见（04 §4.6）。 |
| 活跃 run | `status ∈ { negotiating, pending_approval, needs_input, failed }`。 |

> 命名说明：沿用审查里的 `nextTurnSeq` 字段名，但语义定为"**当前等待持久化的 step 序号**"。同一 step 的并行回合共享 `turnSeq`，这是并行评估与 `run.nextTurnSeq === turnSeq` 守卫能同时成立的前提。

## 2. 决定与理由

### D1 编排路线：v1 自建 `ctx.scheduler` 链，保留切换到 workpool 的接缝；不用 @convex-dev/workflow，不用 agent 组件

- **目标**：用最少的移动部件得到"每次调用结果恰好被提交一次或被明确拒收，任何中断都能被发现并恢复"。
- **决定**：mutation 写状态 + 同事务 `ctx.scheduler.runAfter(0, internal.agentRuntime.runTurn, { turnId })` 启动调用；同事务 `runAfter(watchdogDelayMs, internal.agentRuntime.turnWatchdog, { turnId })` 兜底超时；action 只做"读上下文 → 调模型 → 一次 runMutation 提交"。全部调度集中在一个函数 `scheduleAttempt()` 里，它是将来换成 workpool 时唯一要改的地方。
- **理由**：
  1. 一个 run 是有限、短的 step 序列（首场景串行深度 2，最多 `maxRounds` 轮），每个 step 一到两次调用；"等人审批/回答取舍"可能持续数天，但它只是一行状态，不需要一个挂起的工作流进程（04 §2.2"可直接用于判断的事实"）。
  2. 无论哪条路，**迟到结果拒收、每房间单活跃 run、私密上下文、用量记录都得自建**（F10.3、04 §2 含义 1）。组件只替我们省掉"重试调度 + 看门狗"约 80 行代码。
  3. `runs` 表无论如何都要存在（守卫、UI、审计都读它）。用 workflow 等于再引入一份并行的状态（工作流日志），两份状态的一致性要额外证明。
  4. workflow handler 必须确定性，**修改步骤结构会让在途实例失败**（04 §2.1），而 v1 阶段协议与规则会频繁迭代；它也要求部署前排空在途工作流。自建链在部署时最坏只是打断在途 action，由看门狗接住。
  5. 零新依赖；状态全部在自有表中，convex-test + 假时钟可直接测。
- **被否决**：
  - `@convex-dev/workflow`：理由见上 3、4；其 `awaitEvent` 对我们无增量价值（人工等待已是状态行）。
  - `@convex-dev/agent`：要求换成 Vercel AI SDK v7，与已定技术栈冲突；线程模型默认跨线程检索与私密委托冲突（04 §2.1、F10.3）。
  - `@convex-dev/action-retrier` 单用：只解决重试，不给并发上限，也不替我们做迟到拒收；而我们的重试规则按错误类别区分层级（D3），用它反而要把一半错误类别再关掉。
- **切换成本与触发条件**见 §2.D1a。

### D1a 何时切换、切换成本

| 触发条件（任一出现就重新评估） | 切换目标 |
| --- | --- |
| 并发房间数上来后，Anthropic 429 成为常态，需要全局 `maxParallelism` | `@convex-dev/workpool`（只换 `scheduleAttempt`） |
| 看门狗/重试代码在生产中出过两次以上 bug | workpool（`retry` + `onComplete`） |
| 出现需要在后台跑多步、带 `sleep` 的长流水线（例如第二场景的分阶段履约提醒） | 为那条流水线单独用 workflow，不迁移协商 run |

切换到 workpool 的改动面（估算，待验证 #15 后定稿）：
1. `scheduleAttempt()`：`runAfter(0, runTurn)` 换成 `pool.enqueueAction(ctx, internal.agentRuntime.runTurnCore, { turnId }, { onComplete: internal.agentRuntime.onAttemptComplete, context: { turnId } })`，不开组件重试（保持 D3 的单层重试）。
2. 若 workpool 能可靠上报平台级中断（`onComplete` 收到 failed），看门狗可删；否则保留。
3. `completeTurn / failTurn / retryTurn / cancelRun` 与三条守卫**不变**；`runTurn` 的 try/catch 不变。
4. 新增 `convex/convex.config.ts`、`convex-helpers` peer、convex-test 中的组件注册。
总量约 1 个文件改动 + 配置；表结构不变（`agentTurns.scheduledFnId` 改为存 workpool 的 workId，字段改名为 `dispatchRef`，因此 v1 就用这个中性名）。

切换到 workflow 的改动面：要把"step 推进"从 `completeTurn` 搬进 workflow handler，`runs` 状态变成工作流状态的镜像，审批/取舍等待要么用 `awaitEvent`，要么结束工作流再开新的；测试面增加确定性重放。估算为重写编排层（`lifecycle.ts` 的一半）+ 部署纪律变化。这是不选它的另一条理由。

### D2 三条持久化守卫 + 一条前置条件，只在 completeTurn（及其失败分支）里使用

| 编号 | 守卫 | 防的是什么 |
| --- | --- | --- |
| G0 | `turn.status === "running"` | 看门狗已判超时、run 被取消/取代时回合已被标 stale、重复提交 |
| G1 | `room.currentRunId === run._id && run.status ∈ { negotiating, failed }` | run 被取代（新 run）、被取消、已进入 pending_approval 之后的迟到写入 |
| G2 | `run.nextTurnSeq === turn.turnSeq` | 同一 run 内 step 已推进后，旧 step 的迟到结果 |
| G3 | `room.constraintsVersion === run.constraintsVersionAtStart` | 有任何写路径递增了约束版本却没有取代 run（纵深防御；正常路径下 09 的 bumpConstraints 会同事务取代 run，G1 先拦住） |

- G1 允许 `failed`：并行 step 中一个 slot 最终失败使 run 进入 failed 时，另一个在途 slot 的成功结果仍是有效且已付费的工作，应当持久化（只是不推进）。
- 任一守卫不满足：回合 → `stale`（G0 不满足时回合已是终态，不再改它），插入一条 `modelCalls`（`outcome: "discarded_stale"`），写 `turn_rejected_stale` 事件（G0 情况除外，避免刷事件）。**绝不读取模型回显的版本号或 ID**（F05.1），比较的全部是 turn 行里的服务端快照。
- 这一组守卫与审批/执行守卫（`run.status === "pending_approval"`、`room.currentProposalId`、`proposal.constraintsVersion`）是两组，不混用（F04.2）。

### D3 重试与超时只写一份预算：按错误类别指定唯一负责的层

`budget.ts` 的 `TURN_BUDGET` 是唯一来源；看门狗期限、SDK 选项、AbortSignal、最坏调用数全部从它推导，并在模块加载时断言（代码见 `run-lifecycle/budget.ts`）。

| 错误类别 | 负责重试的层 | 应用层是否再试 |
| --- | --- | --- |
| 429、5xx、408/409、连接错误、单次 HTTP 超时 | SDK（`maxRetries = TURN_BUDGET.sdkMaxRetries`） | 否。SDK 用尽后回合 failed（`api_error`），等人点 Retry |
| 输出不合 schema、`stop_reason: max_tokens`、业务规则拒绝（06） | 应用层：新 attempt | 是，每个"非自动重试产生的" attempt 最多再自动试 `appAutoRetries` 次 |
| action 丢失或卡住（看门狗到期） | 应用层：新 attempt | 是，同上 |
| `refusal`、400、401/403、`agents_disabled`、调用上限 | 无 | 否，直接 failed；400 视为编程错误 |

- **理由**：每个错误类别只有一层在重试，最坏调用数是乘积而不是指数叠加：每个 slot 最坏 `(1 + appAutoRetries) × (1 + sdkMaxRetries)` 次 HTTP 请求。初始值 `appAutoRetries = 1`、`sdkMaxRetries = 1` → 每 slot 最坏 4 次；首场景每轮 3 个 slot，`maxRounds = 3` → 每 run 最坏 36 次 HTTP 请求，被 `run.maxCalls` 再封顶（逻辑调用计数，见 D4）。
- 被否决：SDK `maxRetries: 0` + 应用层全包（每次重试都要一次调度往返和一次 mutation，延迟更差，且要自己实现 retry-after 解析）；workpool/action-retrier 重试（与 SDK 重试相乘，F10.4）。

### D4 调用上限：三层，各自落在已经要写的文档上，避免新增热点

| 上限 | 存放 | 检查点 | 超限后 |
| --- | --- | --- | --- |
| 每 run 逻辑调用数 `run.maxCalls`（初始 12，场景可配） | `runs.callCount`（创建 attempt 的 mutation 本来就要写 run） | `reserveCall()`，在插入 attempt 行之前 | run → failed（`call_cap_reached`），只能 cancelRun 后重新开始 |
| 每房间每 UTC 日 live 调用数（初始 60） | 不建计数文档；用 `agentTurns` 索引 `by_room_and_mode_and_createdAt` 做 `.take(cap + 1)` 计数 | 同上 | run → failed（`room_daily_cap`），次日可 retryTurn |
| 全局每 UTC 日 live 调用数（初始 2,000） | `usageCounters` 一行一天 `key = "global:YYYY-MM-DD"` | 同上 | 同上（`global_daily_cap`） |
| 最终兜底 | Anthropic 控制台 workspace 花费上限（dev/prod 分开） | 平台 | SDK 报错 → `api_error` |

- 偏离 F10.5（它写"超限进入 needs_input"）：needs_input 在本设计里专指"等某个具体的人回答取舍/澄清"（05），调用上限不是谁能回答的问题，所以进 failed 并给出明确 reasonCode 与恢复路径。
- 全局计数文档是热点：每个 attempt 创建都写它。v1 规模（个位数并发房间）下冲突由 OCC 自动重试吸收；若观测到冲突率上升，改为按 `hash(roomId) % 8` 分片、检查时读 8 行求和（接口不变）。
- 并发上限（同时在途的调用数）v1 不做：协议保证每房间同时 ≤ 2 个在途 slot；全局并发是 D1a 的切换触发条件。

### D5 总开关与模式：`AGENTS_ENABLED` 只管 live；`AGENT_MODE` 在 run 开始时快照

- `AGENT_MODE ∈ { "live", "stub" }`（Convex 环境变量，缺省 `stub`，生产必须显式设 `live`）。startRun 读一次写入 `run.agentMode`，此后该 run 的所有 attempt 都用这个模式，环境变量中途变化不会让一个 run 混用真假代理。
- `AGENTS_ENABLED !== "true"` 时：live 模式的 startRun、scheduleAttempt 拒绝（`agents_disabled`），runTurn 在调用模型前再查一次（中途关闭立即生效，回合 failed，不自动重试）。stub 不受影响——stub 不发外部请求、不花钱，它正是关闭真实代理后的演示降级路径（F10.7）。
- stub 回合与 live 回合走同一条 `completeTurn` 路径、同一个输出 schema、同一套校验；`agentTurns.agentMode` 与 `modelCalls.mode` 记为 `stub`，界面在回合与由其产生的提案上显示 "Simulated agent"（任务书 §3.8）。
- 被否决：总开关同时关掉 stub（失去降级演示能力，且 stub 没有需要保护的成本）。

### D6 用量记在独立的只追加表 `modelCalls`，不记在 `agentTurns` 上

- 理由：迟到结果（回合已被看门狗或取代标成终态）仍然产生了真实费用，必须有地方记录而不去改一条终态回合行；将来简报抽取等非回合调用共用同一账本；按日、按房间的成本查询走索引。
- 不存金额：成本由 query 按代码里带版本号的价格表从 token 换算，并在界面上标"估算"（F03.9；偏离 04 §4 含义 8 的"估算成本"字段——价格会变，存了反而要迁移）。

### D7 不调用 `scheduler.cancel`

- `scheduler.d.ts:113-117`：对已完成的 action 调 cancel **会抛错**；对在途 action 无效。要安全使用必须先读 `_scheduled_functions` 的 `state.kind`，增加分支却没有收益。
- 替代：`runTurn` 的第一步 `loadTurnContext` 是 query，回合不再是 running（被取代、取消、看门狗判超时）时返回 `null`，action 立即退出、不调模型。看门狗到期时若回合已是终态则是空操作。代价只是一两次空的函数调用。
