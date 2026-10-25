# 10 代理运行时（part6）：用量与成本、缓存验证、stub 与故障注入、简报抽取、可观测性

> 分片清单见 part1。

## 10.19 用量与成本记录

**唯一真相源**：`modelCalls`。每行一个真实请求（或一次 stub 计算），字段见 03 §3.4。`normalizeUsage(u)` 的映射：

| `modelCalls.usage` 字段 | SDK 来源（inputs/04 §4.8） |
| --- | --- |
| `inputTokens` | `usage.input_tokens`（仅未缓存部分） |
| `cacheCreationInputTokens` | `usage.cache_creation_input_tokens ?? 0` |
| `cacheReadInputTokens` | `usage.cache_read_input_tokens ?? 0` |
| `outputTokens` | `usage.output_tokens`（含思考） |
| `thinkingTokens` | `usage.output_tokens_details?.thinking_tokens ?? 0` |
| `serviceTier` | `usage.service_tier ?? null` |

同行还有 `model`（请求）、`responseModel`（`msg.model`）、`effort`、`maxTokens`、`stopReason`、`requestId`、`messageId`、`latencyMs`、`attemptNo`、`retryReason`、`lateResult`。超时与传输错误没有 usage，记为缺省；它们是否计费待验证（#10），成本报表把它们单列为"未知成本的请求数"，不编造金额（核心 8）。

**成本估算**：不入库，读取时计算：`estimateCostMicros(usage, model, PRICE_TABLE)`。`convex/engine/pricing.ts` 导出 `PRICE_TABLE_VERSION`、`asOf` 与每个白名单模型的单价（初值取 inputs/04 §4.1：Opus 5.5 输入 4、输出 20、缓存读 0.20、5 分钟缓存写 5，单位 $/MTok），可被环境变量 `PRICE_TABLE_OVERRIDE`（JSON）覆盖。界面一律标注 "Estimated"，并显示价格表版本。

**聚合计数**：`usageCounters` 在 claim 时 `modelCalls += 1`（预占，live 才计部署级），在 record 时累加 token。行键：`{scope:"room", scopeKey: roomId, day:"total", shard:0}` 与 `{scope:"deployment", scopeKey:"*", day: "YYYY-MM-DD"(UTC), shard: 0..7}`。报表在查询里对分片求和。

**度量**（15 §15.4 的面板直接读取，样本量与失败一并显示，AC-14）：

| 指标 | 定义 |
| --- | --- |
| 每类回合延迟 p50 / p95 | `latencyMs`，只算 accepted 的 attempt；另列含重试的 turn 级耗时 |
| invalid_output 率、stale 率、重试率 | 按 outcome / status 计数 ÷ attempt 总数 |
| 缓存命中率 | `Σ cacheReadInputTokens ÷ Σ(input + cacheCreation + cacheRead)` |
| 每 run / 每次执行的估算成本 | 按 runId / executionId 回溯 attempt |
| 得到首个有效提案的时间 | run.startedAt → 首个 proposal.createdAt |
| 人工干预次数 | humanRequests 数 + 手动提案数 + resume 次数 |
| 硬约束违规拦截数 | 规则检查失败的提案评估次数（应只来自人为构造的测试或约束变化） |

## 10.20 缓存验证

- 常驻断言：同一 run、同一角色、round ≥ 2 的 accepted attempt，期望 `cacheReadInputTokens > 0`；为 0 时写 ops 日志 `CACHE_MISS_UNEXPECTED`（带 `promptCacheKey` 与 attemptId，不带内容）。
- 常见静默失效源在 part5 §10.16 已规避；另外注意 effort 在请求间变化会使 messages 段缓存失效（inputs/04 §4.2）——提议与评审 effort 不同，但它们的 system 段本就按角色不同，互不共享缓存，不受影响。
- 缓存只是成本与延迟优化，不影响正确性；命中率低于 30% 时才需要调查。

## 10.21 stub 模式与故障注入

**目的**：无模型额度的开发、确定性测试、演示降级（AR-16、F10.7）。

- 环境变量 `AGENT_MODE = "live" | "stub"`；房间创建时快照到 `rooms.agentMode`，run 创建时再快照到 `runs.agentMode`。live 模式但缺 `ANTHROPIC_API_KEY` 时，部署启动检查失败而不是静默改用 stub（fail-closed，P-28）。
- stub 走完全相同的路径：schedule → claim → (stub) → record → apply → watchdog。区别只在 action 第 4 步：`claim` 在 stub 模式下额外返回 `AgentContext`，`runStub` 调用场景的 `stubPolicy`，产出**扁平 JSON**，再经过与 live 相同的 Zod + 语义校验。
- 首个场景的 stub 策略（确定性，2 轮内收敛）：
  - 提议方：第 1 轮选场景排序第一的候选；之后若有评审 counter，选得到最多评审支持的候选（平局按排序）。
  - 评审方：按本方简报的软偏好给候选打分（14 §14.4 的 `scoreForRole`）；当前提案是本方最优、或已是第 2 轮及以后 → `recommend_accept`；否则 `counter` 本方最优，理由码由差异推出（如 `prefers_earlier_date`）。
