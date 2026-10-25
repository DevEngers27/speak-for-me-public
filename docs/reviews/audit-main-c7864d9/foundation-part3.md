# 审计：wave-0 地基（part3：偏离清单）

计数（63 条）：satisfied 27、deviates 15、not_implemented_yet 19、unverifiable 2。无 blocker：没有发现违反八条核心的代码；最重的是会被后续任务当契约抄走的边界与单一来源问题。

「设计后移」= 本块合并后设计才改，修法是同步。

## AUD-FOUNDATION-01 · high · 错误边界吞掉规范化错误
- 条目：D16、INV-13、canon §1.5、11 §11.6。
- 证据：convex/lib/errors.ts:114-127 只放行 `{code:'UNAUTHENTICATED'}`，其余 ConvexError 一律变 `{code:'internal'}`，所以 `approval.stale{currentConstraintsVersion}`、`run.rate_limited` 之类永远到不了浏览器（D02 的「刷新后重批」无法实现）；errors.ts:34 未知 / 非 ConvexError 兜底为 `run.invalid_state`，canon 要求 `internal`；无 `opsLog('unhandled',{errorClass})`；convex/engine/auth.ts:13 抛大写 `UNAUTHENTICATED`（canon 用 `auth.unauthenticated`，大写已废弃）。tests/foundation/errors.test.ts:44-53 锁定 `run.invalid_state` 兜底。
- 修法：按 11 §11.6：`code ∈ ERROR_CODES` 且 params 已按受众裁剪的 ConvexError 原样抛出；其他异常 `opsLog('unhandled',{fn,errorClass})` 后抛 `internal`；`toPayload` 兜底改 `internal`；改用 `auth.unauthenticated`；改测试。
- 归属：W1 函数构造器任务（`userQuery`/`memberMutation`，11 §11.6），须在第一个业务 mutation 之前。

## AUD-FOUNDATION-02 · high · reasonCodes 单一来源落后于 canon §1.5 / 06 §6.3 / 12 §12.4（设计后移）
- 证据：core/engine/reasonCodes.ts:21-27,47-53 缺 `item.limit_exceeded`、`approval.not_executable`；无 `API_ERROR_CODES`（13 个）与 `ERROR_CODES`；:187 `retryAfterMinutes`（应为 `retryAfterMs`，12 明写不用分钟）；无 `caller`/`projectedCodes` 受众类，:276 provider 恒为空集，与 06 §6.3「provider 作为调用者照收」冲突。reasonCodes.test.ts:58 锁旧列表。
- 修法：照 06 §6.3 代码块同步：补码、补 API 码与不相交断言、加 `caller`/`projectedCodes`，provider 只对检查结果类参数清空。
- 归属：reasonCodes 同步任务（W1 API 任务之前）；12 §12.4 对账测试 T06-S4。

## AUD-FOUNDATION-03 · high · 网关拒绝 05 §5.13 规定的中途 system 消息
- 证据：modelGateway.ts:614 对 `role:'system'` 抛错、:672 要求末条为 user；modelGateway.test.ts:196 锁定。05 §5.13.1 / P15 与 10 §10.14.1 的请求体以 `{role:'system', content: turnInstruction}` 作为唯一 user 消息之后的最后一条。
- 修法：允许且仅允许一条紧跟唯一 user 消息的末尾 system 消息（同 10 §10.14.1 `assertWhitelisted`）；若决定走 05 §5.13.2 退路（`<turn_instruction>` 文本块），先发设计变更通知，不要让 W2 默默改用退路。
- 归属：W2 提示词 / runtime 任务；05 V3 真实部署验证。

## AUD-FOUNDATION-04 · high · 网关路径与接缝不唯一
- 证据：convex/agents/modelGateway.ts + convex/lib/modelGateway.ts 再导出，api.d.ts:15,22 两个模块；:2717-2719 三个导出名。canon D21、11 §11.3、10 §10.14.1 规定 `convex/model/agents/modelGateway.ts`，因为 `convex/agents.ts`（`agents.runAttempt/watchdog/loadTurnContext`）不能与 `convex/agents/` 并存；16 TD-03 写 `convex/agents/`。
- 修法：先改 16 TD-03 与 canon 一致，再把网关移到 `convex/model/agents/`，删除 lib 再导出与 `callStructured`，`vi.mock` 目标只留一个。
- 归属：W2 agents runtime 任务（建 `convex/agents.ts` 之前）；设计：16 TD-03。

