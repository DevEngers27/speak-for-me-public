# 04 平台约束与推荐模式（第 3/7 部分）

> 分片清单见 part1。本文件：§2 Convex 官方组件。版本与 peer 依赖来自 2026-10-24 的 `npm view`；行为描述来自各包 README（`npm view <pkg> readme`），未安装、未运行，标"待验证"的需要实验确认。

## §2 Convex 官方组件

### 2.0 共同前提

- 组件通过 `convex/convex.config.ts` 里的 `defineApp()` + `app.use(component)` 安装，再用 `components.xxx` 构造客户端对象（action-retrier README 安装节）。
- 组件有自己的表与函数命名空间，数据与应用表隔离；组件代码本身不支持 `"use node"`（源码 `CVX:cli/lib/components/definition/bundle.ts:783`）。
- 组件在 convex-test 中需要注册才能测试，具体 API 待验证。
- 所有"重试"能力都要求被重试的 action 幂等（workpool README Idempotency 节、action-retrier README 标题"retrying idempotent actions"）。调用 Claude 本身不是幂等的（每次计费、输出不同），所以"可重试"指：重复调用不会造成重复的业务写入，结果只被提交一次。

### 2.1 各组件概况

| 组件 | 版本 / peer / 依赖 | 解决什么 | 代价与约束 |
| --- | --- | --- | --- |
| `@convex-dev/workpool` | 0.4.14；peer `convex ^1.36.1`、`convex-helpers ^0.1.94`；依赖 `@convex-dev/batch-worker ^0.2.2` | 按池限制并发（`maxParallelism`）的后台队列；action 重试（指数退避 + 抖动，`retryActionsByDefault` 默认关）；`onComplete` 回调在成功、失败、取消时都会被调用；`NonRetryableError` 跳过剩余重试；`cancel` / `cancelAll`；响应式状态；`maxParallelism: 1` 可串行化热点 mutation，减少 OCC 冲突 | 新增 `convex-helpers` peer；`cancel` 不会中止在途 attempt，在途成功仍算成功；`onComplete` 是否严格 exactly-once：README 写"always be called"，严格语义待验证 |
| `@convex-dev/workflow` | 0.4.10；peer `convex ^1.46.0`、`convex-helpers ^0.1.127`、`@convex-dev/workpool ^0.4.4`；依赖 `async-channel` | 持久化工作流：步骤（`step.runQuery/runMutation/runAction/runWorkflow`）可串行或并行，`step.sleep`，`step.awaitEvent` + `sendEvent`（人工介入），按步重试，取消，从任意步重启，状态查询，`onComplete` exactly-once；mutation 步骤 exactly-once | handler 必须**确定性**：禁止 `fetch`、环境变量、`crypto`，`Math.random` 被换成按工作流播种的 PRNG，`Date` 被打补丁；重放时校验每步参数与日志一致，不一致则"determinism violation"失败；**修改工作流实现（增删、重排步骤）会让在途工作流失败**；单次执行中步骤输入输出合计 1 MB，日志上限 8 MiB；工作流主体本身是 mutation，受 mutation 限额约束；action 步骤默认不重试；取消时在途 `runAction` 会跑完 |
| `@convex-dev/action-retrier` | 0.3.1；peer `convex ^1.24.8`；无依赖 | 对单个 action 做指数退避重试（默认 `initialBackoffMs: 250`、`base: 2`、`maxFailures: 4`）；返回 `runId` 可查状态、可取消；`onComplete` mutation 保证最终恰好执行一次 | 只适合幂等 action；与 workpool 的重试能力重叠；不提供并发上限 |
| `@convex-dev/agent` | 0.7.8；peer `ai ^7.0.0`、`@ai-sdk/provider ^4.0.0`、`@ai-sdk/provider-utils ^5.0.0`、`convex ^1.46.0`、`convex-helpers ^0.1.127`、`react` | 线程与消息持久化、工具调用、经 WebSocket 的增量流式、上下文与 RAG 检索、用量追踪、限流、与 workflow 集成 | **必须换成 Vercel AI SDK v7 + provider 包**（如 `@ai-sdk/anthropic` 4.0.87，peer `zod ^3.25.76 || ^4.1.8`），与任务书"@anthropic-ai/sdk 服务端调用"的已定技术栈冲突；Opus 5.5 的新约束（`output_config.effort`、结构化输出、禁用采样参数、`refusal`、`fallbacks`）在 AI SDK provider 中的支持程度待验证；线程/消息模型面向聊天，私密委托需要逐方隔离，默认的跨线程检索要关闭或证明不会越权 |
| `@convex-dev/rate-limiter` | 0.4.2；peer `convex ^1.43.0`、`react`；依赖 `@convex-dev/batch-worker 0.3.5` | 应用层限流：固定窗口 / 令牌桶，按 key（如 userId、roomId），可一次消费自定义数量（可按 token 计），事务性（mutation 回滚则限流消耗一并回滚），默认失败即拒绝（fail closed），可预留容量，分片扩展，React hook | 新增组件表；与"每间房同一时刻只有一个活跃 run"这类业务不变量不是一回事，后者仍需业务唯一性检查 |

