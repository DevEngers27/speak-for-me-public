# 15 · 运维（part3）：可观测性、用量与成本

## 15.6 可观测性

### 15.6.1 事实来源与旁路

| 来源 | 地位 | 内容 |
| --- | --- | --- |
| `events` | 事实（只追加，`(roomId, commitTs, seq)` 全序） | 领域事件；payload 只含房间可见字段，私密细节经 `restrictedRef`（D14） |
| `attempts` | 事实（用量账本，canon §1.1） | 每次模型调用一行：状态、usage、`stopReason`、`requestId`、`schemaVersion`、耗时；成败、迟到都记 |
| `constraintRevisions` | 事实 | 每次 cv 递增的 `cause`、`actorUserId`、`sourceRefs` |
| `opsLog` 结构化日志 | 旁路 | 白名单字段的运行信号 |
| Convex 平台日志 / insights、Sentry、Anthropic Console | 旁路 | 耗时、OCC、调度延迟、错误聚合、账单 |

追溯与计量只信前三者；日志流"尽力投递、可能丢、可能重"，只用于排障与告警（核心 6、8）。

### 15.6.2 日志纪律（D16）：两个 logger 的唯一定义

07 §7.19 E1–E3、08、10 §10.20、11 §11.6 与 03 只引用本节；三份旧 `SafeLogFields` 已合并为这一份（privacy-10）。

```ts
// convex/lib/opsLog.ts —— convex/ 下唯一允许 console.* 的文件（11 L7）
declare const internalCtxBrand: unique symbol;
export type InternalCtx = { readonly [internalCtxBrand]: true };   // 只由 sysQuery / sysMutation / sysAction / userAction 构造器注入（11 §11.6）

// ① 内部 logger：只在 internal 函数与 action 中可调用（公开构造器的 ctx 没有 InternalCtx，编译不过；11 L11 兜底）
export type OpsLogCode =
  | "unhandled" | "config_invalid" | "draining_set" | "stuck_run" | "react_depth_exceeded"
  | "model_call" | "attempt_failed" | "rate_limited" | "spend_deferred" | "seed_reset" | "restore" | "alert"
  | "turn_commit_threw" | "constraints_drift" | "cache_miss_unexpected"          // 10 §10.20 的告警码
  | "state.illegal_transition" | "reconcile.finding" | "plugin_contract" | "rule_integrity"
  | "request.no_relaxation" | "turn_attempt_limit" | "room_force_closed";        // 04 / 06 / 08 / 12 §12.20 的内部路径码
type SafeValue = IdString | SafeEnum | number | boolean;          // 无自由 string：SafeEnum 是闭集品牌类型
export type SafeLogFields = Partial<Record<SafeFieldName, SafeValue>>;  // 字段名本身也是白名单（下列）
export function opsLog(ctx: InternalCtx, code: OpsLogCode, fields: SafeLogFields): void {
  console.log(JSON.stringify({ code, ...pickAllowed(fields) }));    // 运行时复核：未知字段、非有限数直接丢弃
}

// ② 公开 logger：公开 query / mutation 路径上唯一允许的日志（它会随 logLines 进入调用者浏览器，07 §7.19.1）
export type PublicOpsCode =
  | "unhandled"                              // withSanitizedErrors：非 ConvexError 异常（11 §11.6）
  | "approval.not_executable"                // 08 S11 纵深防御命中（12 §12.4 / §12.15 ⑨）
  | "approval.self_conflict" | "view.vacant_slot"   // 08 §8.6.6：rooms.view 的防御性槽位
  | "invariant.open_request_at_execution"    // 08 X14：执行事务内发现 open 请求
  | "invariant.guard_bypassed" | "invariant.room_already_executed" | "invariant.duplicate_execution"   // 08 A7 / X1–X3：执行守卫已过却命中（fail closed，抛 internal）
  | "invariant.approval_seq_duplicate" | "invariant.execution_plan"   // 08 §8.4.1 ApprovalInvariantError / §8.4.4 ExecutionPlanError（A10、X5）：转 internal
  | "request.effect_noop" | "request.answer_converged"   // 12 §12.14：约束效果未改投影 / 重复回答收敛
  | "shared_fact.audience_violation"         // 03 §3.6 appendSharedFact 写入断言
  | "rule_integrity";                        // 06：amount.claim_mismatch 等缺陷信号（human_choice 物化在公开路径）
export function publicOpsLog(code: PublicOpsCode, f: { fn: PublicFnName; errorClass?: ErrorClassName }): void {
  console.log(JSON.stringify({ fn: f.fn, code, errorClass: f.errorClass ?? null }));   // 恰为三个键，不收数值、不收自由字符串
}
```

