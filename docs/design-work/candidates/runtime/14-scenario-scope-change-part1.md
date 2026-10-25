# 14 首个场景：软件服务范围变更（part1）：角色、目录、约束字段、规则与评分

> 分片：part1 本页；part2 公共文本模板、取舍请求规划算法、fixture 规格；part3 预算下调的完整走查与其他路径。
> 插件目录：`convex/scenarios/scopeChange/`（`plugin.ts`、`validators.ts`、`rules.ts`、`candidates.ts`、`planner.ts`、`templates.ts`、`prompts.ts`、`stub.ts`、`fixtures.ts`）。`key = "scope_change"`，`version = 1`。所有 fixture 数据标 simulated（核心 8）。

## 14.1 角色

| roleKey | 标签 | 所属方 | 目录所有者 | 协议角色 | 审批类型 | 代理的职责 |
| --- | --- | --- | --- | --- | --- | --- |
| `customer` | Customer / project owner | buyer | — | reviewer | terms | 让方案满足业务需要：必需范围、截止日、重要项、首选日期 |
| `provider` | Service provider | seller | ✔ | proposer | terms | 在可行候选中提出可交付的方案，兼顾自己的交付偏好 |
| `finance` | Finance owner | buyer | — | reviewer | budget | 从支出角度给出建议；不做算术（算术由代码完成），只解释与表态（F10.17：保留一次简短的模型回合，使"三方代理都调用模型"如实成立） |

`maxRounds = 3`；`requiredApprovals = [customer/terms, provider/terms, finance/budget]`。

## 14.2 范围目录与条目

条目键由 customer 的 `requestedItems` 命名（键 + 标题，对全房间披露），provider 为这些键确认报价条目；另有一个条款条目 `RUSH`。标准 fixture（种子日 D0；示例取 D0 = 2026-11-02）：

| itemKey | 标题 | 价格 | 标准交付 | 加急交付 | 任务标题 |
| --- | --- | --- | --- | --- | --- |
| `LOGIN` | SSO login migration | $450 | D0+18（2026-11-20） | D0+11（2026-11-13） | Deliver SSO login migration |
| `REPORTS` | Monthly usage reports | $350 | D0+18（2026-11-20） | D0+11（2026-11-13） | Deliver monthly usage reports |
| `EXPORT` | CSV and Excel data export | $500 | D0+32（2026-12-04） | D0+25（2026-11-27） | Deliver CSV and Excel export |
| `RUSH`（term） | Expedited delivery | 每个方案 +$100 | — | — | （不生成任务） |

一个方案 = 条目集合 + 交付方式（standard / rush）。交付日 = 所选条目在该方式下的最晚日期；金额 = 条目价格之和 + 加急费。与 README 数字对齐：全量 LOGIN+REPORTS+EXPORT 加急 = $1,400；一期 LOGIN+REPORTS 加急 = $900，执行后已承诺 $4,900（SC-02、SC-09）。

## 14.3 约束字段

| 角色 | 字段 | 硬 / 软 | 默认受众 | 可选受众 | 进入 ruleKey |
| --- | --- | --- | --- | --- | --- |
| customer | `requestedItems[{itemKey,title}]` | 硬（定义范围） | room（固定） | room | ✔ |
| customer | `requiredItemKeys` | 硬 | room | private / room | ✔ |
| customer | `importantItemKeys` | 软 | private | private / room | — |
| customer | `deadline` | 硬 | private | private / room | ✔ |
| customer | `preferredDate` | 软 | private | private / room | — |
| provider | `preferredDeliveryMode`（standard / rush / either） | 软 | private | private / room | — |
| finance | `budgetCapCents` | 硬 | roles[customer] | private / roles[customer] | ✔ |
| 各方 | `privateNotes`（≤ 2,000） | — | 本人（固定） | — | — |