## AUD-FOUNDATION-05 · medium · 网关结果词汇与 03 / 10 §10.15 不对齐
- 证据：modelGateway.ts:948-960 `TransportErrorCode`（rate_limit/overloaded/timeout/server_error/network/invalid_request/not_found/aborted/unknown）≠ `AttemptErrorCode`（transport/model_timeout/bad_request/model_not_found/quota_exhausted/config_invalid/api_error/internal…）；超时的 `attemptStatus` 是 `'error'`，canon §1.3 / 04 A5 应为 attempt `timeout`；413 记 `context_overflow`（设计 `bad_request`）；billing_error 落 `invalid_request`（设计 `quota_exhausted`）；非 SDK 异常记 `unknown`（设计 `internal`）；`retryable` 对 invalid_output / 5xx / 529 为 false，而 10 §10.10.2 在 attempt 层各重试一次，语义未定义；:1765 本地 `AttemptStatus` 与引擎同名且是子集。
- 修法：导出 `toAttemptOutcome(result) → { status: AttemptStatus(引擎), errorCode: AttemptErrorCode }`；`retryable` 改名为 `gatewayRetried` 一类、只表达网关内部，attempt 层只信 `decideRetry`。
- 归属：W2 `turns.fail`/`decideRetry`；随 CN-001 改 10。

## AUD-FOUNDATION-06 · medium · 截断重试被 230 s 预算吞掉；每次调用最多 3 次发送
- 证据：modelGateway.ts:2055 总预算 ≤230 s，:2426 截断后 `continue`；首发 16 000 token 截断约耗 200 s+20 s，重试只剩约 10–30 s，超时后 :2290-2349 返回 `error/timeout`，`output.truncated` 只留在 attemptLogs。每次调用最多 1 + 429/连接重试 + 截断重试 = 3 次发送，10 §10.10.1 的 I4（每链 ≤4 次 HTTP）与 attempt 的 `reservedMicroUsd`（按单次 maxTokens 估算）都不再成立。
- 修法：剩余预算不足一次完整流时不发截断重试，直接返回 `output.truncated`；重试因预算失败时仍报 `output.truncated`；应用 CN-001 时重算 I4 与单 attempt 预留（至少两次满输出）。
- 归属：CN-001 应用（10 R11/§10.11/§10.12）；W2 `turns.beginAttempt` 预留。

## AUD-FOUNDATION-07 · medium · 网关不校验 schema；测试样例违反 canon §1.4
- 证据：assertWhitelisted 只要求 schema `type:'object'`（:590-600）；modelGateway.test.ts:38-70 的标准样例无 `{turn}` 根、含 `totalPriceCents`、`includedItemKeys`、动作 `accept`。
- 修法：`buildRequest` 调 `assertNoForbiddenPropertyNames` 并检查根 `{turn}`（或只收 `toStrictOutputSchema` 的品牌类型）；样例改为 `{turn: AgentModelOutput}`。
- 归属：W2 outputSchema 任务。

## AUD-FOUNDATION-08 · medium · itemKey 语法没有单一来源
- 证据：canon §1.2 `^[a-z][a-z0-9_]{1,39}$`（rules/checkProposal.ts:24 用它）；keys.ts:3 `^[A-Za-z0-9_-]+$`；publicText.ts:56 `^[a-z][a-z0-9_]{0,31}$`；fixtureSchema.ts:90 `^[A-Za-z][A-Za-z0-9_-]{0,63}$`；keys.test.ts:6 锁 `LOGIN+REPORTS@rush`。失败场景：35 字符的合法 itemKey 通过规则，进 `renderPublicText` 时 token 槽抛 `INVALID_SLOT_VALUE`。
- 修法：引擎导出唯一 `ITEM_KEY_RE`（canon 正则），keys / publicText / fixtureSchema / convex validator 共用；测试改用 canon 例。
- 归属：引擎同步任务；W1 catalog 写入口。

## AUD-FOUNDATION-09 · medium · schema 落后于当前 03，并缺两项 canon 值
- 证据：schema.ts:373-412 attempts 缺 8 个字段、多 `outputSha256`（:404），`schemaVersion` 必填；:567-572 spendCounters 缺 `attempts`/`unknownCostAttempts`；:199-200 rooms 缺 `by_followsExecutionId`；:82 缺 `scenario_migrated`；:104 `disclose` 缺 `toRoles`；schemaTypes.ts:21-39 同步旧值；tests/schema/contract.ts 锁旧契约。另 :358 `waitingReason` 缺 `run_cap`（canon D06/D07/D12 ⑥/D17、04 §4.3.1）、:99-109 缺 `pass_to_next{toRole}`（canon D15、04 R21），这两项 03 也漏了。
- 修法：按当前 03 做 schema 增量并更新 contract.ts；先在 03 补 `run_cap` 与 `pass_to_next`。
- 归属：schema 增量任务（W0-4 后续）；设计：03。