- `SafeFieldName` 白名单（与 10 §10.20 一致，唯一一份）：`roomId`、`runId`、`turnId`、`attemptId`、`role`、`kind`、`attemptNo`、`origin`、`status`、`reasonCode`、`errorCode`、`httpStatus`、`latencyMs`、token 分项、`costMicroUsd`、`provenance`、`schemaVersion`、`promptVersion`、`staleGuard`、`why`、`count`、`severity`；禁止提示、上下文、模型原文、`rationale`、简报字段、提案金额与请求头。
- 公共 query / mutation 的 `logLines` 会随响应下发到调用者浏览器（dev 已实证，prod 待验证 §8 #11）。因此公开路径只用 `publicOpsLog`，输出行的键集合恰为 `{ fn, code, errorClass }`、`code ∈ PublicOpsCode`（16 S6 / TC-PRIV-16 断言）；带 `runId`、`attemptId`、token 数的日志只出现在 internal 函数与 action 中。被公开与内部路径共用的 `convex/model/**` helper 由调用方传入 `InternalCtx | null`，为 `null` 时只发 `publicOpsLog`（11 §11.6）。
- 告警（§15.6.4）同时匹配两种行：`opsLog` 的 `code` 与 `publicOpsLog` 的 `code`。
- 永不记录：简报内容、`rationale`、模型原文（只存 `attempts.rawOutputRef` 指向的内部存储，无 query 暴露）、错误 `message` / 堆栈（`JSON.parse` 的报错会带出输入前若干字符，observability review r02 实测）、SDK `APIError.message`（可能回显请求）、`authorization` 头。Zod 失败只记 issue 路径，未知段替换为 `*`。
- dashboard 日志只保留有限数量、可能随时清除（Convex debugging 文档，review r06），不当作长期记录。

### 15.6.3 错误追踪

Next 侧 `@sentry/nextjs` 11.6.0（满足"发布 ≥ 2 周"，techstack D30）。文件：`instrumentation-client.ts`、`sentry.server.config.ts`、`instrumentation.ts`（导出 `onRequestError`）、`app/global-error.tsx`、`next.config.ts` 用 `withSentryConfig` 包裹；`SENTRY_AUTH_TOKEN` 只在构建环境（上传 source map）。

```ts
import * as Sentry from "@sentry/nextjs";
import type { DataCollection } from "@sentry/core";   // 类型路径以安装版本为准（V8）
const dataCollection = {
  userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
  stackFrameVariables: false, frameContextLines: 0, databaseQueryData: false,
  graphQL: { document: false, variables: false }, queues: false, genAI: { inputs: false, outputs: false },
} satisfies Required<DataCollection>;   // SDK 新增类别时类型检查报缺键
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_DEPLOYMENT_TIER,
  dataCollection,
  integrations: (defaults) => defaults.filter((i) => i.name !== "Console"),
  beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
  // 不设 tracesSampleRate / tracesSampler（v1 不做追踪，设 0 不等于关闭）；不加 replayIntegration；v11 已删除 enableLogs
});
```

- v11 未写的 `dataCollection` 键默认全开（含栈帧局部变量，会把服务端组件持有的私密字段带出去），所以每个键显式关闭（review r01）。Sentry 项目侧另开服务端 Data Scrubber 与"清除 IP"。若启用 `tunnelRoute`，该路径必须排除出 `proxy.ts` 的 matcher。
- Convex 侧：Pro 的 exception reporting 指向同一 Sentry（平台 Node.js）；Convex 自动附 `user = tokenIdentifier`（假名化 ID，写进隐私说明）。所有入口都经 `withSanitizedErrors`，到达平台的只有 `ConvexError({ code: "internal" })`；`ConvexError` 是否被上报待验证（V9）——不上报也可接受，`unhandled` 信号经 `opsLog` 与告警可见。

### 15.6.4 日志去向与告警

