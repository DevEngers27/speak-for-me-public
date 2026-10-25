# CN 应用记录：privacy-runtime 组（07 / 10 / 11 / 12 / 14 / 16 / 17 / 00-canon）

日期 2026-10-24。依据 `_changes/CN-001` … `CN-004`；裁定规则：canon 优先 → canon 沉默时归属章节优先 → 否则取更严格 / fail-closed 的读法。正文不留 CN 编号；章末"与 canon 的对照"小节按需补一句。格式：条目 | 状态 | 文件与位置 | 改动摘要。

## 1. CN-001：网关重试（10 R11 / §10.11 / §10.10.2 跟随 W0-F 已实现的 canon D09）

1 | applied | `10-agent-runtime.md` R10、R11、RT8 | R10：单次发送 timeout 由 max_tokens 推导，总截止 `CALL_DEADLINE_MS` 覆盖首发 + 退避 + 重试、每次发送取 `min(timeout, 剩余)`，早于 `WATCHDOG_FIRST_MS`，断言改为"加载 + 总截止 + 落库 < action 上限"与"加载 + 总截止 < WATCHDOG_FIRST_MS"。R11 重写：SDK `maxRetries: 0`（传输层拒绝非零值）；网关是传输错误的唯一重试层，只对 429 / 连接错误重试 1 次（遵从 retry-after，≤ 8 s，不超过剩余总截止），408 / 409 / 5xx / 529 不重试；`max_tokens` 记 `output.truncated` 并在调用内重试 1 次，第二次 `retryable: false`；截止到期在发送前、退避中、发送中一律是不可重试的 `model_timeout`（W0-F 验证评审 r01）；attempt 层只为网关不处理的失败开 ≤ 1 个 auto_retry；每次调用 ≤ 3 次发送，每条链最坏 6 次 HTTP。被否决列补 SDK `maxRetries: 1`（448 s 截止晚于看门狗）、attempt 层再重试传输错误、截断作为新 attempt。RT8 改为两层按错误类别互不重叠。
1 | applied | `10-agent-runtime-part4.md` §10.10.2 | `output.truncated` 行改为 0 次（网关已调用内重试）；`model_timeout` 行改为 0 次（截止到期不可重试）；`transport` 行改为 0 次（429 / 连接错误只由网关重试，`retryAfterMs` 照记供诊断）；不重试行补 `config_invalid`；`decideRetry` 代码删去按 `retryAfterMs` 的退避分支与入参。
1 | applied | `10-agent-runtime-part4.md` §10.11 | `MODEL_BUDGET`：`sdkMaxRetries: 0`，新增 `gatewayTransportRetries: 1`、`gatewayTruncationRetries: 1`、`gatewayMaxBackoffMs: 8_000`、`deadlineMarginMs: 2_000`（删 `sdkMaxBackoffMs`）；`CALL_DEADLINE_MS = REQUEST_TIMEOUT_MS + 8 s + 2 s = 230_000`（删 448_000），`ACTION_WALL_MAX_MS = 270_000`；I1 文案、I3 改为"总截止早于看门狗首次判定"（`load + CALL_DEADLINE < WATCHDOG_FIRST_MS`，240 s < 275 s），新增 I6（SDK 重试必须为 0）；I1 数值含义改为 `tps > 30.2`，说明 I3 与 tps 无关（余量 35 s）及"首发吃满预算时重试被跳过"的代价；看门狗两段说明与 `abortAfter` 说明同步。
1 | applied | `10-agent-runtime-part5.md` §10.14.1 | `callNegotiationModel` 片段：`new Anthropic({ maxRetries: sdkMaxRetries })`（0），总截止信号 + 网关重试循环注释（每次发送 `timeout = min(REQUEST_TIMEOUT_MS, 剩余)`、截止任意阶段触发 → 不可重试 `model_timeout`），usage 为调用内全部带响应发送之和。
1 | applied | `10-agent-runtime-part5.md` §10.15.2 | `model_timeout` 行补"含退避等待中到期、发送前已耗尽"并标不重试；429 / 连接错误行改为"网关重试 1 次后仍失败"；5xx / 529 行标"网关不重试"。
1 | applied | `10-agent-runtime-part6.md` §10.19 F01、F02、F05、F06、F07、F09、F15，§10.20 告警 | F01 截止到期不重试；F02 写明之后状态（原"同上"依赖 F01）；F05 调用内重发 1 次、第二次不再 auto_retry；F06 改为 429 / 连接错误由网关重发 1 次、attempt 层不再重试；F07 写明 5xx / 529 / 408 / 409 不重试；F09 缺密钥 → `config_invalid`；F15 每次调用 ≤ 3 次发送、每链 ≤ 6（I4）、I6；告警清单补 `config_invalid`。
1 | applied | `10-agent-runtime-part7.md` §10.21、§10.22 V5 / V8、§10.23 Q2、§10.24 D09 行与取舍段 | `budget.ts` 用例改为 I1–I6、触发值 tps 25 / `sdkMaxRetries` 1 / `gatewayTransportRetries` 2；新增网关重试纯函数用例（429 / 连接错误恰 1 次、408/409/5xx/529 只 1 次、截断调用内 1 次且第二次 `retryable: false`、三个阶段的截止到期不可重试、SDK 非零抛 `GatewayConfigError`）；V5 / V8 / Q2 去掉"降 sdkMaxRetries"；§10.24 D09 行改写为网关单层重试与总截止；取舍段改为"SDK `maxRetries: 0` 保留，应用层全包改为网关单层重试"。
1 | applied | `00-canon-part2.md` D09 | 按 CN-004 #5（CN-001 优先于 canon D09 的重试语义）：`max_tokens` → 调用内重试一次、第二次 `retryable: false`；`maxRetries: 1` 段改为 SDK `maxRetries: 0` + 网关单层重试 + attempt 层只管网关不处理的失败 + 最坏 3 × 2 = 6 + 总截止早于 `WATCHDOG_FIRST_MS` 且任何阶段到期不可重试；被否决列补 SDK `maxRetries: 1`。
1 | applied | `00-canon-part7.md` 10-agent-runtime 行 | must_absorb 中"`maxRetries: 1` 只覆盖 429 / 连接"改为网关单层重试与总截止。
1 | applied | `11-architecture-part4.md` §11.11 model-call 行 | "`maxRetries: 1` 只覆盖 429 / 连接错误"改为 SDK 0 + 网关单层重试 + 总截止早于 `WATCHDOG_FIRST_MS`。
1 | applied | `12-api-part6.md` `agents.runAttempt` 步骤 ③ | "`maxRetries: 1`、AbortSignal 总截止早于看门狗"改为 SDK 0 + 网关单层重试 + 总截止早于 `WATCHDOG_FIRST_MS` 且到期不可重试。

