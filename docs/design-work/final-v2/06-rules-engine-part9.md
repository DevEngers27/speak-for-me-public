# 06 · 确定性规则引擎与场景插件接口（part9：测试、不变量、开放问题、与 canon 的对照）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§13 测试、§14 不变量、§15 开放问题、§16 与 canon 的对照。数字全部取自 14 的主 fixture（`localDate` 2026-11-02、截止 2026-11-20、已承诺 400000），测试从 fixture 推出，不另写一份。

## 13. 测试

### 13.1 表驱动单测（vitest project `engine`，纯函数，不需要 Convex）

| 编号 | 用例 | 期望 |
| --- | --- | --- |
| T06-U01 | 上限 480000，只含必需项 80000 | 通过（480000 = 480000） |
| T06-U02 / U03 | 上限 479999 / 470000，同上 | `budget.over`，overBy 1 / 10000 |
| T06-U04 | v1 90000：上限 500000 / 480000 | 通过 / `budget.over` overBy 10000 |
| T06-U05 | 全量 140000，交付 2026-12-04 | `blocking = ['date.after_deadline', 'budget.over']`，顺序固定 |
| T06-U06 | 构造输入 committed 400000 > cap 399999（生产不可达） | 只有 `budget.below_committed`；B2 `not_evaluated` |
| T06-U07 | E1：空 `itemKeys`；未排序或重复；`2026-02-30`；金额 0.5 | `item.unknown {itemKeys: []}` / `item.duplicate` / `date.invalid` / `amount.out_of_range` |
| T06-U08 | 未知键；把 modifier 放进 `itemKeys` | `item.unknown` |
| T06-U09 | 条目已 retired | `item.retired`；E4 `not_evaluated`，不抛错 |
| T06-U10 | 改价（revision 2）；只改标题（revision 不变） | `version.stale_source`；通过 |
| T06-U11 | 篡改快照金额为 85000 | `amount.claim_mismatch` |
| T06-U12 | 11-02 物化的 v1（11-18），以 `localDate` 11-03 评估 | 通过，交付日不变（绝对日期不重算） |
| T06-U13 | `localDate` 11-18 / 11-19 | 通过（当天交付）/ `date.in_past` |
| T06-U14 | 交付日 > `localDate + 365` | `date.out_of_range` |
| T06-U15 | 交付日 = 截止日；晚 1 天 | 通过；`date.after_deadline {daysLate: 1}` |
| T06-U16 | 缺必需项 | `item.required_missing {reason: 'not_included'}` |
| T06-U17 | provider 视图、customer 视图（只见 cap）下评估 v1 | 预算检查 `unknown`，不阻断 |
| T06-U18 | provider 第 1 轮快照（必需项与截止日已披露） | `[O1 audit_log_export+sso_login 80000 2026-11-16, O2 audit_log_export+sso_login+usage_dashboard 90000 2026-11-18]` |
| T06-U19 | `exclude` 含 O2 的键 | `[O1]` |
| T06-U20 | 必需项 `audit_log_export` 被撤下 | `items: []`、`emptyReasons: ['item.required_missing']`，不抛错 |
| T06-U21 | canary 变体：截止日未向 provider 披露，16 个候选 | 截断为 12，顺序与 14 §11 F 的 golden 一致 |
| T06-U22 / U23 | 锚点只在第 1 轮 proposer；`mustInclude` 的 counter 键 | 首位为最便宜候选；counter 键出现在快照 |
| T06-U24 | `hardProjection`：主 fixture；改标题；改价 | 固定串；不变；改变 |
| T06-U25 | `validateCapChange` 400000 / 399999（已承诺 400000） | 通过 / `budget.below_committed {minAllowedCapCents: 400000}` |
| T06-U26 | shared fact 日期 `4800-01-01`；itemKey `cap_480000` | `date.out_of_range`；`item.unknown` |
| T06-U27 | 目录标题含 `<`；81 码点；无尖括号但含定界词 `untrusted_data`（含 NFKC / 全角 / 零宽变体） | `input.invalid {field: 'title'}`；`input.invalid {field: 'title'}`；`disclosure.blocked {field: 'title'}`（与 12 §12.12 ⑤、14 §5 同一划分） |
| T06-U28 | 第 13 个 item 或第 3 个 modifier；改 kind；`leadDays` 366；价格 8e9 + 1 | `item.limit_exceeded`；`item.duplicate`；`date.out_of_range`；`amount.out_of_range` |
| T06-U29 | `projectChecks` 纯函数（07 §7.11）：v1 条款 @ cap 480000 的 `Evaluation`，finance（所有者，本人的失败检查永不掩码）/ customer（只开 cap）/ customer（开 headroom）（不经 `rooms.view`；`rooms.view` 对 stale 提案不调用它，见 §6.3 ②） | 精确 + 参数 / `private.constraint_unmet` / 精确 + `overByCents` |
| T06-U30 | provider 投影 | 只有 `fit`；JSON 中无 `checkId`、无 `code` |
| T06-U31 | `$4,700` 预检为空 | 一个请求：finance，`raise_cap` 480000（+$100）与 490000（+$200）、`end_run`；customer 被跳过 |
| T06-U32 | 必需项被撤下后预检为空 | customer，`drop_items [audit_log_export]`、`pass_to_next {finance}`、`end_run` |
| T06-U33 | 截止日未向 finance 披露、合起来不可行 | customer，`disclose {deadline → finance}`、`pass_to_next {finance}`、`end_run`；披露后重跑 → finance `raise_cap`（末位，无 `pass_to_next`） |
| T06-U34 | 轮次用尽两次 | 第一次含 `keep_as_is`，第二次不含 |
| T06-U35 | attempt 失败 | 失败角色，`retry_turn`、`end_run` |
| T06-U36 | 次日回答 `choose_candidate`，显示日已不可达 | `date.before_lead_time`，请求重新生成 |
| T06-U37 | `isExecutable`：cv 2 下的 stale v1 | `['version.stale_constraints', 'budget.over']` |
| T06-U38 | `termsKey` 被篡改 | 抛 `IntegrityError` → `internal` |
| T06-U39 | `pass_to_next` 只按位置：同一房间分别构造"finance 视图卡住"与"finance 视图不卡住"两种私密值，customer 的 `infeasible` 请求选项逐字节相同（都含 `pass_to_next {finance}`）；`run.passedToNext = ['customer']` 时不再出现；finance 的请求永不含 | 位置决定、非干扰 |
| T06-U40 | rounds_exhausted 的 `choose_candidate`：本 run 当前 v1 未被拒、customer 视图下通过，且其候选已在 `excludedCandidateKeys`（已提出） | v1 的候选排第一；被人拒绝 / 被阻断 / 复核失败的候选不出现 |
| T06-U41 | 快照模式的视图来源：`{ ...viewFor(…) }` 展开拷贝；经 `pickExact` 伪造的同形对象；对照 `viewFor` 原返回值 | 前两者都被拒绝，抛 `PluginContractError('unprojected_view')`；原返回值通过（`isRoleView` 为真） |