- dev / preview：dashboard 与 `npx convex logs`。
- prod：Convex log streams → Axiom（D31，采购项，U9；默认采购、只接 prod）。使用的主题：`console`（`opsLog`）、`function_execution`（耗时、状态、OCC、`error_message`）、`audit_log`（部署与环境变量变更）、`scheduler_stats`（`lag_seconds`）、`concurrency_stats`、`verification`。
- Axiom 告警规则保持个位数：① `function_execution` 错误率；② `scheduler_stats.lag_seconds` 持续升高；③ `code ∈ {stuck_run, config_invalid, unhandled, react_depth_exceeded, constraints_drift, approval.not_executable, approval.self_conflict, invariant.open_request_at_execution, invariant.guard_bypassed, invariant.room_already_executed, invariant.duplicate_execution, invariant.approval_seq_duplicate, invariant.execution_plan, shared_fact.audience_violation, rule_integrity}`（`opsLog` 或 `publicOpsLog` 行）任意命中；④ `audit_log` 中 prod 环境变量变更（任何一次都通知）；⑤ 1 小时内 `attempt_failed` 中 `invalid_output` 占比 > 20% 或 `stale` 占比 > 30%；⑥ `spend_deferred` 任意命中。阈值按比例而不按绝对数（日志流可丢可重）。
- Convex `usage-limits`：prod 设 `warning`，dev / preview 设 `disable`（超限暂停部署）。Anthropic workspace 花费上限通知发到值班邮箱。
- 不接 Axiom 时（退路）：`ops.livenessSweep` 每次运行顺带从 `attempts` / `runs` 计算 ②③⑤⑥ 的计数，超阈值写 `opsLog("alert", { kind, count })`；可选一个 internal action 把 `{ kind, count }` POST 到团队 webhook（不含任何业务数据）。缺少的只是平台级函数耗时与 OCC 指标。

### 15.6.5 隐私核查（日志与遥测的金丝雀扫描）

- **采集**（testing-ops review r07）：`npx convex logs --jsonl` 是永不退出的轮询流，`--history` 只回放服务端缓冲。做法：流程**开始前**后台启动采集到文件 → 跑金丝雀 fixture 全流程（14 的 canary 变体）→ 结束后等约 10 秒 → 结束子进程 → 交给 `testing/canary` 扫描。记录条目数与时间范围，**条目数为 0 判失败**（防假绿）。
- **扫描面**：`console` 行、`function_execution.error_message`、Sentry 事件 JSON（V7 用 API 导出）、E2E 收集的 HTML 与 WebSocket 帧、query 响应的 `logLines`。
- **针脚**：字面金丝雀（三方 `CANARY-*` 串、奇数美分如 `481237`）+ 派生数值（`cap − committed`、`提案金额 − cap`、`cap − 各可行组合总价`，含两位小数与百分比写法，testing-ops review r12）；数值按数字边界匹配 `(?<![0-9.])needle(?![0-9])`，扫描前剔除 `_creationTime`、`commitTs`、`_id` 的值（r13）。fixture 先过 `lintCanaries`，保证金丝雀不与任何公开值相撞。
- **频率**：`nightly` 在 `ci-dev` 上每晚一次；prod 每周与每次发布后跑一次"预算数字扫描"：脚本以 admin 身份在内存中读取当前房间的上限与已承诺额，扫描最近 24 小时的 Axiom 日志与 Sentry 事件，只输出命中计数，从不打印值。任一命中 → 立即停掉对应集成（dashboard 一键关闭），按 §15.13 处置。

### 15.6.6 指标（`ops.metrics`，12 §12.20）

| 指标 | 计算 | 用途 |
| --- | --- | --- |
| `turnLatency` p50 / p95 | `attempts` 耗时，按 role × turnKind × mode 分组 | 校准 10 的 `sdkTimeoutMs`，不进入任何守卫 |
| `timeToFirstProposal` | `run_started` 到 `proposal_created` 的事件时间差 | 端到端体验 |
| `tokens` | input / cacheCreation / cacheRead / output 分项求和 | 成本与缓存 |
| `cacheHitRate` | live attempt 中 `cacheRead > 0` 的占比 | 发现静默失效的提示缓存 |
| `invalidOutputRate` / `staleRate` / `refusalRate` / `watchdogErrorRate` | 按 attempt 终态计数 | 提示、schema、超时参数的回归 |
| `needsInputRate` / `endedNoAgreementRate` | 按 run 结局计数 | 产品指标 |
| `spendEstimate` | §15.7 的估算逐行求和，标 `estimate: true` 与 `asOf` | 与供应商账单对账，不作计费依据 |
| `runningAttempts` / `negotiatingRuns` | 状态计数 | 排空 |
| `liveRoomsByScenarioVersion` | 非终态房间按 `scenarioKey@scenarioVersion` 计数 | 删除旧场景版本前的发布检查（§15.5.1） |

所有指标都附样本量 `n` 与失败数；未测量之前不对外陈述任何改进百分比。

## 15.7 用量与成本