场景 Zod 的范围校验：`requiredItemKeys ⊆ requestedItems`、`importantItemKeys ⊆ requestedItems − required`、`|requestedItems| ≤ 12`、日期为真实日历日且 `preferredDate ≤ deadline`、`budgetCapCents` 通过 `assertCents`。provider 的产能、付款条件（GAP-14）在 v1 只作为私密备注进入本方代理上下文，不进入规则；付款条件作为第四个协商维度见 17。

就绪条件见 04 §4.11；首个场景额外要求每个 `requiredItemKeys` 都有已确认的目录条目。

## 14.4 规则、候选与评分

- 检查集（06 §6.3）：`engine.current`、`engine.sources`、`engine.terms`、`scope.items`、`scope.required`、`scope.deferred`、`date.rush`、`date.deadline`、`date.today`、`budget.cap`。
- 候选枚举与公开排序见 06 §6.5。已执行变更单中的条目记入快照的 `executedItemKeys`，之后的候选只在剩余请求范围内枚举；因此"修订已执行的协议"（ADR-25）自然变成"谈第二期"：主线执行后，延后的 EXPORT 成为下一次协商的唯一范围，不会重复承诺 LOGIN、REPORTS。请求范围全部执行完毕时就绪检查返回 `nothing_left`。
- `scoreForRole(roleKey, candidate, ownBrief)` 只在两个地方使用：stub 代理（10 part6）与质量评估（16 §16.6，比较 live 代理的表态与本方偏好是否一致）。它读本角色的私密软偏好，**从不**用于对他方可见的排序：

| 角色 | 评分（越大越好；平局按公开排序） | stub 表态 |
| --- | --- | --- |
| customer | `+2 × 包含的 important 项数` `+1 × (deliveryDate ≤ preferredDate)` | 当前提案是本方最高分 → recommend_accept；否则第 1 轮 counter 最高分候选（理由码由差异推出：缺重要项 → `prefers_more_scope`，晚于首选日 → `prefers_earlier_date`）；第 2 轮起 recommend_accept |
| provider | `+1 × (deliveryMode 符合 preferredDeliveryMode 或其为 either)` `+ 条目数 × 0.1` | 提议：第 1 轮选公开排序第一；之后选评审 counter 中支持最多者 |
| finance | 所有可行候选同分（finance 只关心是否在预算内；可行候选都在预算内） | 总是 recommend_accept |

**提示包要点**（`prompts.ts`，`PROMPT_VERSION = "scope_change.v1.0"`）：
- 场景规则段：解释候选是什么、为什么候选都已满足硬约束、条目与加急的含义、交付日与金额由系统计算。
- 角色章程：customer 代理"优先保住你的委托人标记为重要的条目，其次是首选日期，再次是成本"；provider 代理"提出你能可靠交付、且最可能被接受的方案；你看不到买方预算"；finance 代理"从支出角度表态；候选都在预算内，除非你的委托人在备注中有额外偏好，否则倾向接受"。
- 每个角色都被要求：只输出 JSON；理由一到三句，只写给自己的委托人；不复述委托人的私密数字。

## 14.5 场景理由码与问题键

| 词表 | 值 |
| --- | --- |
| 评审理由码 `reviewer` | `prefers_more_scope`、`prefers_earlier_date`、`prefers_lower_cost`、`prefers_standard_delivery`、`scope_insufficient`、`date_unacceptable`、`cost_unacceptable` |
| 提议方拒绝 `proposerReject` | `no_acceptable_candidate`、`capacity_conflict` |
| 人工拒绝 `humanReject` | `price_too_high`、`date_too_late`、`scope_insufficient`、`prefer_other_option`、`other` |
| 澄清问题（代理可发起） | `q.defer_item`、`q.flexible_date`、`q.price_flex`、`q.budget_flex`（05 §5.7） |
| 升级问题（只由代码发起） | `q.budget_shortfall`、`q.budget_below_committed`、`q.cheaper_quote`、`q.deadline_conflict`、`q.earlier_delivery`、`q.relax_required`、`q.no_option`、`q.agent_declined`、`q.rejection_loop` |
