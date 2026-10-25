# 不变量审计汇总（part2）

接 [README.md](README.md)。本篇三节：被反驳的条目、需要设计方裁决的矛盾、对下一波任务包的建议。

## 4. 被反驳的条目（17 条）

每条一行：id，以及不成立的理由。

- **RULES-05**：两套掩码和 Effect 契约分别照 06 §8/§11.1 与 07 §7.11/03 §3.9 实现，各自忠于所依据的章节。根源是设计矛盾。main 上也没有写入路径会触发它。
- **RULES-07**：设计中的 RuleInput（06 §5.1、14 §6.1）不含台账来源，seededLedger 无从派生。徽章由行的 provenance 驱动。这是设计缺口，不是代码偏离。
- **RULES-09**：06 §3 的词汇 lint 与 canon/06 明确要求写进 core/engine 的 deadline、provider 等词冲突，照字面无法启用，需要设计方先裁定。
- **RULES-10**：行序只是 14 示例代码的副作用，不是契约。先 items 后 modifiers 恰好符合 03 的要求。单个 modifier 由插件的生成规则保证，溢出已由 MAX_CENTS 兜住。
- **RULES-11**：Legacy 重载是 registry、pluginFor（W2-1）与 W1-3 落地前的占位。三字段的占位对象进不了任何引擎入口。应写进 W1-3 的验收清单。
- **RULES-12**：B1/B2 的固定键名和 owner=budgetOwner 照抄自 06 §5.1/§7.1 的表格，§12.2 已校验 budgetOwner。只有违约的插件才能触发所说的问题。
- **PRIVACY-04**：读路径的要求是按 toRole 视图重新推导（privacyPipeline 有示范），并不必然抛错。kind 与 type 的分裂来自 06 与 03 本身。接线归 W1-5，fad964b 已接上。
- **PRIVACY-05**：06 §8 与 07 §7.11 给同一个投影起了两个名字、定义了两种类型，代码各照一章实现。剩下"owner 自己的失败检查也被掩码"一点，记为 low，等 CN 处理。
- **PRIVACY-15**：§7.8.3 按单个值所属的版本判定，读取按 (fromRole, field) 前缀进行。生产代码的调用方都只传单一 fromRole，混合输入也不会造成泄露。
- **PRIVACY-16**：W1-4 的任务包不含事件模板。constraints_changed 和 run.waiting 归 W1-3（d4a31d0 已实现），作者中立合并归 W2-1 的 timeline.page。
- **FOUNDATION-06**：截断在同一次调用内重试、共享 230 s 预算，截止到期返回不可重试的 timeout，这些都是 CN-001 的明文规定。I4 和单次预留需要随 CN-001 重算，属于文档跟进。
- **FOUNDATION-07**：设计不要求网关校验 schema 的来源。INV-04 的落点是 strictSchema 快照测试和属性名白名单测试，已有测试覆盖。测试中的样例只是传输夹具。
- **FOUNDATION-10**：constraints_changed 的受众渲染属于场景模板与 timeline。示例模板没有调用方，privacyPipeline 中 provider 版本的渲染符合 D14。INV-61 落在尚未开工的 changeOrders 上。只剩 W0R-08 提到的示例清理，记为 low。
- **FOUNDATION-13**：设计只要求每个 object 强制 additionalProperties:false。禁用 z.record 的约束在 buildTurnZod 层。变换的结果更严格，属于 fail-closed。
- **FOUNDATION-14**：reasonKey 的约束由输出 schema 的 enum 和 validateMoveSemantics 执行，canon 也要求 payload 字段全部 required。actionAllowed 目前没有调用方，没有 reasonKey 的情形本身就有测试。
- **FOUNDATION-15**：设计自相矛盾：D09 经 OBJ-23 改写，与 canon-part7、11 §11.11 等多数文本不一致。代码遵循 CN-001 和多数文本，其中 11 §11.11 本来就与代码一致。
- **FOUNDATION-18**：电池里已有 9 条真实断言，另有 CE 在 tests/engine 中覆盖。TD-13 和 TI-08 描述的是终态，没有逐波截止的要求。`ok === false` 是如实的"未完成"标记。