- **账本**：`attempts` 的 usage 字段（`inputTokens`、`cacheCreationInputTokens`、`cacheReadInputTokens`、`outputTokens`、`thinkingTokens`）、`model`、`effort`、`requestId`、`provenance`，以及结算时写一次的估算 `costMicroUsd` 与 `priceTableAsOf`（03 §3.8、10 §10.12.2）。迟到或被判 `stale` 的结果同样记录用量（真实发生了费用，`lateUsage: true`）；用量字段只从空写成值，重复调用不重复计数。没有响应的 attempt（超时、传输错误）实际成本未知：释放预留、单列"未知成本"，不编造金额（核心 8）。stub attempt 用量为 0、`model: "stub:v1"`。
- **价目表**（`convex/model/agents/pricing.ts`；结算时用当时的表估算并把 `asOf` 写进 attempt，价目表更新不回溯改写历史行，`ops.metrics` 可另按当前表重算对比）：

```ts
export const PRICE_TABLE = {
  asOf: "2026-10-06",      // 来源 Anthropic 定价；实现当天按官方定价页复核并更新 asOf
  models: {
    "claude-opus-5-5": {
      inputMicroUsdPerMTok: 4_000_000,         // $4.00 / MTok
      outputMicroUsdPerMTok: 20_000_000,       // $20.00 / MTok；思考 token 按输出计费
      cacheReadMicroUsdPerMTok: 200_000,       // $0.20 / MTok
      cacheWrite5mMicroUsdPerMTok: 5_000_000,  // 输入价 × 1.25（倍率待核对）
      cacheWrite1hMicroUsdPerMTok: 8_000_000,  // 输入价 × 2（倍率待核对）
    },
  },
} as const;
export function estimateCostMicroUsd(u: Usage, model: string):
  { microUsd: number; asOf: string; estimate: true } | null;   // 每 attempt 向上取整到整数微美元；未知模型返回 null，单列"未知成本"
```

- **上限四层 + 兜底**（D17；stub 不受成本层影响）：

| 层 | 默认值 | 真相源 | 超限行为 |
| --- | --- | --- | --- |
| 每用户每房间节流 | `constraint_writes` 6 次 / 小时 | `events.by_room_actor` | 公开 mutation 抛 `run.rate_limited` |
| 每 run attempt 上限 | `maxRounds × 3 × 2` = 18（live 与 stub 都计，防死循环） | `runs.attemptCount` | 回合 `failed`，run → `needs_input` + customer 的 `rounds_exhausted` 请求（`questionKey: call_limit`，选项 `choose_candidate` / `end_run`，12 §12.18、§12.25 Q12） |
| 每 run 美元预留 / 结算 | `RUN_MAX_MICRO_USD = 3_000_000`（$3）；每次预留 `RESERVE_MICRO_USD` = `INPUT_TOKENS_RESERVE`（12,000）× 输入价 + `max_tokens`（16,000）× 输出价（约 $0.37，10 §10.5.2） | `runs.reservedMicroUsd` / `spentMicroUsd` | 不调度下一 attempt，run → `needs_input`（同上，`questionKey: spend_limit`） |
| 全局日美元 | prod `15_000_000`（$15 / UTC 日，约为月预算日均的 1.5 倍）；dev `5_000_000` | `spendCounters(global, day)` | 被调度路径返回 `deferred`，`runAfter` 到次日 UTC 零点；回合状态不变、记 `waitingReason: "spend_deferred"`，不写事件（只给本方界面 "Agents paused until tomorrow"），`opsLog("spend_deferred")` 触发告警 ⑥（10 §10.4.5、12 §12.18） |
| Anthropic Console 花费上限 | dev $100 / 月，prod $300 / 月（U5） | Anthropic | API 报错 → attempt `error` → `agent_failed` |

  `runs.*MicroUsd` 与 `spendCounters` 是护栏计数器，用同一个 `estimateCostMicroUsd` 结算，不是计费账本；价目表更新不回溯。默认值在 §8 #15（真实 token 量与拒绝率）跑完后校准。最坏情况每 run 18 次 attempt × 每次至多 2 个 HTTP 请求（`maxRetries: 1`）；SDK 内部重试的失败请求是否计费待验证（§8 #16）。
- **对账**：每周用 Anthropic Admin API `cost_report`（按 workspace / model 的日成本）与 `spendEstimate` 比较。前置条件：需要 Anthropic 组织（个人账户不能创建 Admin key）；`cost_report` 不含 Priority Tier、只能按 workspace 分组、不能按 key 过滤；CI 用 `org:admin` 联合身份，不存长期 Admin key；Admin key 永不进 Convex（techstack D35）。偏差 > 10% 时先查价目表 `asOf` 与重试计费。没有 Anthropic 组织时只做估算，不对账（U9 可选项）。
