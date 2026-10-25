# 审计：wave-0 地基（part2：canon 决策与章节条目）

续 `foundation.md`。状态记法同前。

## 2. canon §1 与 D 条目

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| canon §1.2 键与 itemKey | D | core/engine/keys.ts:2-25；publicText.ts:56；convex/lib/fixtureSchema.ts:90 | 修订后 §1.2 要求 itemKey `^[a-z][a-z0-9_]{1,39}$`，例 `audit_log_export+sso_login@rush`。三处各写一套正则，都不是 canon；keys.test.ts:6 锁住旧例 `LOGIN+REPORTS@rush`。只有 rules/checkProposal.ts:24 用 canon 正则（设计后移）。AUD-08 |
| canon §1.3 状态 | S | core/engine/stateMachines.ts；convex/lib/validators.ts:64-111 | 九个状态集与终态集一致；validator 由同一数组派生并双向类型断言；`stale→active`（P5）与 04 §4.6 一致。测试：stateMachines.test.ts「stored status sets and terminal sets match canon §1.3」；schema.test.ts「%s.%s uses engine-derived validator」 |
| canon §1.4 动作与输出根 | S | core/engine/actions.ts:15-145；strictSchema.ts:51-69 | 六个动作、载荷形状、根 `{turn}`、引用字段例外表与修订版一致。测试：actions.test.ts「MODEL_ACTIONS matches canon §1.4」「payload types match」 |
| canon §1.5 reasonCode | D | core/engine/reasonCodes.ts:8-67,139-189,270-306 | 缺 `item.limit_exceeded`、`approval.not_executable`、13 个 API 码与 `ERROR_CODES` 并集；`run.rate_limited` 参数叫 `retryAfterMinutes`（12 §12.4 明写「毫秒，不用分钟」）；没有 06 §6.3 的 `caller` / `projectedCodes` 受众类，provider 作为调用者也拿不到自己的 `retryAfterMs`/`field`。reasonCodes.test.ts:58 锁旧列表（设计后移）。AUD-02 |
| D04 执行后房间 | N | stateMachines.ts:33-39；schema.ts:191-192 | `executed`/`closed` 终态无出边、`executionId`/`followsExecutionId` 在。写入拒绝与两项豁免（`openRoomTx({allow})`）归 W1/W3。schema 缺 `rooms.by_followsExecutionId`（AUD-09） |
| D05 递增矩阵 | N | schema.ts:265-282 | `revision`/`editNo` 字段在；`hardProjection` 比较与 bump 不在本块 |
| D06 约束变化后 run | S | stateMachines.ts:68-84,163-170 | R2（∅→pending_approval）、R7/R12/R16（→superseded）、P5（stale→active）都在表里。测试：stateMachines.test.ts「snapshot of every transition table…」。同事务限制由 `disposeCurrentRun` 负责（W2） |
| D07 守卫与 reconcile | N | schema.ts:351,357,387-389 | `turn.constraintsVersion`、`currentAttemptNo`、`watchdogFnId` 在；G0–G3、reconcile、看门狗未实现；`attempts.staleGuard` 缺（AUD-09） |
| D08 串行评估 | S | schema.ts:322-323 | 只有 `activeTurnSeq`，无屏障计数；TURN 机 `scheduled→running→…`。`resolveRound` 归 W2 |
| D09 模型输出路径 | D | convex/agents/modelGateway.ts | 已满足见 INV-42。偏离：中途 system 消息被拒（AUD-03）；路径（AUD-04）；结果词汇（AUD-05）；截断重试被预算吞掉、每次调用最多 3 次发送打破 I4 与成本预留（AUD-06）；不校验 schema（AUD-07）；fallback 实现与 10 §10.14.3 不同（AUD-11）；遥测缺 `thinkingTokens`/`stop_details`（AUD-12）；canon D09 正文仍写 SDK `maxRetries: 1`（AUD-15） |
| D13 公共文本 | D | core/engine/publicText.ts:1443-1537 | 机制满足（见 INV-05）。默认目录 `PUBLIC_TEMPLATES` 是非 canon 示例：`severity` 枚举、`constraints_updated` 的 room 变体写出变化的 itemKey（D14：provider 对约束变化只见 "Constraints changed"）、buyer 变体写 "Counterparty"；`renderPublicText` 默认用它；缺 `change_order_disclaimer`。AUD-10 |
| D16 日志与错误 | D | convex/lib/errors.ts:34,87-127；convex/lib/functions.ts | 见 INV-13。11 §11.6 的写法是「规范化 payload 原样抛出、其余 opsLog + internal」；现实现反过来吞掉规范化错误、对未知异常给 `run.invalid_state`。tests/foundation/errors.test.ts:44-53 锁定兜底码。AUD-01 |
| D17 上限与排空 | D | schema.ts:325-329,358,559-572 | `maxAttempts`/`reservedMicroUsd`/`spendCapMicroUsd`/`opsFlags`/`spendCounters` 在；缺 `waitingReason: run_cap`（AUD-09）；网关每次调用最多 3 次发送，`reservedMicroUsd` 按单次 maxTokens 估算会不足（AUD-06） |
| D18 seed / reset | N | scripts/convex-ops.config.json；scripts/lib/convex-ops.mjs:96-133 | CLI 拒 prod、破坏性操作要求部署名确认、默认 `provenance: seeded`；`seed.fromFixture` / `seed.reset` 内部 mutation 与 `assertTier` 未实现。CLI 描述写 provenance 可为 `live`（AUD-17） |
| D19 前端 | N | — | 本块不含前端；`src/` 的 mock 脚手架属 W1-6，未审 |
| D20 依赖与冷却 | S | pnpm-workspace.yaml；package.json；scripts/check-dependency-policy.mjs；.github/workflows/ci.yml:31-33 | 基线版本逐项一致、`minimumReleaseAge: 10080`、`allowBuilds` 只放行两项、例外清单 14–28 天到期（W0-F-r03 已修）、CI 离线 codegen 漂移检查。缺 `@anthropic-ai/sdk 1.1.0` 与 `convex-helpers`（后者有手写退路）；Playwright / `@clerk/testing` 精确锁定但不走 `catalog:`（AUD-16） |
| D21 仓库布局 | D | convex/agents/modelGateway.ts；convex/lib/modelGateway.ts；convex/_generated/api.d.ts:15,22 | 单包布局、`@core/*`、引擎纯度规则满足。网关在 `convex/agents/`，D21 / 11 §11.3 / 10 §10.14.1 规定 `convex/model/agents/`，理由是 `convex/agents.ts`（注册 `agents.runAttempt`）不能与 `convex/agents/` 目录并存；16 TD-03 写的是 `convex/agents/`（设计自相矛盾）。AUD-04 |
| D22 时间 | S | core/engine/dates.ts | 引擎无 Date/Intl、IsoDate 字典序、`addDays` 走纪元日。测试：dates.test.ts 三条。`todayInTimeZone` 与 `rollLocalDateTx` 不在本块（INV-77） |
| D24 成员与邀请 | N | schema.ts:202-231 | 索引与 `invites` 字段（mode/invitedEmail/tokenHash/72h）在；`addMember`/`invites.*` 未实现 |
| D25 提案不可变 | S | canonicalJson.ts；schema.ts:426-447；keys.ts:15-25 | `termsKey = canonicalJson(terms)`、`lines[]`/`plannedTasks[]`/`requiredApprovals` 快照字段、`candidateKey` 规范串。itemKey 格式问题记在 §1.2 / AUD-08 |
| D26 v1 范围 | N | schema.ts:180,318 | 单场景字面量、`agentMode` 在；`AgentDriver` 与 stub 驱动未实现 |
| D27 fixture 数字 | S | core/scenarios/scope-change/fixtures/main.ts:109-176；variants.ts；canaries.ts | 目录合计 140 000、必需 80 000、+usage_dashboard 90 000、截止 = 锚点 +18 天、上限 500 000 / 基线 400 000、finance 只对 customer 披露 `capCents`。测试：tests/scenario/arithmetic.test.ts、variants.test.ts、canaries.test.ts、anchor.test.ts |