## AUD-FOUNDATION-10 · medium · 公共模板默认目录是非 canon 示例；缺免责声明模板
- 证据：publicText.ts:1468-1537；`constraints_updated` room 变体写出变化的 itemKey，与 D14「provider 只见 Constraints changed」冲突；`severity` 不是 canon 概念；`renderPublicText` 默认用它（:1621-1660）；无 `change_order_disclaimer`（INV-61）。
- 修法：引擎默认目录只放引擎级模板（含 `change_order_disclaimer` 原文），示例移到测试；场景模板按 14 写进插件 `templates`。
- 归属：W1/W3 模板任务（14、13 变更单）。

## AUD-FOUNDATION-11 · low · fallback 实现与 10 §10.14.3 不同
- 证据：modelGateway.ts:33-34,434-442：beta 头 `ModelFallbacks-2025-11-11`、`fallbacks:['claude-sonnet-5-5']`，可经参数或 `MODEL_FALLBACKS=on` 打开；设计为 `server-side-fallback-2026-07-01`、`fallbacks:'default'`，v1 启动检查拒绝 `on`。
- 修法：v1 硬拒 `on`；等 spikes §8 #16 后按 10.14.3 实现。归属：W2 runtime。

## AUD-FOUNDATION-12 · low · 网关遥测缺口与 AbortSignal 退路
- 证据：toUsageRecord（:342-368）无 `thinkingTokens`（03 `usageV` 必填）；不读 `stop_details.category`；成本按请求模型而非 `msg.model`；:2114-2116 直接用 `AbortSignal.timeout/any`，无 10 §10.11 的退路（V4 未验证）。
- 修法：补字段与退路；V4 在真实部署验证。归属：W2 runtime + spikes §8。

## AUD-FOUNDATION-13 · low · strictSchema 静默放过 `z.record`
- 证据：strictSchema.ts:256-302 遇到值为 schema 的 `additionalProperties`、无 `properties` 时输出空对象，不抛错（INV-04 禁 `z.record`）。
- 修法：`additionalProperties` 非 false、或出现 `patternProperties`/`propertyNames` 时抛 `StrictSchemaError`。归属：W2 outputSchema 或引擎小修。

## AUD-FOUNDATION-14 · low · `actionAllowed` 在缺 reasonKey 时放行 provider reject
- 证据：actions.ts:197-206；actions.test.ts:128 只测「提供了 reasonKey」。canon §1.4：provider 在 propose 回合只能 `cannot_deliver`。
- 修法：缺省视为不允许，或强制传 reasonKey。归属：W2 `allowedActions`。

## AUD-FOUNDATION-15 · low · canon D09 正文与 CN-001 不一致（设计文档）
- 证据：CN-001 称代码遵循 D09，但 D09 仍写 SDK `maxRetries: 1` 并列出 529/5xx/408/409；代码 SDK 0、网关只重试 429/连接，529/5xx 在调用内从不重试。11 §11.11 同样过时。
- 修法：CN-001 的修改范围扩到 canon D09 与 11 §11.11，并写明 529/5xx 由 attempt 层按 10.10.2 重试。归属：设计（canon D09）。

## AUD-FOUNDATION-16 · low · lint 与依赖基线未齐
- 证据：eslint.config.mjs 缺 L6（SDK 只在 model/agents）、L7（convex `no-console`，INV-13）、L8/L9/L11 与 `arch:check`；catalog 无 `@anthropic-ai/sdk 1.1.0`、`convex-helpers`；package.json 的 Playwright / `@clerk/testing` 不走 catalog。
- 修法：现在补 L6/L7；L8 随写门面；SDK 随 live transport 加入。归属：W1 工具链 / W2 runtime。

## AUD-FOUNDATION-17 · low · 卫生
- 证据：网关头注释「Opus 4.6 … convex/lib/modelGateway.ts」、EFFORT 注释过时；测试名仍写 `maxRetries: 1`、「timeout/529」；convex/engine/tables.ts 与 schema 冲突的占位 users 表、convex/scenarios/scopeChange/tables.ts 都在部署图里；`REDACTABLE_FIELDS` 两份（schemaTypes.ts、core/engine/events.ts）；publicText 自带 `IsoDate` 品牌；`health.whoami` 返回 `tokenIdentifier`（03：永不进 DTO）；ops 配置描述说 seed provenance 可为 `live`。
- 修法：逐项清理。归属：任意 W1 小修。

## AUD-FOUNDATION-18 · low · W0R-09 在 main 上仍是 partial
- 证据：tests/battery/** 全部 `it.todo`；`reconcileBattery().ok === false` 被测试断言为预期，CI 绿不证明任何 INV/CE。
- 修法：各波任务按 16 §16.11 把对应 CE 改成会失败的断言；CI 摘要显示未覆盖数。归属：各章实现任务（16 TD-13）。