### 2.2 "自建 scheduler 链" vs "采用组件"（只列事实，不做决定）

| 维度 | 自建：mutation + `ctx.scheduler` + attempt 表 + watchdog | workpool（可加 action-retrier） | workflow（内含 workpool） | agent |
| --- | --- | --- | --- | --- |
| 新增依赖 | 无 | workpool + convex-helpers（+ action-retrier） | workflow + workpool + convex-helpers | agent + convex-helpers + ai v7 + @ai-sdk/* |
| 是否沿用 @anthropic-ai/sdk | 是 | 是 | 是（在 action 步骤里调用） | 否，需换 AI SDK |
| action 重试 | 自己写：catch 后 `runMutation` 记失败并 `runAfter(backoff)` | 内置退避 + 抖动，可按次关闭；`NonRetryableError` | 内置，按步配置，默认关 | 由 agent/workflow 配置，待验证 |
| 并发上限 | 自己写（业务锁或计数） | `maxParallelism` 按池 | 继承 workpool | 待验证 |
| action 丢失/超时检测 | 自己写 watchdog（`runAfter(deadline)` 的 mutation，exactly-once） | 组件管理 attempt 生命周期；平台级中断如何上报：待验证 | 同左 | 待验证 |
| 完成回调 | 提交结果的 mutation 就是回调 | `onComplete`（成功/失败/取消） | `onComplete` exactly-once | 线程消息 + 回调 |
| 取消在途调用 | 不可中止；靠版本/状态检查拒绝迟到结果 | 不中止在途 attempt | 不中止在途 `runAction` | 待验证 |
| 长时间等人（审批、取舍请求） | 状态行 + 等待人的 mutation，天然支持 | 不负责，需状态行 | `awaitEvent`，工作流挂起不占资源 | 不负责 |
| 代码约束 | 只有 Convex 自身约束 | 少 | handler 确定性；改代码会破坏在途实例；1 MB/8 MiB 日志 | 采用其消息与上下文模型 |
| 可观测性 | 全在自有表中，可按需建模 | 组件表 + 状态 query | 步骤历史可响应式查询 | playground、用量追踪 |
| 测试 | convex-test + 假时钟 | 需注册组件，待验证 | 需注册组件；确定性重放增加测试面 | 需注册组件 + AI SDK mock |
| 升级风险 | 低 | 0.x 版本，API 可能变 | 0.x，且受确定性重放约束 | 0.x + AI SDK 大版本 |

可直接用于判断的事实：
- 首个场景的一次协商是有限轮次的"代理回合"序列，每回合一次 Claude 调用加确定性校验；等待人审批可能持续数天，但等待本身只是状态行，不需要进程挂起。
- 组件的重试只解决"调用失败后再试"，不解决"迟到结果必须被拒绝"——无论选哪条路，提交结果的 mutation 都要校验 run 状态与约束版本。
- workflow 的确定性约束意味着工作流 handler 内不能读 `process.env`、不能 `fetch`，Claude 调用必须放在 `step.runAction` 里；而 workflow 代码改动会让在途实例失败，这对"规则或协议频繁迭代"的阶段是实际成本。
- workpool 的 `maxParallelism` 是对全局 Anthropic 速率限制的一个简单保护；rate-limiter 则适合按用户/房间/每日 token 预算做业务限流。

## §2 对设计的直接含义

1. 任选哪条路，"提交 Claude 结果"的 mutation 都必须做过期拒绝：run 已作废、约束版本已变、回合序号不匹配时丢弃结果（只记录用量与原因）。
2. 若自建：需要 `agentRuns` / `agentAttempts`（或同义）表、单活跃 run 唯一性检查、指数退避的重试调度、watchdog 超时 mutation、取消时 `scheduler.cancel` 尚未开始的调度并把 run 标记为作废。
3. 若采用 workpool/action-retrier：Claude 调用仍要包成"重复执行不产生重复业务写入"的 action（幂等提交键 = runId + turnIndex + attempt），`onComplete` 里做状态迁移。
4. 若采用 workflow：工作流 handler 只做编排；所有读环境变量、调 Claude 的逻辑在 action 步骤；规则版本升级前需排空在途工作流或接受失败重启。
5. agent 组件与已定技术栈冲突，采用前需在 18-decisions 中单独立项决策。
6. 限流（每用户触发次数、每房间每日 token）可用 rate-limiter，也可用自有计数表；两者都应与 mutation 同事务。