### 13.2 性质测试（自带种子 PRNG，每条 ≥ 2,000 例）

| 编号 | 性质 |
| --- | --- |
| T06-P1 | 确定性与顺序无关：打乱目录行与数组，`Evaluation`、`candidateKey`、`termsKey` 不变 |
| T06-P2 | `passesChecks ⇔ blocking` 为空；`blocking` 按 `CHECK_ORDER` 且无重复 |
| T06-P3 | 预算单调：`cap = committed + amount` 通过；`cap − 1` 为 `budget.over {overByCents: 1}` |
| T06-P4 | HP1：同 `localDate`、同台账、同 kind 映射下投影相等 ⇒ 任意提案阻断集合相等，且 feasibility 枚举相等 |
| T06-P5 | HP2/HP3/HP4：改任一硬字段投影必变；改标题 / 任务模板 / 软字段 / 备注 / 披露开关投影与阻断都不变；投影与行顺序无关 |
| T06-P6 | 非干扰：`projectChecks`、`enumerateCandidates(viewFor(V))`、给 V 的请求选项在他方私密值变化（1 bit 摘要不变）时逐字节不变；金丝雀值不出现在 V 的任何输出 |
| T06-P7 | 快照可靠：每项在该视图下阻断为空；≤ 12；锚点后按 `candidateKey` 码点序；键唯一 |
| T06-P8 | feasibility 完备：目录 ≤ 8 行的随机实例与暴力穷举（同一 modifier 生成规则）结果完全一致；被省略的 modifier 变体都被其基础变体支配（更贵且基础已满足全部检查） |
| T06-P9 | 不抛错：随机目录（含撤下的必需项、空目录、只有 modifier）与随机简报下，`checkProposal`、`enumerateCandidates`、`buildHumanRequests` 都不抛；后者恰好返回一个请求且含 `end_run` |
| T06-P10 | `materialize` 契约：金额 = Σ 行、交付日 = `localDate + effectiveLeadDays`；改无关行不影响该候选 |