## 5. 需要设计方裁决的矛盾（建议合成一份 CN-003）

这些矛盾不是代码问题，但不裁决的话，下一波实现者会照其中任一章写，审计会反复报出同样的问题。

1. **投影契约**：06 §8 的 `projectEvaluation`（requires 为 DNF，CheckResult 带 owner/status）与 07 §7.11 的 `projectChecks`（inputs 取合取，CheckResult 带 ownerRole/inputs）冲突，INV-06 又叫它 projectRuleCheck。需要定一个名字、一种类型、一个文件。
2. **人工请求选项**：Effect 的判别字段在 06 §11.1 是 `kind`，在 03/05/12 是 `type`；06 用 `shown`，03 用 `blocked`。assertOptionsProjected 的签名在 06 §11.3 #5 与 05/03 不一致。choose_candidate 由引擎枚举（05 §5.11.2）还是由插件枚举（14 §6.4），也没有定论。cannot_deliver 不在 06 §11.1 中。
3. **ScenarioPlugin 成员数**：§12.1 写 1–16 必需、17–18 可选，而 R-D12、§12.3、§16、17-roadmap 仍写 15。06 §7.1 没有定义 CheckCtx。07 的 FieldRule 有 requiresAck，06 的 FieldDecl 没有。
4. **canon D12 ③ 的残留旧口径**：06 §12.2 #5、LP-5、T-31、P12、TC-PRIV-20 仍只针对 provider/seller，CE-010 的标题也还是旧版。
5. **网关**：canon D09 与 INV-42、10 §10.10.1、16 的 L0 规格都与 CN-001 冲突，I4 和 RESERVE_MICRO_USD 需要重算。16 TD-03 的路径与 canon D21、11 §11.3 冲突。GatewayConfigError 在 §10.15.2 归 auth，在 §10.15.1 归 config_invalid。
6. **03 滞后于 canon/04**：缺 run_cap、pass_to_next、priceChanged/hardChanged。turn_failed.failureKind 和 approval_recorded.reasonKey 进入房间 payload，与 INV-12/D14 字面冲突。retired 是终态，与 §1.2/D05 的"重新上架"冲突。
7. **隐私口径**：briefVersion 置 null，07 只针对 provider，12 针对所有非本人。可见性来源上，INV-01/02/19 写的是 briefs.disclosures，07 PV-05/DM-08 写的是 sharedFacts。02 的 INV-08 仍写 DX-1…10。CE-006/045 仍以 preferredDate 为例。D12 ① 与 07 §7.9.3 对历史 stale 状态的说法不一致。
8. **代理与模板**：DISCLOSURE 的 agent 列与 §7.14.1 AgentContextData 冲突（turns.kind、role 等）。LP-1 写 NFC，7.14.3 写 NFKC，TC-INJ-08 的定义也对不上。07 §7.16 与 14 §8.3 的措辞和模板位置不一致。RuleInput 中没有台账来源。场景词汇 lint 需要定义白名单。

## 6. 对下一波任务包的建议

### 6.1 先决事项（按顺序）

1. **同步设计副本**：把 scratchpad 的 final-v2 同步进仓库的 `docs/design-work/final-v2`，并应用 CN-001、CN-002 中标为"待应用"的章节。之后每个任务包都写明所引用副本的 commit。这一步直接消除约 12 条"设计后改"偏离的成因。
2. **发 CN-003**：裁决 §5 的矛盾，至少先定 1–3 项，因为 W1-3、W1-5、W2-1 都会碰到。
3. **开 W1-4F**（隐私修复包，排在 W2-1 前）：PRIVACY-01/02/03/06/07/08/09/10/11/12/14。PRIVACY-13 并入 #38。
4. **W1-1 follow-up**：RULES-01/02/03，以及 RULES-08 中属于 W1-1 的测试。同一包内完成码表同步（RULES-13 = FOUNDATION-02）。
5. **首个业务 mutation 之前**：FOUNDATION-01（错误边界）、FOUNDATION-08（ITEM_KEY_RE 单一来源）、FOUNDATION-09（先改 03，再做 schema 增量）。
6. **W2 agents runtime 网关包**：FOUNDATION-03/04/05/11/12，加 PRIVACY-17。前置条件是完成 V3、V4、V10 的真实部署验证。

