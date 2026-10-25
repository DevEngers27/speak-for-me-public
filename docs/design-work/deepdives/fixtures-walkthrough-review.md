# 评审：fixtures-walkthrough（首个场景 fixture 与完整走查）

> 评审对象：fixtures-walkthrough.md、-part2/3/4.md、fixtures-walkthrough/scopeChangeFixture.ts。分片：本文件（结论与问题清单）→ fixtures-walkthrough-review-part2.md（声明逐条核对、跨专题命名对照）。
> 核对依据：00-brief §3、inputs/04、node_modules/convex 1.48.0 源码、其他深潜（rules-engine、negotiation-protocol、run-lifecycle、versioned-approvals、idempotent-execution、privacy-disclosure）。
> 实跑：node v24.21.0 `--experimental-strip-types` 运行 fixture 的 `enumerateAll`，另写独立脚本按本文 D5 的支配规则复算各 cap 的可行集与前沿（脚本在 scratchpad/review-fw/，不属于设计产出）。

## 1. 总评

数字本身是对的：14 个组合的金额、工作量、交付日与 §3.6 表一致，按作者自己的支配规则复算的可行集与前沿也全部一致（C3=75_000、2026-11-23；cap 474_999 → {C1, C2}，前沿 {C2}）。走查结构完整，S0–S14 每步都落到函数、表和事件上，对核心 6/8 的处理（不 seed 审批、归档不删除）是对的。

主要问题不在算术，而在**和其他专题打架**：帕累托支配规则与 06 的 `dominates` 不同，用 06 的规则主线从第一步起就会变成取舍请求；模型输出形状、人工回答后的路径、被预算挡住的提案是否落行，三处与 05 不一致；并行评估回合与 run-lifecycle 的 `nextTurnSeq` 守卫冲突。另外 D7 的字面规则与 §5.1 的结论自相矛盾。这些问题都要在合并进 14 之前统一。

## 2. 问题清单

### fixtures-walkthrough-r01 · high · 帕累托支配规则与 06 冲突，主线结局随之改变
- 描述：本文 §3.6 写"金额不进 customer 的支配关系"，只比两个软目标（含 `usage_reports` / 满足首选日）。rules-engine D9 与 `rules-engine/feasibility.ts:67-74` 的 `dominates` 把"不更贵"作为一个维度，`valueItemKeys` 是全部非必需条目（含 `csv_export`）。
- 证据：按 06 的规则复算，cap 500_000 时 C1 最便宜不被任何候选支配，前沿 = {C1, C2, C3, C4} → `NEEDS_TRADEOFF`，第 3 步就会开取舍请求而不是协商到 $900；cap 474_999 时前沿 = {C1, C2} → 取舍，与 `boundaryMinusOneCent.expectOutcome: 'single_candidate_negotiation'` 相反。本文自己的规则还没有处理软目标向量相同的平局（例如 C1 与 C6 都是 (0,0)），只是这份 fixture 里平局恰好被别的候选支配。
- 建议：在 06 拍板一个规则，fixture 只引用不重写。推荐"customer 软目标向量 + 同向量时更便宜者支配"（字典序）：保留本文的主线结局（cap 5,000 只有 C4），又消除平局；同时把 06 的 `valueItemKeys` 改成 `wantedItemKeys`，因为 `deferrableItemKeys` 里的条目不是 customer 的目标。fixture 的 `expectCustomerPareto` 改为由 06 的 `paretoFrontier` 生成的 golden。

### fixtures-walkthrough-r02 · high · 与 05 协议在三处不一致
- 描述：(a) D3 让模型输出 `itemKeys + deliveryTier`；05 的 `negotiation-protocol/model-output.ts:84` 是 `propose: { action, optionKey, rationale }`，从代码生成的候选快照里选。(b) 第 9–10 步把 customer 的选择交回 provider 代理重谈，run2 再花 3 次模型调用；05 part4 §43 的 `choose_candidate` 直接按快照候选插入 proposal（`origin: 'human_choice'`），run → `pending_approval`。(c) §5.3 写被预算挡住的 provider 方案"不成为提案（记 `blocked_by_rules`）"；05 D3 写"代码直接把 proposal 记为 blocked（派生状态）"，也就是落行。
- 证据：上述文件行号；`blocked_by_rules`、`deliveryTier` 在其他专题里都搜不到。
- 建议：(a) 采用 05 的 `optionKey`。它已经满足 D3 的意图：候选的日期和金额由代码从 `deliverySchedule` 与目录派生，模型写不出日期。(b) 采用 `choose_candidate`：customer 选中的是完全确定的候选，再让 provider 代理"提一次"只可能复述或偏离，偏离时还会无视人的选择。主线模型调用从 6 次降到 3 次加上可选的评估回合。provider 的同意由它的人工审批表达。(c) 被挡住的提案是否落行由 05/08 定一处；本文改为引用。