### 13.3 静态与契约

T06-S1 esbuild 打包 `core/engine` + `core/scenarios/scope-change`，产物中 `zod`、`convex` 引用为 0；T06-S2 ESLint 纯度与场景词汇规则；T06-S3 `runPluginConformance(scopeChange)` 与测试插件 `procurement_rfq`；T06-S4 `vReasonCode` / `zReasonCode` 与 `REASON_CODES` 集合相等、`PARAM_AUDIENCE` 覆盖全部实际出现的参数名，且 `rooms.view` 的 `checks[].text` 渲染只消费 `PARAM_AUDIENCE` 已声明、并已按查看者裁剪的参数（DTO 不带开放的 params record，12 §12.17；未声明参数进入渲染输入即失败）；T06-S5 §6.4 左列旧码字面量零出现；T06-S6 仓库内只有一个导出名为 `isExecutable` 的函数（`core/engine/executable.ts`，08 U13 同一条）；T06-S7 schema 测试：`constraintRevisions` 及任何可经 `restrictedRef` 到达的表都没有字符串型投影字段，`hardProjection` 的返回值不出现在任何 `ctx.db.insert` / `patch` 的参数里（投影含 finance 私密 `capCents`，§5.3、09 §9.1.1）。convex-test 层（16）：`rooms.view` 三角色 golden 投影、`approvals.record` 返回 `approval.not_executable`、`budget.setCap` 低于已承诺时不 bump 不写事件；`rooms.previewChange` 的 C0 非干扰（customer 未向 finance 披露必需项与截止日时，扰动这两个值后 finance 的返回逐字节不变，privacy-03，对应 16 TC-PRIV-13）；stale 提案不重算（bump 后 run 进入 `needs_input`，finance 再改上限两次，customer 的 `rooms.view` 中 v1 的展示逐字节不变，privacy-09，对应 16 TC-PRIV-14）。

## 14. 不变量

INV-R1–R13 见 §2。另加：
- INV-R14 任何 query（含 `rooms.view`）不调用 `Date.now()`；"今天"只读 `rooms.localDate`（lint 规则覆盖 `convex/**` 的 query 构造器）。
- INV-R15 `proposals.terms` / `lines` / `plannedTasks` 只来自 `materialize` 的输出，由 `turns.complete` 或 `humanRequests.answer` 写入；`termsKey === canonicalJson(terms)`。
- INV-R16 每条 `humanRequests` 行写入前通过 `assertOptionsProjected`；每个 open 请求恰属于一个 run，每个 run 至多一个 open 请求（D15）。
- INV-R17 `catalogItems` 的 `revision` 只在 `priceCents` / `leadDays` / `status` 变化时递增；同一 `(roomId, itemKey)` 的 kind 不变。

