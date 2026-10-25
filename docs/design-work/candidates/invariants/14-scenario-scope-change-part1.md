# 14 首个场景：软件服务范围变更 · part1：角色、字段、码表、规则、公开文本模板

## 1. 场景与组织假设

- 一家中型客户（有独立的预算负责人）向外部软件工作室提出一个变更请求：在已签约的分析门户上加若干功能。三方：customer（项目负责人）、provider（工作室）、finance（客户方预算负责人）。
- **假设（待产品验证，F01.4）**：finance 与 customer 是同一家公司的不同人；provider 愿意在客户发起的房间里协商，因为这能更快拿到明确的书面范围与审批。小企业里 finance 常由项目负责人兼任——本设计不允许一人占两席（ID-4），这种组织需要另一位同事担任 finance，或等待"同一用户多角色"的产品决定（18）。
- 首个场景只协商**范围、价格、交付日期**三个维度；付款条件只作为 finance 的私密备注，不进入规则（17 扩展）。

## 2. 角色与字段目录（`FieldSpec`，07 的矩阵由此生成）

角色（`RoleSpec`）：

| roleKey | 标签 | 必需审批 | 审批类别 | 有代理 | 回合中的位置 | 必需 acknowledgements |
| --- | --- | --- | --- | --- | --- | --- |
| customer | Customer / project owner | 是 | terms | 是 | evaluate | `requested_items_public`、`agent_moves_public`、`check_outcomes_public` |
| provider | Service provider | 是 | terms | 是 | propose | `offer_lines_public_on_use`、`agent_moves_public`、`check_outcomes_public` |
| finance | Finance owner | 是 | budget | 是 | evaluate | `agent_moves_public`、`check_outcomes_public` |

`turnPlan = { proposer: "provider", evaluators: ["customer", "finance"], maxRounds: 3 }`。

字段：

| 角色 | 字段 | 类别 | 可披露 | 强制/预设披露 | 规则用途 |
| --- | --- | --- | --- | --- | --- |
| customer | `requestedItems[]`（itemKey、title、description） | 规则 | — | 强制：房间（P3） | 共享词表；deferred = requested − included |
| customer | `requiredItemKeys` | 规则 | 是 | 无预设 | `scope.required` |
| customer | `deadline` | 规则 | 是 | 无预设 | `date.deadline` |
| customer | `preferredDate` | 软 | 是 | 无预设 | `date.preferred`（info） |
| customer | `notes` | 备注 | 否 | — | 只进 customer 代理 |
| provider | `offerLines[]`（itemKey、variantKey、label、priceCents、earliestDeliveryDate、validUntil?、taskTitle） | 规则 | 是（整份目录） | 强制：被提案/选项引用的行（P4） | `source.*`、`date.earliest`、金额 |
| provider | `capacityNotes`、`notes` | 备注 | 否 | — | 只进 provider 代理 |
| finance | `budgetCapCents` | 规则 | 是 | 表单预选"披露给 customer"（买方同侧，F07.1），由 finance 确认时决定 | `budget.cap` |
| finance | `externalCommittedCents` | 规则 | 是 | 同上 | 已承诺基线（GAP-16） |
| finance | `paymentNotes`、`notes` | 备注 | 否 | — | 只进 finance 代理 |

规模上限（保证 06 §8 的穷举）：请求项 ≤ 8；每项变体 ≤ 3；itemKey `^[A-Z][A-Z0-9_]{1,31}$`；variantKey `^[a-z][a-z0-9_]{0,15}$`；单行价格 ≤ $1,000,000。

## 3. 码表（全部定义在 `convex/scenarios/scopeChange/codes.ts`，模板与投影只认这些码）

| 用途 | 码 |
| --- | --- |
| 检查失败（06 §3） | `ITEM_UNKNOWN`、`DUPLICATE_ITEM`、`LINE_NOT_OFFERED`、`SOURCE_MISMATCH`、`OFFER_EXPIRED`、`REQUEST_CHANGED`、`REQUIRED_ITEM_MISSING`、`DELIVERY_BEFORE_EARLIEST`、`DELIVERY_IN_PAST`、`DELIVERY_AFTER_DEADLINE`、`OVER_BUDGET`、`AMOUNT_MISMATCH`；info：`MISSES_PREFERRED_DATE` |
| 代理 reject | provider：`CANNOT_SERVE_REQUEST`、`NEEDS_OFFER_REVISION`；customer：`SCOPE_UNACCEPTABLE`、`DATE_UNACCEPTABLE`、`PRICE_UNACCEPTABLE`；finance：`BUDGET_CONCERN`、`PAYMENT_TERMS_CONCERN` |
| customer counter | `NEED_ITEM`、`DEFER_ITEM`、`DATE_TOO_LATE`、`PRICE_TOO_HIGH`、`PREFER_VARIANT` |
| 问题码（clarify） | `IS_ITEM_DEFERRABLE`、`LATEST_ACCEPTABLE_DATE`、`HAS_LOWER_PRICED_VARIANT`、`BUDGET_HEADROOM`（05 part1 §3） |
| 人工拒绝（decisions） | customer：`SCOPE_UNACCEPTABLE`、`DATE_UNACCEPTABLE`、`PRICE_UNACCEPTABLE`；provider：`TERMS_UNACCEPTABLE`、`CAPACITY_CONFLICT`；finance：`BUDGET_POLICY`、`PAYMENT_TERMS` |
| 请求重谈 | `CONSTRAINTS_IMPROVED`、`WANT_DIFFERENT_SCOPE`、`OTHER` |
| 请求问题 | `NO_FEASIBLE_PACKAGE`、`ROUNDS_EXHAUSTED`、各问题码 |
| 简报校验 | `BUDGET_BELOW_COMMITTED`、`EXTERNAL_ABOVE_CAP`、`REQUIRED_NOT_REQUESTED`、`TOO_MANY_ITEMS`、`TOO_MANY_VARIANTS`、`DUPLICATE_LINE`、`INVALID_DATE`、`INVALID_CENTS`、`MISSING_ACK` |