### fixtures-walkthrough-r03 · medium · 并行评估回合与 run-lifecycle 守卫冲突，字段名不一致
- 描述：第 4 步给 customer、finance 分配 `turnSeq` 2 和 3 并"并行"执行，同时用 `run.nextTurnSeq === turnSeq` 作为持久化守卫。run-lifecycle 的守卫 G2（`run-lifecycle/lifecycle.ts:34`）是 `run.nextTurnSeq !== turn.turnSeq → guard_rejected`，它让并行回合共用同一个 `turnSeq`、用 role 区分（索引 `by_run_and_turnSeq_and_role_and_attempt`）。照本文的编号，seq 3 先完成就会被拒。
- 证据：另有命名不一致：本文 `nextTurnSeq: 1, round: 1` 对 RL 的 `0, 0`；回合状态 `queued` 不在 `TURN_STATUSES`（running/succeeded/invalid_output/failed/stale）里；`trigger: 'budget_change'` 对 RL 的 `constraint_change`；`endedReason: 'constraints_changed'` 对 `superseded_by_constraint_change`；事件 `turn_rejected_stale` 对状态 `stale` 与错误码 `guard_rejected`。
- 建议：评估回合共用 `turnSeq`，按 (turnSeq, role) 区分；字段和枚举全部用 run-lifecycle/schema.ts 里的名字；走查只写"守卫 G1–G4 通过"，不要再写一份守卫。

### fixtures-walkthrough-r04 · medium · D7 字面规则与 §5.1 结论自相矛盾
- 描述：D7 规定"所有候选都只因预算失败 → finance；混合 → 先 customer"。§5.1（cap $4,400）中 C5、C7 同时报 `OVER_BUDGET` 与 `DATE_CONFLICT`，按字面属于"混合"，应找 customer；正文却说"失败原因全是 OVER_BUDGET → finance"。
- 证据：本文 §3.6 的 C5/C7 行与 §5.1 第一条。
- 建议：改成按单步放松判定，与 06 的 `suggestRelaxations`、05 part4 的 `computeRelaxations` 对齐：存在只因 `OVER_BUDGET` 失败的候选 → finance（`raise_cap`）；否则存在只因日期失败的候选 → customer（`extend_deadline`）；都没有 → customer（`defer_required`）。05 §3.6 的"所有候选都需要追加预算才可行 → finance"也要改用同一个表述。

### fixtures-walkthrough-r05 · medium · 无解请求的选项生成规则不自洽
- 描述：§5.1 写"每个选项 = 前沿候选所需的最小 cap"，却列出被支配的 C1（445_000），漏掉前沿上唯一的 C4（490_000）。06 的 `Relaxation` 只有一个 `minCapCents`。选项键 `raise_cap_to:445000` 把预算数字写进键里，只要某个 provider 可见的事件或日志带上 `answerKey` 就会泄露。
- 证据：§5.1 的 options；`rules-engine/feasibility.ts` 的 `Relaxation` 类型；第 9 步只对 customer 的情形规定了事件 payload 用 `choiceLabelKey`。
- 建议：选项 = {让任何候选可行的最小 cap} ∪ {放松后问题的前沿候选各自所需的 cap}，按金额升序、去重，在 06 写成一个函数。选项键用不透明的 `opt_1…`，数字只放在 `impact` 里，并按 PD 的逐选项披露类投影（privacy-disclosure-part2 第 66 行）。选项种类用 05 的 `raise_budget` / `choose_candidate` 等枚举。

### fixtures-walkthrough-r06 · medium · provider 的推断泄露比作者声明的更多，且与 PD-2 字面冲突
- 描述：作者把"provider 推断余量在 [$750, $900)"当作可接受的最小披露，05 D3 也接受同等泄露。但 privacy-disclosure PD-2 写的是"provider 永远拿不到任何预算数字或可反推它的派生值"。除这一区间外，走查里 provider 还能得到：cv3 时 v1 显示 "Fits the customer's budget"，余量 ≥ $900；时间线 `Finance constraint changed (v3 → v4)` 暴露"finance 下调了预算"；"The customer is choosing between delivery date and scope" 暴露私密的 `conflictPolicy = ask_me`；provider 若提出 C5 收到 `DATE_CONFLICT`，私密 `hardDeadline` 就被夹到 [11-23, 12-07)。
- 证据：part2 第 4、7 步与 part3 第 8 步的 P 视图文案；§5.5 日期行；privacy-disclosure.md PD-2。
- 建议：由 07 显式定义"可行性判定泄露"为被接受的残余披露，写明上界（目录价格粒度、每轮一次）。P 视图时间线不写 "Finance" 和变更原因，只写 `Constraints changed`。provider 收到的 `DATE_CONFLICT` 是否保留由 07 决定。隐私测试加入"provider 可见文本的推断上界"断言。在 07 决定之前，本文不要自行宣布"可接受"。

### fixtures-walkthrough-r07 · medium · 取舍回答写进 `briefs`，绕过 brief 版本与快照
- 描述：第 9 步给 customer 的 `briefs` 行追加 `tradeoffPreference`，既不递增 `brief.version`，也不写 `briefVersions`。这破坏了 `briefs.confirm` 的 `expectedVersion` 乐观并发：持旧版本的确认请求照样成功，还可能覆盖这条偏好。同时，被 `sourceRefs` 引用的 brief 内容不再等于任何一个快照（核心 6）。
- 证据：part3 第 9 步表变化。
- 建议：偏好的唯一来源就是 `humanRequests.answerKey`，由代理上下文组装时从已回答的请求派生；如果需要对外可见的共享事实，用只追加的 `shareableFacts` 行（05 part4 已用这个名字），带 `sourceRequestId`。