## 15. 开放问题

1. `item.limit_exceeded` 与 `approval.not_executable` 需补进 canon §1.5 的码表（后者 D02 已在用）。
2. 只改标题 / 任务模板时 `revision` 不变的存储方式（03）。
3. setup 阶段的确认是否各自递增 cv（09）；本章与 14 的走查按"房间开放时 cv = 1"书写，只影响编号不影响结论。
4. （已关闭）沿用提案从 `stale` 迁回 `active` 已由 04 P5 落实，且 canon D06 收窄为仅被取代 run 处于 `pending_approval` 时沿用；`excludedCandidateKeys(run)` 按 03 派生、不存字段。
5. 截断按 `(amountCents, candidateKey)` 选入：必需项未披露给 provider 时，便宜但缺必需项的组合可能挤满 12 格；靠轮次用尽后的 customer `choose_candidate` 保活。备选是按条目数降序，待 16 的离线评测比较。
6. （已关闭）被阻断的 provider 候选不插提案、不消耗版本号（turn 记 `outcome.blockedCandidateKey`）；05 P10 / §5.7.3 / §5.15.1 已回改为同一口径，主线 $800 方案是 v2。
7. 最坏 12,288 次物化 + 检查在 Convex isolate 的 CPU 时间（待验证，归入 spikes §8 清单；超限时把 modifier 变体改为只在 feasibility 模式生成）。
8. "全部读取字段都已披露即解密"这一解密路径需 07 在解密清单中确认。
9. （已关闭）回退分支 `disclose` 回答后同事务重跑预检：仍无解 → 新请求、run 保持 `needs_input`；有解 → `negotiating`（04 R20、05 §5.11.4）。
10. `rooms.previewChange` 对 finance 只回答当前提案的预算检查，不做 feasibility 枚举（privacy-03）；若将来要给 finance "仍存在可行方案"，前提是 `viewCoversRuleInput(finance)` 按当前 `sharedFacts` 动态为真，并先在 07 的解密清单登记。

## 16. 与 canon 的对照