## 3. 章节条目（04 / 10 / 11 / 16 / 03）

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| CN-001（10 R11 / §10.10 / §10.11 变更通知） | S | modelGateway.ts:41,54-68,1311-1330,2114,2175-2238,2290-2318,2426 | SDK 重试 0 且非 0 即抛错；网关只重试 429 与连接错误一次；总截止 230 s 早于 275 s 看门狗；截断在同一调用内重试一次；截止到期（含退避中）返回不可重试 timeout（W0-F-r01 已修）。测试：modelGateway.test.ts「retries only 429 and connection failures」「counts transport and truncation retries independently」「returns a non-retryable timeout when … before send / during backoff / during send」。后续问题见 AUD-06、AUD-15 |
| 04 §4.1–4.9 迁移表 | S | stateMachines.ts | 与 04 R1–R21、P1–P6、U1–U6、A1–A7、H1–H4、C1–C3、T1–T2 一致；自环 R4/R19–R21 只在表内允许、不改 status。设计内矛盾（不算代码偏离）：canon §1.2 / D05 提到目录项「重新上架」，而 §1.3 / 04 C3 把 `retired` 定为终态 |
| 03 schema v1 | D | convex/schema.ts；convex/lib/schemaTypes.ts:21-39；tests/schema/contract.ts | 与当前 03 不同（设计后移）：attempts 缺 `protocolVersion`/`promptVersion`/`reservedDay`/`retryNote`/`staleGuard`/`httpStatus`/`retryAfterMs`/`rationaleTruncated`，多 `outputSha256`（03 明写不设），`schemaVersion` 应为可选；`spendCounters` 缺 `attempts`/`unknownCostAttempts`；rooms 缺 `by_followsExecutionId`；`revisionCauseV` 缺 `scenario_migrated`；`disclose` 效果缺 `toRoles`。canon 要求而 03 也漏掉的：`waitingReason: run_cap`、效果 `pass_to_next{toRole}`。AUD-09 |
| 10 §10.11 `abortAfter`（V4） | U | modelGateway.ts:2114-2116,2220 | 直接调用 `AbortSignal.timeout` 与 `AbortSignal.any`，没有 10 §10.11 要求的 `AbortController + setTimeout` 退路；二者在 Convex 默认运行时是否可用需真实部署验证（spikes §8）。若缺失，异常发生在 try 之外，action 直接崩溃（AUD-12） |
| 03 `events.commitTs`（V1/V-S1） | U | schema.ts:583 | `v.commitTs()` 能通过离线 codegen 与类型检查，但提交时填值语义与同事务多事件排序只能在真实部署验证 |
| 11 §11.5 lint 与 arch:check | D | eslint.config.mjs | L1/L2/L4/L5/L10 有；缺 L6（SDK 只在 model/agents）、L7（convex `no-console`）、L8（db 写门面）、L9、L11 与 `arch:check` 唯一写入口扫描。L8/L9 可随 W1 写门面落地，L6/L7 是现在就该有的地基规则。AUD-16 |
| 16 TD-01 Vitest 分层 | S | vitest.config.ts；tests/vitest.config.ts；package.json:16 | core / convex(edge-runtime) / evals / web(jsdom) 四个 project；真实部署与 Playwright 不在默认 `pnpm test` |
| 16 TD-03 唯一接缝 | D | modelGateway.ts:2717-2719；convex/lib/modelGateway.ts | 三个导出名（`callModel`/`callNegotiationModel`/`callStructured`）、两个模块路径，路径与 canon D21 冲突。并入 AUD-04 |
| 16 TD-05 `drainDue` | S | tests/helpers/convex.ts | 只推进到期任务、失败任务抛错；W0R-03 已修 |
| 16 TD-13 电池 | D | tests/battery/index.ts:2657-2710；tests/battery/** | 注册表 78 INV + 175 CE 与设计编号一一对应（含 16 新增 CE-171…175）。W0R-09 在 main 上仍是 partial：所有用例体是 `it.todo`，`reconcileBattery().ok === false` 被断言，CI 绿不证明任何 INV/CE。AUD-18 |
