# 审计：W1-1 规则引擎与插件契约（part 1/3）

- 代码：`/Users/zhennn/speak-for-me-wt/_audit` @ origin/main `c7864d9`（W1-1 = PR #32 / `eb8ff8d`；之后只有 W0-F 改了 `core/engine/plugin.ts` 3 行，抽出 `SCENARIO_KEY_PATTERN`）。`core/engine/protocol/` 不存在。
- 设计：`final-v2` 当前版本（06 全部分片；08 §8.4.1–8.4.2；00-canon D01/D02/D03/D10/D12，另引用 D15/C54、§1.5；14 §4/§5/§6/§11/§12；00-invariants 1.1–1.8）。`_changes/CN-001` 只涉及 10-agent-runtime 的重试预算，与本块无关。读到的设计没有明显处于半修改状态的文件，但有几处章间不一致，已在对应条目注明。
- 方法：逐条读实现和测试；另把 `core/` 复制到 scratchpad，用 Node 24 去类型执行做行为探针（`scratchpad/audit/probe-rules/scripts/probe1.ts`），worktree 内没有改动任何文件。
- 任务归属（来自 GitHub issue）：W1-1 #9 = `checkBudget` / `checkProposal` / `isExecutable` / `evaluateApprovalSet`；W1-2 #10（open）= `enumerateCandidates` / `materialize` / `hardProjection`；W1-3 #11（open）= scope_change 插件成员；W1-5 #13（open）= `buildHumanRequests`；W2-1/W2-2/W2-3/W2-4 = 写入口与编排。W1-1 的 PR 已提前合入 W1-2 与 W1-5 范围内的函数，所以这些函数也在本次审计范围内，但偏离归到对应的 open 任务去修。
- 外部评审 W1-1-r01…r07 已核对：r01–r05、r07 在 main 上已修复；r06 里的 `assertOptionsProjected` 被延后，在 main 上仍然存在，记入 AUD-RULES-05。

**统计**：satisfied 25 · deviates 13 · not_implemented_yet 11 · unverifiable 2（共 51 条，part1 的 A 节 + part2 的 B–E 节）。偏离清单 AUD-RULES-01…13 见 `rules-part3.md`。

## A. 不变量总表中属于本块的条目