- stub attempt：`model: "stub"`、usage 全 0、`latencyMs` = `STUB_LATENCY_MS`（默认 800，模拟异步界面）。stub 产生的提案 `agentMode: "stub"`，界面徽标 "Simulated agent"，事件 actor 带 `agentMode: "stub"`（核心 8）。
- **故障注入**（只在 `ALLOW_FAULT_INJECTION=true` 的非生产部署可用）：`rooms.testFaultPlan` 只能由 internal seed 函数写入，形如 `[{ round, roleKey, attemptNo, fault }]`。`fault ∈ transport_error | timeout_hang | rate_limit_429 | server_500 | bad_request_400 | auth_401 | billing | refusal | max_tokens | invalid_json | schema_violation | unknown_candidate | record_throw | apply_throw`。stub 遇到匹配项时返回对应 outcome（或在 record / apply 中抛错），使 F01–F28 全部可以在 convex-test 中确定性复现（16 §16.3）。`timeout_hang` 不真的挂起，而是不调用 record，配合假时钟推进到 watchdog。

## 10.22 简报抽取（可选模块，复用同一运行时）

- `extraction.request({ roomId, text })`（public mutation）：本人必须是房间参与者；`text` ≤ 8,000 字符；每个参与者同时至多一个进行中的任务。插入 `extractionJobs{status:"queued", inputText}` 与 `modelCalls{purpose:"brief_extraction"}`，并照常登记执行与 watchdog。
- 上下文只含：本角色的场景字段说明、本房间公开目录（用于把描述映射到 itemKey）、用户粘贴的文本（放在不可信数据标签内）。不含任何他方数据。
- apply：用场景 `BriefDraftExtraction` Zod 校验；未知 itemKey 丢弃并记警告；每个字段附 `sourceSpan`（≤ 120 字符的原文引用）。结果写入 `extractionJobs.resultDraft`，**无论成败都清除 `inputText`**（不保存原始粘贴文本，F02.8）。重试：transport / server / invalid_output 各 1 次。
- 结果从不自动生效：本人在简报页逐项查看并点 "Apply to draft"（调用 `briefs.saveDraft`），之后仍需显式确认（核心 4）。

## 10.23 可观测性钩子

- 运行时函数只输出白名单字段的结构化日志：`{ evt, roomId, runId, turnId, attemptId, turnKind, outcomeKind, status, httpStatus, latencyMs, inTok, outTok, cacheRead, retryClass }`。禁止输出提示、上下文、模型文本、简报字段、金额（07 §7.9；15 §15.5 的日志扫描验证）。
- 告警（ops 日志级别 error，供日志平台订阅）：`MODEL_BAD_REQUEST`、熔断打开、`APPLY_FAILED`、`INTERNAL_PRECONDITION`、巡检发现卡住的 run、部署当日调用量超过上限的 80%。

## 10.24 运行时相关的待验证项与实测计划

| # | 事项 | 影响 | 方法 | 结论回填 |
| --- | --- | --- | --- | --- |
| V1 | Convex action 最长运行时间（inputs/04 #1） | `ATTEMPT_TIMEOUT_MS` 上界 | 查 limits 文档 | 10.8 |
| V2 | SDK 1.1.0 在默认运行时的打包与请求（#4） | 是否需要 `"use node"` 文件 | 部署最小 action | 10.13 |
| V3 | Opus 5.5 在 medium / low 下的回合耗时（#5） | 超时、延迟目标、effort | 用首个场景 fixture 各跑 ≥ 10 次 | 10.8、10.12 |
| V4 | 嵌套 `anyOf` 可空写法、`enum` 解码约束、动态 schema 编译延迟（#6） | `SCHEMA_NULL_STYLE`、`CANDIDATE_ENUM_IN_SCHEMA` | 真实请求探测 | 10.15 |
| V5 | `fallbacks` 与 `output_config.format` 同用（#7） | 是否开启服务端回退 | 小实验 | ADR-16 |
| V6 | 并发插入同一索引区间是否触发 OCC（#2） | 单活跃 run、并行评审收尾、审批唯一性 | 真实部署并发脚本 | 04、08 |
| V7 | `_scheduled_functions` 中失败 mutation 的状态字段 | watchdog 判定 `APPLY_FAILED` | 故障注入 `apply_throw` | 10.6.6 |
| V8 | `billing_error` 对应的 HTTP 状态 | 错误映射 | 查错误码文档 | 10.18 |
| V9 | 超时请求是否计费（#10） | 成本报表口径 | 查定价文档 | 10.19 |
| V10 | 被调度函数是否带调度者身份（#3） | 设计已不依赖：runtime 函数只用 id 参数 | — | — |