## 4. 规则

检查集、预算规则、日期语义见 06 §3–§5；可行性枚举与取舍见 06 §8–§9；执行派生见 06 §11（每个包含的报价行一个任务，指派 provider，截止 = 交付日）。场景特有的规则只有两条补充：
- 交付日是整个变更的一个日期（不做按行交付）；provider 选择的交付日必须 ≥ 所选行 earliest 的最大值（provider 自己的数据，违反记 invalid_output）。
- 变体是同一请求项的不同报价（例如 USAGE_REPORTS 的 full 与 lite）；一个提案中同一项至多一个变体。

## 5. 公开文本模板（英文；`withNumbers` 仅在全部参数对查看者可见时使用）

| key | 模板 |
| --- | --- |
| `proposal.summary` | "{author} {proposed \| counter-proposed} v{version}: {itemTitles} for {amount}, delivery {date}{; deferred: {deferredTitles}}." |
| `proposal.author` | "Provider agent" / "Provider agent (simulated)" / "{customerLabel}, chosen from options" |
| `check.OVER_BUDGET` | withNumbers："Over budget: {committedAfter} committed after approval vs {cap} cap (over by {overBy})." · without："Blocked: exceeds the finance limit." |
| `check.OVER_BUDGET.pass` | withNumbers："Within budget: {committedAfter} of {cap}." · without："Within the finance limit." |
| `check.DELIVERY_AFTER_DEADLINE` | with："Delivery {date} is after the deadline {deadline}." · without："Delivery date misses the customer's deadline." |
| `check.REQUIRED_ITEM_MISSING` | with："Missing required: {titles}." · without："Leaves out an item the customer requires." |
| `check.SOURCE_MISMATCH` | "The provider changed the offer for {lineLabel} after this proposal." |
| `check.OFFER_EXPIRED` | with："Offer for {lineLabel} expired on {validUntil}." · without："An offer in this proposal has expired." |
| `check.MISSES_PREFERRED_DATE` | "Delivers after the customer's preferred date."（仅对能看到 preferredDate 的人显示日期） |
| `checks.header` | "Checked against constraints v{n}."（替代 Role A 的 "Matches current constraints"） |
| `event.constraints_changed` | "{role} updated {category} constraints (v{from} → v{to}).{ Reason: "{sharedReason}"}" |
| `event.reapproval_required` | "Terms of v{n} are unchanged; constraints moved to v{to}. Approvals must be given again." |
| `event.agent_move` | "Customer agent recommends accepting v{n} (advice, not an approval)." / "Customer agent asks for changes: include {a}; exclude {b} ({reasons})." / "Finance agent raised a concern: {reason}." |
| `event.decision_recorded` | "{role} {accepted the terms of \| approved the budget commitment for \| rejected \| withdrew approval of} v{n} under constraints v{cv}{: {reason}}." |
| `event.execution_completed` | "Change order CO-{number} recorded from v{n}: {amount}, {taskCount} tasks. Internal record only." |
| `event.request_waiting` | "Waiting on {role} to answer a {kind} request." |
| `request.NO_FEASIBLE_PACKAGE` | customer："No confirmed offer fits all current constraints. Which change would you accept?" · finance："No proposal fits the current budget." · provider："No proposal fits the current constraints ({reasons}). Revise your offer?" |
| `option.make_optional` | "Make {titles} deferrable — a package then fits." |
| `option.raise_cap_to_fit` | "Raise the cap to {toCents} so v{n} ({amount}) fits." |
| `option.relax_deadline_to_fit` | "Move the deadline to {toDate} so v{n} fits." |
| `option.choose_package` | "{itemTitles} — {amount}, delivery {date}." |
| `request.disclosure` | "{askerRole}'s agent asks: {questionPhrase}. Share the answer?"；选项 "Share with {askerRole}" / "Share with everyone" / "Don't share" |
| `execution.banner` | "Internal record only. No payment, transfer, contract signature, or ERP update happens in Speak for Me." |
| `simulated.badge` | "Simulated" — 用于 isSimulated 的报价、简报、回合、提案、变更单 |
