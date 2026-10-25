# 18 决策记录与开放问题（part1：ADR-01 至 ADR-10）

> 格式：背景 / 选项 / 决定 / 后果。"偏离"注明与原 README（ORIG）或 Role A 分支（RA）不同之处。

## ADR-01 余额全部由只追加台账派生
- 背景：ORIG 把 totalBudgetCents/committedCents 放在全员可见的 rooms 上，committed 与 commitments 表是两份真相；RA 也存 committedCents。
- 选项：(a) rooms 上存量字段；(b) budgets 存 limit、commitments 汇总 committed；(c) 上限与承诺都是只追加台账，余额全派生。
- 决定：(c)。`limit = 最新 budgetRevisions`，`committed = Σ commitments`，budgets 文档只存计数器并充当 OCC 锚点。
- 后果：没有漂移的可能；每次读要多一次索引查询（有界）；对账（R1–R11）可证明每个余额来自哪些分录。偏离 ORIG、RA。

## ADR-02 预算按买方/卖方披露
- 背景：ORIG 说剩余预算是 finance 私密；但 customer 与 finance 同属采购方，完全隐藏让 customer 无法理解取舍。
- 选项：仅 finance；买方（finance + customer）；finance 授权的共享事实。
- 决定：`budgetVisibleToRoles = ["finance","customer"]`，provider 永远不可见，只见 `FINANCE_LIMIT` 投影码。
- 后果：provider 可推断"超预算"这一比特，是可接受的最小披露；customer 代理看得到预算但对外输出只有 candidateKey 与模板文本。偏离 ORIG（README.md:239）。

## ADR-03 人工取舍用完整 humanRequests，选项由代码算出
- 背景：ORIG 的 needs_input 没有结构；RA 是按角色的静态提示。
- 决定：humanRequests 表；触发、targetRole、选项、影响全部由代码（`remedies`）生成；任一回答若改约束则 bump 并取消其余请求；`choose_candidate` 的回答不是签字。
- 后果：可追溯、可取消、绑定约束版本；比 optionGroupId 轻量版多一张表。偏离 ORIG（clarify target human 由模型决定）。

## ADR-04 禁止把上限降到已承诺以下
- 背景：审查建议 BUDGET_BELOW_COMMITTED → needs_input；RA 是直接拒绝。
- 选项：拒绝；进入 needs_input。
- 决定：拒绝（`BUDGET_BELOW_COMMITTED`），台账显示最低允许值。
- 后果：L3 恒成立；v1 无冲销，needs_input 在这种情况下没有任何系统内可执行的解；现实中的削减需线下冲销（17）。偏离审查 F06.3/F09.4，与 RA-R10 一致。

## ADR-05 执行也递增 constraintsVersion
- 背景：审查只把预算、简报、目录变化列为递增点；执行改变"已承诺"，也是约束输入。
- 决定：`executeProposal` 内 bump，cause `commitment_recorded`。
- 后果：constraintsVersion 唯一标识完整约束快照（含已承诺），签字绑定版本即绑定当时的余量；已执行提案的签字显示按变更单快照特判，不显示 stale。新增于 ORIG/RA。

## ADR-06 约束变化不复制提案；同一提案在新版本下重新签字
- 背景：RA-R11 降上限后复制 `revalidated` 提案（被否决）；审查 F04.2 的审批守卫要求 `proposal.constraintsVersion === room.constraintsVersion`，与"同一 proposalId 重新签字"矛盾。
- 决定：提案只记 `createdUnderConstraintsVersion`；可执行性 = 当前指针 + 当前快照下 `validateProposal` 通过；签字绑定签字时的 cv。约束变化后若当前提案仍通过，新 run 直接进入 pending_approval，不调模型。
- 后果：不产生冗余版本，不把 finance 的动作记成 provider 的提案；G-A 不比较提案的创建版本。偏离 RA-R11 与审查 F04.2 的守卫写法。

## ADR-07 模型只选 candidateKey
- 背景：审查让模型输出 itemKeys、deliveryDate；日期与条目组合仍可能不合法或被编造。
- 决定：代码枚举完整候选（条目 × 交付方式 → 金额、日期），模型输出只有 `candidateKey` 与本方 rationale。
- 后果：金额、日期、条目全部可追溯到目录修订；模型的价值在于在候选中按委托人偏好选择与说明；目录 ≤ 12 条时穷举可行。偏离 ORIG（模型给 additionalCostCents、scope 字符串）。

## ADR-08 签字分 terms 与 budget
- 背景：三方批准同一版本把外部条款签核与内部预算承诺混在一起。
- 决定：customer、provider 签 `terms`，finance 签 `budget`；同一 decisions 表、同一绑定规则、同一完整性判定。
- 后果：界面文案清楚（"Accept terms" / "Approve budget commitment"）；finance 的签字语义 = 批准写入一条承诺分录。新增于 ORIG。

## ADR-09 签字单表只追加
- 背景：RA 有 approvals 与 rejections 两表且 approve 会删除旧拒绝；审查建议 (proposal, user) 只保留最新决定（patch）。
- 决定：decisions 只追加（approve / reject / withdraw，seq 递增），"当前决定"派生为最新分录。
- 后果：完整保留"先拒后撤再批"的历史；读取时多取一次 by_proposal_user_seq desc first。偏离审查 F03.7 与 RA-D12/RA-R16。

## ADR-10 provider 候选只按公开约束过滤
- 背景：若给 provider 代理的候选按预算过滤，provider 会一次性得知可行集，等于泄露余量区间。
- 选项：完整可行集；公开可行集 + 规则闸门逐个判定。
- 决定：后者；规则闸门拒绝只返回投影码，并在本 run 内单调排除 ≥ 已拒金额的候选；闸门拒绝不消耗轮次，只消耗模型调用。
- 后果：可能多花 1–3 次调用（14 走查：run#1 3 次、run#2 4 次 provider 调用）；隐私更强。由 `maxModelCalls` 兜底成本。新增。