### 6.2 应写成"每行一条测试"的交付要求

任务包按"不变量或表格行 → 测试名"逐行列出，并替换电池里对应的 `it.todo`。验收时 `reconcileBattery` 的 untestedIds 只能减少，同时接上 executedIds。

| 表 / 不变量 | 每行一条测试的内容 | 对应偏离 |
|---|---|---|
| 07 §7.9 披露矩阵（含 ●′ ●‴ ●⁗ 变体）与 DX-1…DX-13 | 每个 role × field 一条断言，provider 的 null 和折叠各写一条；TC-PRIV-05 元断言 `Object.keys(DECLASSIFIERS) == DECLASSIFIED`；TC-PRIV-10 改为按 schema 叶子路径对账 | PRIVACY-01/03/07/12/13/14 |
| 07 §7.8.4 SHAREABLE_FIELDS | 每行（字段 × 允许受众 × requiresAck）一条，外加 preferredDate 拒绝用例；ownerRole 设为查看者时仍拿不到 | PRIVACY-06/08/09 |
| humanReasonKeys 受众 / 08 I23 | 每个 reasonKey × 角色一条，buyers 键不进入 payload | PRIVACY-02 |
| canon §1.5 / 06 §6.2 码表与 PARAM_AUDIENCE | 每个码一条（存在、受众、每个参数），T06-S4 覆盖实际发出的参数名 | RULES-13、FOUNDATION-02 |
| 08 §8.4.2 isExecutable | stale、executed、not_current 各一条，使用 04 R12 可达的状态；U6、U13 | RULES-01/08 |
| D15 / 05 §5.11.1 / 04 §4.8.2 请求出口表 | 每个 (kind, toRole 位置, limitHit/roundsExtended) 组合一行：effect 集合、pass_to_next、keep_as_is 条件、A..E、questionKey | RULES-04 |
| 03 §3.11.1 事件载荷 | 每种事件一条：引擎目录与 convex eventPayloadV 的键集和枚举相等 | PRIVACY-11 |
| 06 §12.1 成员与 §12.2 #1…#8 | 每条注册规则一个拒绝用例（runPluginConformance / S3） | RULES-02/03 |
| canon D12 ③ / INV-11 / CE-010 | 每个提问角色（customer、finance、provider）一条 | RULES-03、PRIVACY-10 |
| 06 §13.2 T06-P1…P10 | 每条性质一个 it，固定 PRNG 种子，至少 2000 例 | RULES-08 |
| 10 §10.15.2 classifyError、§10.10.2 decideRetry | 每个 HTTP/SDK 异常一行，映射到 (status, AttemptErrorCode)；decideRetry 每行一条 | FOUNDATION-05 |
| 11 §11.6 错误边界 | 每类异常一条：规范化的 ConvexError 原样抛出；未知异常 → internal 并记 opsLog；auth.unauthenticated | FOUNDATION-01 |
| 11 §11.5 L1–L11 | 每条 lint 规则在 check-boundaries 中有一个反例夹具 | FOUNDATION-16 |

### 6.3 任务包写法

- 写明不在本任务范围、但会被照抄的已有代码。例如 W1-1 提前合入了属于 W1-2 和 W1-5 的代码，下游任务应把它当占位，不能当成已完成。
- 写明本任务要替换的 `it.todo` ID 清单，以及仍保留为 todo 的理由。
- 引用的设计章节如果在 §5 中有冲突，任务包要写明以哪一章为准，或者注明等 CN-003 裁决。