## 2. CN-004 #5：网关（INV-42 / 10 §10.10.1 / 16 L0 / I4 / RESERVE / 路径 / GatewayConfigError）

2a | applied | `10-agent-runtime-part4.md` §10.10.1 | 表改为四行：429 / 连接错误（网关，每次调用 ≤ 1）、`max_tokens` 截断（网关调用内 ≤ 1）、非截断输出问题 / action_crashed / watchdog_timeout（attempt 层每链 ≤ 1）、不重试类（含截止到期、网关重试后仍失败、408/409/5xx/529、第二次截断、`config_invalid`）；补"两层按类别互不重叠、总截止覆盖首发 + 退避 + 重试、usage 为调用内之和"一段；链的最坏次数改为 3 × 2 = 6。
2a | applied | `16-testing-part2.md` §16.4.5 L0 网关测试 | `maxRetries: 1` 改为 SDK 0（非零构造即抛）+ 网关重试断言（429 → 200 恰 2 次、retry-after ≤ 8 s、连接错误同、408/409/500/529 只 1 次、截断调用内 1 次且第二次 `retryable: false`、假时钟下三个阶段的截止到期都不可重试、总截止早于 `WATCHDOG_FIRST_MS`）。
2a | applied | `16-testing-part4.md` TC-RUN-05、`16-testing-part7.md` E-SCRIPT-TRUNC、`16-testing-part6.md` §8 #16、`16-testing-part9.md` D09 对齐 | 脚本化截断 / 429 / 500 / 529 不再开 auto_retry → `agent_failed`（调用内重试由 L0 覆盖）；#16 改为"网关重试前失败的 HTTP 尝试是否计费"；canon 对齐行补网关单层重试与总截止。
2b | applied | `10-agent-runtime-part4.md` I4；`10-agent-runtime-part2.md` §10.5 `RESERVE_MICRO_USD` | I4 重算为 `(1 + 1 + 1) × maxAttemptsPerTurn ≤ 6`；`RESERVE_MICRO_USD` 重算为输入 / 输出各 × `MAX_BILLED_RESPONSES_PER_CALL = 1 + gatewayTruncationRetries = 2`（首发与截断重试两次带响应），示意价约 $0.74（原 $0.37）。
2c | already_present | `16-testing.md` TD-03、`16-testing-part2.md` vi.mock 路径、`11-architecture.md` §11.3、`10-agent-runtime-part5.md` §10.14.1 | 均已是 `convex/model/agents/modelGateway.ts`，无需改。
2d | applied | `07-permissions-privacy-part7.md` §7.14.1 代码注释 | 同一路径裁定：`convex/agents/context.ts` → `convex/model/agents/context.ts`（11 §11.3 目录）。
2e | applied | `10-agent-runtime-part5.md` §10.15.2；`10-agent-runtime-part4.md` §10.10.2 | `GatewayConfigError` 从 `auth` 行拆出，单列 → `config_invalid`（不重试、告警，与 §10.15.1 一致）；decideRetry 不重试行与 §10.20 告警补 `config_invalid`。
2f | not_found | `00-invariants-part4.md` INV-42、`00-invariants-part9.md` CE-093（模型 / 不变量组） | 不在本组文件。INV-42 仍写 `maxRetries: 1`、"最坏 HTTP 次数 4"、"AbortSignal 总截止早于看门狗"；应改为 SDK 0 + 网关单层重试（429 / 连接错误与截断各 ≤ 1）+ 最坏 6 + 总截止早于 `WATCHDOG_FIRST_MS` 且到期不可重试。CE-093 的"SDK timeout × 2 + 落库余量"应改为"加载 + 总截止 + 落库 ≥ action 上限，或加载 + 总截止 ≥ WATCHDOG_FIRST_MS"。