| canon 条目 | 本章落实 |
| --- | --- |
| §1.2 `termsKey` / `candidateKey` / `optionKey` / 金额 / 日期 | §4：`termsKey = canonicalJson(terms)` 不哈希；`candidateKeyOf`；`O1..On` 只在快照解析；整数分 ≤ 1e11；`IsoDate` 码点比较 |
| §1.5 reasonCode 风格 | §6：小写点分单一来源、validator 与 Zod 同源派生、`params` 按受众裁剪且未声明即丢弃、provider 不收参数；`PARAM_AUDIENCE` 是参数名的唯一来源（`itemKeys` / `reason`、`retryAfterMs`、`currentConstraintsVersion`、`reasonCodes` 等，07 / 08 / 12 / 13 只读这些名字）；§6.4 旧码对照表 |
| §1.6 纯函数名 | `checkBudget` / `checkProposal` / `isExecutable` / `enumerateCandidates` / `buildHumanRequests` / `canonicalJson` 均在 `core/engine`；`evaluateApprovalSet` 归 08，`projectForRole`、`renderPublicText` 与按角色投影检查结果的 `projectChecks` 归 07（本章只产出带 `ownerRole` / `inputs` 的 `CheckResult`） |
| D02 / D19 | `isExecutable`（= 当前性 ∧ `passesChecks`，08 §8.4.2 唯一实现）与 `passesChecks`、`allApproved` 分名；approve 前 `isExecutable` 不通过抛 `approval.not_executable` |
| D05 / C8 / C9 | `hardProjection` 从 `RuleInput` 派生，含目录 `(itemKey, revision, status, priceCents, leadDays)` 与 modifier，不含 `localDate`、标题；`withConstraintChange` 同事务前后两次求值比较、投影串不持久化（§5.3、§9.2，T06-S7）；只有本章一份实现；性质测试 T06-P4/P5 |
| D06 | `startRunTx` 预检（04 §4.3.3）：沿用同一 `proposalId` / 协商 / 请求三分支；被拒提案不参与 |
| D08 | provider 候选被规则阻断不调评估、不插提案、不消耗版本号，键进入派生剔除集合（05 已同口径） |
| D10 / C21 / C26 | §10：按角色视图、码点序、≤ 12、首轮锚点、不按预算过滤 provider 候选、不按偏好排序 |
| D11 / C24 / C25 | §8 按检查判所有者；`fit` / `checks` 只对当前提案计算，stale 提案只显示 `version.stale_constraints`（§6.3 ②、§8 末段）；无 `deferredItemKeys`；请求选项按目标视图生成并断言 |
| D12 ①②③④⑤⑥⑧ | provider 只得 `fit`；`previewChange` 只对 finance 求值且只回答当前提案的预算检查（不做 feasibility 枚举：D12 ② 的前提在 U1 / C0 配置下不成立，已向 canon 说明）；任何角色都不得声明可行性话题（`option_fits_constraints`，D12 ③ 修订，§12.2 第 5 条）；预算三开关；每角色每 run ≤ 4 次提案；约束写入节流码（另加 `price_writes` 桶与每房间每日 run 数上限，07 §7.13）；日期窗口与标题闸门 |
| D13 | 目录标题 1–80 码点、`^[^<>\r\n]+$`，违者 `input.invalid {field: 'title'}`；含定界词（NFKC 归一后）→ `disclosure.blocked {field: 'title'}`（§4，与 12 §12.12、14 §5 同口径）；`approval.not_executable.params.reasonCodes` 与其他他方可见参数都经 §6.3 受众投影 |
| D15 | §11：恰好一个请求、`relaxationOrder`、`pass_to_next` 按位置提供（每 run 每对角色一次）、无 `close` 选项、`keep_as_is` 按 kind（每 run 至多延长一次）、`escalate(infeasible)` 开 `infeasible` 请求、`agent_failed` 给失败方 |
| D21 | §3 单包目录与依赖方向、引擎纯度与场景词汇 lint、插件 16 个必需成员 + 2 个可选成员（§12.1）、UI 槽位不在插件内 |
| D22 / C7 | 插入时物化绝对日期、不重算；只有 `in_past` / `out_of_range` / `after_deadline`；clock 翻转才 bump |
| D23 / C32 | `validateCapChange` 写入口拒绝；规则中 `budget.below_committed` 只作防御 |
| D25 / C38 | `lines` 快照、`version.stale_source`、`amount.claim_mismatch`；rush 为目录 modifier 行 |
| D26 | `stubDecide` 与模型共用输出 schema 与全部下游 |
| D27 | §7.3 与 §13 的全部数字来自主 fixture |
| C22 | 旧大写码全部迁移，CI 扫描零出现 |
| §1.6 / D10 / D11 / D15 / D21（跨章裁定） | 按角色投影只有 07 §7.11 的 `projectChecks`（合取 `inputs`、`ownerRole`，所有者本人的失败检查不掩码，§8）；`enumerateCandidates` 只在引擎（锚点由 `turnKind` / `roundNo` 派生、不可覆盖，feasibility 模式无 `limit`，§10），场景只给 `candidateSpace` / `materialize` / `stubDecide`；`viewFor` 是唯一的视图构造函数（§5.2）；请求选项以 `type` 判别、`blocked` 标记与 `shown` 并存、`cannot_deliver` 触发、`choose_candidate` 由引擎枚举、`assertOptionsProjected(toRole, options)`（§11）；`rounds_exhausted` 的原因只经 `questionKey`，`keep_as_is` 资格是提供与回答共用的一个谓词（§11.2）；插件 16 个必需成员 + 2 个可选成员（§12.3 同 §12.1） |
