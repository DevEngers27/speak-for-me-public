# CN 裁定套用记录 · protocol / rules 组（04、05、06、09）

范围：`04-state-machines*.md`、`05-protocol*.md`、`06-rules-engine*.md`、`09-constraint-changes*.md`。依据 `_changes/CN-002`、`CN-003`、`CN-004` 的裁定（canon 优先；canon 沉默时归属章节优先；再否则取更严格的读法）。每条先核对现稿，修订轮已改过的记 `already_present`，不重复改。全部改动是精确匹配的局部替换（改前备份在 scratchpad `cn-apply-protocol-rules/backup/`）；表格列数已逐行核对不变；正文不带 CN 编号，只在 06 §16、05 §5.20、04 §4.16 的"与 canon 的对照"末尾各补一行。09 没有落在本组条目上的裁定，未改动。

| 条目 | 状态 | 文件与位置 | 改动摘要 |
| --- | --- | --- | --- |
| CN-002 #1 `pass_to_next` | already_present | 05-part5 §5.11.1 / §5.11.2 / §5.11.4；04-part2 R21；04-part4 §4.8.2 / §4.8.3；06-part7 §11.1 / §11.2 / §11.4 | requestEffectV、infeasible 选项（按位置附加、末位没有、每 (from, to) 一次）、回答行都已有，未改 |
| CN-002 #2 被接受的 `escalate(infeasible)` 开 `infeasible` 请求 | already_present | 06-part7 §11.2 infeasible 行与 agent_escalated 行 | 已写明开的是 `infeasible` 请求、不是 `agent_escalated`；全部 kind 含 `end_run`，未改 |
| CN-002 #3 customer `agent_escalated` 提供 `keep_as_is` | already_present | 06-part7 §11.2 agent_escalated 行；05-part5 §5.11.2 / §5.11.4；04-part4 §4.8.2 | 否认该选项的句子已删，customer 选项为 choose_candidate / keep_as_is（= 下一轮，轮次已尽等价 end_run）/ end_run，未改 |
| CN-002 #4 clarify 请求以 `end_run` 收尾 | applied | 05-part5 §5.9.2 第 3 步 | §5.11.2 与 06 §11.2、04 H1 已有；§5.9.2 第 3 步仍只列 `disclose { field }` 与 `keep_as_is`，改为 `disclose { field, toRoles: [发问角色] }`、`keep_as_is`、`end_run` |
| CN-002 #5 counter 反馈只带 candidateKey | already_present | 05-part4 §5.8.3 第 4 行、§5.8.4 | 反馈含 `candidateKey`、在 provider 新快照中重新标号；CN 本身注明无需改章 |
| CN-002 #6 `disclose` 的下一步按 kind | already_present | 05-part5 §5.11.4 disclose 行；06-part7 §11.4；04-part2 R14 / R20 | clarify → 发问方同轮新回合；infeasible 回退 → 同事务重跑 S0 预检，已逐字写明，未改 |
| CN-002 #7 rounds_exhausted 的 `questionKey`，06 引用而不用调用方标志 | applied | 06-part7 §11.1 `buildHumanRequests` 入参；§11.2 rounds_exhausted 行 | 删去 `limitHit?: 'call_limit' \| 'spend_limit'`，改为 `exhaustedCause?: 'rounds' \| 'no_candidates' \| 'call_limit' \| 'spend_limit'`，`questionKey = request.rounds_exhausted.{exhaustedCause}`（引 05 §5.8.5 / 04 §4.8.3），表中注明不另设调用方标志 |
| CN-002 #8 没有 `effectiveMaxRounds` | already_present | 05-part4 §5.8.1、05-part7 §5.20 D08 行 | 只剩"没有派生的 effectiveMaxRounds"这类否定句；04 / 06 / 09 无该名，未改 |
| CN-002 #11 原因映射 + `keep_as_is` 资格只有一个谓词 | applied | 05-part4 §5.8.5（两处）；05-part5 §5.11.2 rounds_exhausted 行、§5.11.4 keep_as_is 行；04-part4 §4.8.2 keep_as_is 行、§4.8.3（两处）；04-part5 SM-11；06-part7 §11.2 rounds_exhausted 行、§11.4 末行 | 写明 provider 的提案上限 → `no_candidates`，`call_limit` / `spend_limit` 只用于 run 的 attempt / 美元上限；`keep_as_is` 的资格是提供与回答共用的一个谓词（原因 = rounds ∧ 未延长 ∧ provider 剔除后仍有候选 ∧ 提案 < 4），回答时从请求的 `questionKey` 读回原因复核，不成立等价 `end_run`；SM-11 改为"第二次 rounds_exhausted 请求不再提供 keep_as_is（直接提交 → `request.option_unknown`）"，与 06 T06-U34 一致。04 R6 原有映射，未动 |
| CN-003 #1 `enumerateCandidates` 只在引擎，锚点由参数派生 | applied | 06-part6 §9.2 createTurnTx 行、§10 引言与代码；06-part7 §10.1 第 3 条；06-part8 §12.1 成员 10 注释、§12.3 末段；06 part1 R-D9 | `EnumerateOpts` 改为联合：snapshot 模式必填 `turnKind` / `roundNo`，删去 `anchor` 参数，引擎按 `viewer === proposerRole ∧ turnKind === 'propose' ∧ roundNo === 1` 派生，不可覆盖；§10 首段写明场景只提供 `candidateSpace` / `materialize` / `stubDecide`，不重新实现枚举；§12.3 "引擎独占"加"候选枚举本身" |
| CN-003 #4 feasibility 模式没有上限 | applied | 06-part6 §10 `EnumerateOpts`；06-part7 §10.1 第 1 条；05-part4 §5.8.2 S0；04-part2 §4.3.3 `buyerFeasible` 说明 | feasibility 分支无 `limit`（`exclude` 可选），返回视图下全部可行候选；05 S0 与 04 的 `buyerFeasible` 由 `{ limit: 1 }` 改为 `{ mode: 'feasibility' }`（04 顺带把"05 §5.4 S0"更正为 §5.8.2） |
| CN-003 #5 `viewFor` 是唯一的视图构造函数 | applied | 06-part2 §3 模块表、§5.1 `View` 注释、§5.2 新增首条；06-part7 §11.1 `viewOf` 注释 | `viewFor(plugin, full, disclosures, role)` 返回带品牌的 `View<RI>`；`viewOf` 等 helper 只是薄包装；`enumerateCandidates(viewFor(role))` 必须给出 T06-U18 / U21 golden |
| CN-004 #1 唯一投影函数 `projectChecks` | applied | 06-part5 §7.1 `CheckDecl` / `CheckResult`、§7.2 表头与 S1–S3 / B1 的 inputs、§8 整节；06 part1 §1.2；06-part2 §3；06-part3 §6.1 末行、§6.3 ① ②；06-part6 §9.2 rooms.view 行；06-part8 §12.2 第 3 条、§12.4；06-part9 T06-U29 / T06-P6、§16 §1.6 行 | 删去 06 自己的 `projectEvaluation` / `EvaluationView` / `ProjectedCheck`，§8 改为引用 07 §7.11 的 `projectChecks(viewer, evaluation)` 并复述其规则；`owner` / 析取 `requires` 改为 `ownerRole` / 合取 `inputs`（B1/B2 的 inputs 为派生字段 `headroomCents`，可见性按 07 §7.8.5：共享 headroom 或同时共享 cap 与 committed）；写明检查所有者本人的失败检查永不掩码；`amounts` 的裁剪单列为第 4 条（按 07 §7.8.5）；只列失败项，掩码合并为一条 |
| CN-004 #2 人工请求选项 | applied | 06-part7 §11.1（`blocked` / `shown` 注释、`escalation.kind`）、§11.2 rounds_exhausted 行、§11.3 第 4 / 6 条；06-part8 §12.1 成员 12 注释 | 判别字段 `type` 已在（修订轮）；`{ type: 'blocked' }` 注明是"需要他方未披露值"选项的持久化标记，`shown` 只放可由 `viewFor(toRole)` 推出的值，两者并存；`escalation.kind` 加 `cannot_deliver`；`choose_candidate` 由引擎枚举，插件只经 `rankForOwner` 排序、`relaxations` 不返回它；`assertOptionsProjected(toRole, options)` 按 03 §3.9 / 05 §5.11.1 的签名 |
| CN-004 #3 插件成员数（16 必需 + 2 可选） | applied | 06-part8 §12.3 末段 | R-D12、§12.1、§16 D21 行已经是 16 + 2；§12.3 的"实现 15 个成员"改为"16 个必需成员（可选成员 17–18 按需）" |
| CN-004 #3 `CheckCtx` 形状 | skipped_needs_ruling | 06-part5 §7.1 | CN 标为 needs ruling（`{input, x}` 还是 `{input, proposal, terms, lines}`），未改 |
| CN-004 #4 任何角色都不能问 `option_fits_constraints` | applied | 06-part9 §16 D12 行 | §12.2 第 5 条（任何角色）、05 §5.9.1 / P12 已在；§16 D12 行残留的"seller 不得用可行性话题"改为"任何角色都不得声明可行性话题（`option_fits_constraints`，D12 ③ 修订）" |