## 3. CN-004 #4：`option_fits_constraints` 任何角色都不能问

3a | applied | `07-permissions-privacy-part7.md` §7.15 LP-5 | 防线列已是"任何角色"；路径列"provider 的 clarify"改为"任一角色的 clarify（review r03 最初在 provider 上发现）"。
3b | already_present | `07-permissions-privacy-part8.md` T-31 | 已是"任一角色……任何角色都无"。
3c | not_found | `05-protocol.md` P12（协议组） | P12 在 05，不在本组；现文已是"任何角色的话题表都没有"，无需改。
3d | already_present | `16-testing-part5.md` TC-PRIV-20；`07-permissions-privacy-part6.md` §7.13、`part9` §7.25 | 已是"任何角色"。

## 4. CN-004 #8（已裁定部分）

4a | applied | `07-permissions-privacy-part7.md` §7.15 LP-1 | "NFC"改为"按码点计长，并在 NFKC 归一后检查定界词（`disclosure.blocked{field:"title"}`，§7.14.3）"；上下文侧写明 `wrapUntrusted`（NFKC 净化）；测试列补 TC-INJ-08。
4b | already_present | `16-testing-part5.md` TC-INJ-08 | 已写"无尖括号但 NFKC 后含定界词 → disclosure.blocked"。
4c | skipped_needs_ruling | 07 DISCLOSURE 代理列 vs §7.14.1 `AgentContextData`；07 §7.16 vs 14 §8.3 模板措辞 / 归属；RuleInput 目录行 `provenance` | CN 标 needs ruling / proposed，未动。
4d | not_found | 06 §3 / 06 T06-S2（规则组） | 11 与 16 都没有提到场景词汇 lint（11 L1/L2 只有导入与纯度规则，16 只写"引擎纯度"）；"白名单（deadline、provider…）后才能启用"的说明应落在 06 §3 与 T06-S2。

## 5. CN-003 #1：`enumerateCandidates` 归引擎

5 | applied | `00-canon-part4.md` D21 | `core/engine/` 列入"候选枚举 `enumerateCandidates`"；场景插件一栏的 `enumerateCandidates` 改为"候选空间 `candidateSpace` / 物化 `materialize` / stub 策略 `stubDecide`（枚举只有引擎一份，签名见 06 §10，场景不另写枚举，§1.6）"。canon §1.6 与 11 §11.3 目录本已如此。

## 6. CN-004 #3：插件 16 + 2 成员

6a | already_present | `17-roadmap-part2.md` R6 | 已写"16 个必需成员 + 2 个可选成员（06 §12.1）"。
6b | applied | `14-scenario-scope-change.md` §1 | "15 个插件成员的场景实现"改为"插件成员（06 §12.1：16 个必需 + 2 个可选）的场景实现"。

## 交给其他组的跨章残留（只读核对，未改）

- `00-invariants-part4.md` INV-42、`00-invariants-part9.md` CE-093：见 2f。
- `01-product-part4.md` 失败表第 1 行：仍写"SDK `maxRetries: 1` 只覆盖 429 / 连接错误"，且"超时 / 5xx / 429 → 同一 turn 开下一个 attempt"与新口径相反（超时、5xx 不重试，429 只在网关内重试）。
- `02-domain-model-part3.md` 重试表："429、连接错误 | SDK `maxRetries: 1`" → 网关单层重试。
- `04-state-machines-part3.md` A3/A5/A6 后的可重试类："`truncated` 重试一次、`timeout`、瞬时 `error`" → 只剩非截断输出问题、`action_crashed`、`watchdog_timeout`（10 §10.10）。
- `05-protocol-part7.md` E9："`output.truncated`，自动重试 1 次" → 网关调用内重试 1 次，第二次截断不再开 auto_retry。
- `06-rules-engine-part3.md` §6 码表 `output.truncated` 行"重试一次" → "网关调用内重试一次"。
- `15-operations-part2.md` §15.5 第 2 步：`ACTION_WALL_MAX_MS` 现为 270 s（原 488 s），措辞"由 SDK 时间预算推导"应改为"由总截止推导"。
- `15-operations-part3.md` 美元表：`RESERVE_MICRO_USD` 按 × 2 计（约 $0.74，原 $0.37）。
- `18-decisions-open-questions-part3.md` ADR-D09：仍写"`max_tokens` → `output.truncated` 重试一次""`maxRetries: 1`（只覆盖 429 / 连接错误）""`timeout × HTTP 次数 + 落库余量 < action 上限`"。
- canon D21 场景插件一栏仍列 `buildHumanRequests`，而 canon §1.6 与 06 §11 把它放在引擎、场景只提供 `relaxations`；同一逻辑可修，但不在 CN-003 #1 裁定范围内，未动。