| 编号 | 状态 | 代码位置 | 说明 |
| --- | --- | --- | --- |
| INV-06 | satisfied | core/engine/rules/view.ts:14-35 | 按**检查**的 owner 判定 exact。非 exact 的失败检查合并成一条 `private.constraint_unmet`，不带 checkId 和计数；非 exact 且通过的检查直接省略；provider 只拿到 `{audience:'provider', fit}`；参数按 PARAM_AUDIENCE 过滤，未声明的丢弃。测试：contract.test `seller receives only fit while buyer parameters follow disclosures`；review.test `r05: projection contract` 下的 3 个用例。 |
| INV-08 | satisfied | view.ts:36-45；checkProposal.ts:66-72 | `headroomCents` / `overByCents` 只在 `headroomCents` 开关可见时才下发；只开 `capCents` 时 customer 看到的仍是掩码（探针 8 与 06 §6.3 的表一致）。测试：contract.test 同上（`{headroomCents:['customer']}` 分支）。T06-P6 的非干扰性质测试缺失，见 AUD-08。 |
| INV-09 | satisfied | core/engine/rules/candidates.ts:12-41 | 按视图枚举；provider 视图没有预算字段，候选不按预算过滤；最多 12 个；截断按 `(amountCents, candidateKey)`，展示按码点序；首轮锚点放最便宜的候选；`exclude` 由调用方传入。测试：contract.test `hidden budget changes cannot affect seller candidates`；review.test 中的 `anchor puts the cheapest…`、`mustInclude retains…`、`16 candidates truncate to the 14 §11 F golden snapshot`。快照落库归 W2-4。 |
| INV-10 | deviates | core/engine/rules/humanRequests.ts:6-44；types.ts:21-23 | 收件人按 `viewOf(role)` 选择，这部分正确。但是：没有 `blocked` 效果；没有在写入前做 06 §11.3 #5 的 `assertOptionsProjected`（W1-4 的同名函数只接受用 `type` 判别、由 `projectRequestOptions` 构造的选项，buildHumanRequests 的输出用 `kind` 判别，接不上）。见 AUD-RULES-04、05。 |
| INV-11 | satisfied（引擎部分） | view.ts:17；plugin.ts:76 | provider 只得到 fit；seller 的 `option_fits_constraints` 话题在注册时会被拒绝。canon D12 ③ 已经把禁令扩大到任何角色，这一条另记在 D12 行（AUD-03）。频率和节流归 W2-1 / W2-4。 |
| INV-24 | satisfied（纯函数部分） | core/engine/rules/hardProjection.ts:7-16 | 只投影 `class:'hard'` 字段和目录的 5 个列（itemKey、revision、status、priceCents、leadDays），不含 localDate、台账、标题、任务模板、kind；只接受全局输入（`projection_on_view`）。测试：rules.test `projection excludes %s` / `projection includes %s`，CE-044…046；review.test `T06-P4: equal hard projection implies equal blocking…`。`constraints.bump` 归 W2-3。 |
| INV-26 | satisfied | core/engine/rules/approvals.ts:45-92 | 与 08 §8.4.1 逐行一致：取 seq 最大的行，以当前成员为准，`boundConstraintsVersion` 和 `boundTermsKey` 都要匹配，旧 cv 上的 reject 判为 `stale_reject`，旧 cv 上的 withdraw 判为 `pending`。测试：rules.test `approval %s`（11 种）、`CE-%s approval binding and current membership`。 |
| INV-27 | satisfied（纯函数部分） | approvals.ts:58-79 | 按集合判定，不按计数；同一 userId 占两个槽 → `self_conflict`；持有人数不等于 1 → `vacant`。测试同上（`self_conflict` / `duplicate_holder` / CE-052）。读取完整区间是 W2-2 的责任。 |
| INV-28 | not_implemented_yet | — | `requiredApprovals = roles.map(...)` 应在 insertProposal 时快照，引擎里没有对应 helper（测试里是内联推导）。归 W2-4（turns.complete / insertProposal）。注册时已拒绝空 roles（plugin.ts:50）。 |
| INV-35 | deviates | core/engine/rules/executable.ts:7-24 | `ok` 的布尔结论正确，也不比较 createdAtConstraintsVersion（review.test `CE-053…`）。但原因码与 08 §8.4.2 不一致：会多出 `run.invalid_state`，还可能同时给出多个守卫码；没有导出 `isCurrentForApproval` / `allApproved` / `canExecuteNow`，所以条目里要求的 `allApproved` 命名没有落实；返回形状也不同。见 AUD-RULES-01。 |
| INV-36 | satisfied（纯函数部分） | checkProposal.ts:43-46；materialize.ts:47-49 | 交付日在物化时写成绝对日期；检查只有 `date.in_past`、`date.out_of_range`（插件另有 `after_deadline`），都是闭区间。测试：rules.test `absolute date at %s`、`date window offset %s`、`deadline plus %s days`。`clock.rollLocalDate` 归 W2-3 / W2-7。 |
| INV-37 | satisfied | materialize.ts:9-19, 41-51；checkProposal.ts:42 | `amountCents = Σ lines`；只比较快照内部的数据，不按当前目录重新定价；modifier 本身就是目录行。测试：battery `INV-37`、`CE-091`；rules.test `modifier price is a catalog line…`、`revision change does not reprice snapshots`。 |
| INV-38 | satisfied（规则部分） | checkProposal.ts:21-41；materialize.ts:20-28 | E1–E4 依次依赖；条目被撤下时 E4 记 `not_evaluated`，不会崩溃；重复键报 `item.duplicate`；必需项缺失报 `item.required_missing`。测试：battery `INV-38`；rules.test `retirement skips source comparison…`；review.test `retired required item yields the declared empty reason`。`item.unconfirmed` 属于写入口，归 W2-1。 |
| INV-39 | satisfied（规则部分） | core/engine/rules/budget.ts:5-20；checkProposal.ts:48-49 | `committed + amount <= cap` 时通过，等号也通过；B1 失败时 B2 记 `not_evaluated`，所以低于已承诺额时只报 `below_committed`；所有检查都跑，不短路。测试：rules.test `budget: spike cases…`、`collects late and over together in check order`、`below committed blocks B2 without reporting over`、`budget monotonicity across 2000 deterministic boundary pairs`；battery CE-073 / CE-074。`validateCapChange` 已经就绪，写入口拒绝归 W2-1。 |
| INV-41 | not_implemented_yet | candidates.ts:22 | 引擎侧的 `exclude` 已就绪；`turns.complete` 只在快照内解析 `optionKey`、`action.repeats_blocked` 这两项归 W2-4。 |
| INV-43 | satisfied（引擎部分） | materialize.ts:41-48；candidates.ts:21 | 插件返回非法金额或非法交付期时抛 `PluginContractError`（最终是 internal）；求和溢出时丢弃该候选。测试：rules.test `plugin invalid amount %s throws`；battery CE-082 / CE-090。 |
| INV-45 | not_implemented_yet | plugin.ts:36-41 | 注册表 `pluginFor(room)` 还没有（W2-1）。scope_change 目前仍通过 Legacy 重载注册，会跳过 §12.2 的全部校验（AUD-11，W1-3）。 |
| INV-64 | deviates | humanRequests.ts:21-34 | 按 relaxationOrder 走"自身视图为空且有放松选项"的选择和 disclose 回退都正确（review.test `skips a feasible buyer…`、`falls back to disclosure…`）。但收件人不是末位时没有给出 canon D15 / C54 要求的 `pass_to_next {toRole}`（探针 3）。见 AUD-04。 |
| INV-65 | deviates | humanRequests.ts:8, 39 | `keep_as_is` 只看 `keepAsIsUsed`。入参里没有 `limitHit`，所以 attempt / 美元上限触发的 `rounds_exhausted` 仍然会给出 `keep_as_is`（探针 2），违反 D15 和 04 §4.8.3。见 AUD-04。到期处理归 W2-7。 |