## 留给其他组 / 待裁决的残留（本组未改）

- 14-scenario-scope-change-part2 §6.4：`enumerateCandidates(..., { mode: 'feasibility', limit: Infinity, anchor: false, mustInclude: [] })` 用的是旧签名，应改为 `{ mode: 'feasibility', exclude }`（无 limit、无 anchor）；§6.4 若由插件枚举 `choose_candidate`，应改为引擎枚举（CN-004 #2）。§7 的 S1–S3 声明仍用 `owner` / `requires: [[...]]`，应改为 06 §7.1 的 `ownerRole` / `inputs: [...]`。
- 00-invariants INV-06 / CE-035 与 02 仍叫 `projectRuleCheck`，应改为 07 §7.11 的 `projectChecks`（CN-004 #1，归 00-invariants / 02）。
- 06 §6.2 的 `vCheckResult`（Convex validator）只含 `checkId / status / code / params`，不含 `ownerRole` / `inputs`。本组没有改：它可能是另一种存储或线格式，是否补字段由 03 / 12 决定。
- 04-part2 §4.3.4 末尾写"provider 的 `reject(cannot_deliver)` 与 `escalate` 一样交 05 策略检查"，与 05 §5.10、06 §11.2 的"不经策略检查"矛盾。这句不在本次条目里，没有改，建议下一轮按 05 修正。
- 04-part5 §4.16 D15 一行写"九种 effect"，05 §5.20 写"十种（含 `blocked`）"，口径不一致。不在本次条目里，没有改。
