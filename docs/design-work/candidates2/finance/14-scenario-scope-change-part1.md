# 14 首个场景：软件服务范围变更（part1：目录、约束、规则、模板）

> 场景插件目录 `convex/scenarios/scopeChange/`；fixture 是可被 Next、Convex、测试共同导入的 TS 模块 `convex/scenarios/scopeChange/fixtures.ts`。测试里的所有数字从 fixture 推出，不另写。所有 fixture 数据 `simulated: true`，界面显示 "Simulated quote" / "Simulated opening balance"。

## 1. 报价目录（fixture `baseline`）

| itemKey | kind | 标题 | 价格 | 标准工期 | 加急工期 | 派生任务标题 |
| --- | --- | --- | --- | --- | --- | --- |
| LOGIN | scope | Login revamp | $450 (45000) | 10 天 | 5 天 | Implement login revamp |
| REPORTS | scope | Reports module | $350 (35000) | 8 天 | 4 天 | Build reports module |
| EXPORT | scope | CSV/PDF export | $500 (50000) | 12 天 | 6 天 | Build export pipeline |
| RUSH | rush_fee | Rush delivery fee | $100 (10000) | — | — | （不产生任务） |

全量 LOGIN+REPORTS+EXPORT 加急 = $1,400；LOGIN+REPORTS 加急 = $900（README 的两个数字）。

## 2. 约束字段

| 角色 | 字段 | 值（fixture） | 硬/软 | 共享 |
| --- | --- | --- | --- | --- |
| customer | requiredItemKeys | [LOGIN] | 硬 | 是 |
| customer | wantedItemKeys | [REPORTS, EXPORT]（按优先级） | 软 | 是 |
| customer | deferrableItemKeys | [EXPORT] | 软（信息） | 是 |
| customer | preferredDate | 2026-11-09 | 软 | **否** |
| customer | deadline | 2026-11-16 | 硬 | 是 |
| finance | 上限 | $5,000（revision 1） | 硬 | 买方 |
| finance | 期初承诺 | $4,000（seq 1，simulated） | 硬 | 买方 |
| provider | privateNotes | "Prefer larger scope; rush is fine" | 软 | 否 |

`today` 固定为 fixture 的 `asOfDate = 2026-11-02`（测试注入；生产按房间时区计算）。

## 3. 候选全集（today = 2026-11-02）

| 组合 | 交付 | 日期 | 金额 | 上限 $5,000 下（余量 $1,000） | 上限 $4,800 下（余量 $800） | 上限 $4,400（余量 $400） |
| --- | --- | --- | --- | --- | --- | --- |
| L+R+E | rush | 11-08 | $1,400 | ✗ | ✗ | ✗ |
| L+R+E | std | 11-14 | $1,300 | ✗ | ✗ | ✗ |
| L+R | rush | 11-07 | $900 | ✓ | ✗ | ✗ |
| L+R | std | 11-12 | $800 | ✓ | ✓（= 余量，边界） | ✗ |
| L+E | rush | 11-08 | $1,050 | ✗ | ✗ | ✗ |
| L+E | std | 11-14 | $950 | ✓ | ✗ | ✗ |
| L | rush | 11-07 | $550 | ✓ | ✓ | ✗ |
| L | std | 11-12 | $450 | ✓ | ✓ | ✗（缺 $50） |

不含 LOGIN 的组合全部 `MISSING_REQUIRED_ITEM`，不进入任何候选列表。排序（06 §5）：wanted 覆盖向量 [REPORTS, EXPORT] 字典序降序 → 日期早 → 金额低。

## 4. 场景规则（插件提供，引擎调用）

- `validateProposal` = 06 §4 全部 8 项；本场景无额外规则。
- `requiredSignatures = [{customer, terms}, {provider, terms}, {finance, budget}]`。
- `budgetVisibleToRoles = ["finance", "customer"]`。
- `config = { maxRounds: 3, maxModelCalls: 12, maxChangeOrdersPerRoom: 50, maxCatalogItems: 12 }`。
- `hardKey(customer)` = `req=${sorted required}|deadline=${deadline}`；provider/finance 的 hardKey 为常量（首次确认 bump，之后只改备注不 bump）。

## 5. 公共文本模板（英文；输入只有结构化字段）

| 键 | 受众 | 模板 |
| --- | --- | --- |
| proposal.created | room | "{sourceRole} proposes {items} ({delivery}) for {amount}, delivery {date}; {deferred} deferred." |
| proposal.buyerImpact | 买方 | "+{amount} change / {committedAfter} committed after approval / {limit} limit / {headroomAfter} headroom after" |
| proposal.blocked.provider | provider | "+{amount} · Blocked: exceeds the finance limit" |
| proposal.blocked.buyer | 买方 | "+{amount} change · Blocked: over limit by {shortfall}" |
| proposal.checked | room | "Checked against constraints v{cv}" |
| turn.recommend | room | "{role} agent recommends accepting v{version} — this is not an approval." |
| rule.reject.provider | provider | "v{n} draft not proposed: {projectedCode}" |
| constraints.changed | room | "{causeLabel} changed (constraints v{from} → v{to}); earlier approvals no longer count." |
| budget.changed | 买方 | "Finance changed the limit {prev} → {limit}: {note}" |
| request.waiting | 非 target | "Waiting on {targetRole} to decide." |
| request.noFeasible.finance | finance | "No option fits the current limit. Cheapest valid option needs {needed} more. Raise limit to {toLimit}?" |
| request.chooseOption.customer | customer | "Choose one: {options}" |
| co.executed | room | "Change order CO-{n} recorded: {items}, {amount}, delivery {date}. Internal record only." |

`causeLabel`：budget_limit → "Finance constraint"；brief_confirmed → "{role} requirements"；catalog_changed / quote_expired → "Provider quote"；commitment_recorded → "Committed spend"；opening_balance → "Opening balance"。金额格式化 `formatCents(45000) = "$450"`（整数美元省略小数），日期原样 `YYYY-MM-DD`。

## 6. fixture 变体

| fixtureKey | 与 baseline 的差异 | 覆盖路径 |
| --- | --- | --- |
| baseline | — | 可行协商 → 签字 → 降预算 → 重谈 → 执行（part2 走查） |
| tradeoff | customer stub 策略 `date_first`（把 preferredDate 当成最重要的软偏好） | 降到 $4,800 后 customer 代理拒绝 L+R std，轮次用尽 → choose_option 请求 |
| infeasible | 降预算目标改为 $4,400 | 无可行方案 → finance 请求 raise_limit 到 $4,450 |
| belowCommitted | 降预算目标 $3,900 | `BUDGET_BELOW_COMMITTED`，状态不变 |
| lateItem | 追加条目 SSO $700，工期 30 天 | 只含 SSO 的提案同时报 MISSING_REQUIRED_ITEM 与 DATE_AFTER_DEADLINE（RA-B01 回归） |
