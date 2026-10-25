# 06 确定性规则与场景插件（part3）：第二场景检验边界

> 检验问题："活动预算（event_budget）能否只写插件、不改 `engine/` 与 `convex/engine/`？"本节按插件接口逐项填写，记录哪些地方一开始不够、已在 part2 接口中修正，以及哪些需求明确不支持。

## 6.15 event_budget 插件草图

| 接口项 | event_budget 的内容 |
| --- | --- |
| `roles` | `organizer`（签 `terms`）、`vendor`（签 `terms`，能力 `list.author:offers`、`proposal.author`）、`finance`（签 `budget`，能力 `ledger.manage`）；organizer 有 `list.author:requirements`、`proposal.author` |
| `lists` | `requirements`（作者 organizer）：`{title, description}`，例如 `VENUE`、`CATERING`、`AV`；`offers`（作者 vendor）：`{requirementKey, variantLabel?, fixedCents, perGuestCents, capacity, availableDates: IsoDate[]}` |
| `briefs.organizer` | `requiredKeys`（rule，默认披露 room）、`guestCount`（rule，`format:"integer"`，`implicitInTerms: true`）、`acceptableDates`（rule，`format:"dates"`，默认私密）、`preferredDate`（preference） |
| `briefs.vendor` | `minOrderCents`（rule，私密）、`blackoutDates`（rule，私密） |
| `briefs.finance` | `budgetCapCents`（rule，默认披露给 organizer） |
| `derivedFacts` | `committedCents`（owner finance，默认披露给 organizer） |
| `selection` | `{ offerKeys: string[]; date: IsoDate }` |
| `terms` | `{ scenario:"event_budget", refs, lines:[{requirementKey, offerKey, fixedCents, perGuestCents, lineCents}], guestCount, date, amountCents, deferredKeys }` |
| `candidates.enumerate` | 每个需求至多选一个报价；日期取所选报价 `availableDates` 的交集；按作用域视图时，不可见的 `acceptableDates` 不参与过滤；超过 `maxCandidates`（2,000）时先固定必需项、按 `compare` 截断，并置 `truncated` |
| `checks` | `required_met`、`date_acceptable`（输入 organizer.acceptableDates）、`vendor_available`（公开）、`capacity_ok`（offer.capacity ≥ guestCount）、`budget`（finance）、`vendor_minimum`（vendor 私密）、`vendor_blackout`（vendor 私密） |
| `tradeoffs` | finance：上调上限到最小可行值；organizer：减少人数到可行值、放宽必需项、增加可接受日期；vendor：增加报价行 |
| `records` | `commitmentCents = amountCents`；任务：每行 "Book VENUE for 2027-03-12"（assignee vendor），外加 "Send final headcount"（assignee organizer，due = date − 7） |
| `negotiation` | proposer `vendor`，reviewers `organizer`、`finance`；clarify 话题 `share_dates`（target organizer）、`share_minimum`（target vendor） |
| `templates` | "VENUE (Hall B) + CATERING (Buffet) · 2027-03-12 · 80 guests · +$6,400" 等 |
| `fixtures` | 可行 / 需降人数 / 不可行三变体 |

## 6.16 逐项检验：需要改引擎吗

| 检验点 | 结果 | 说明 |
| --- | --- | --- |
| 三个角色、两份不同作者的清单 | 不改 | 角色与清单都是声明式；`listKey` 是引擎表的普通字段 |
| 规则字段是整数、日期数组 | **曾需要改** → 已修正 | 初版 `FieldSpec.format` 只有 cents/date/item_keys/text，引擎无法渲染整数与日期数组。修正：增加 `integer`、`dates`、`custom`，并由插件模板 `fieldValueText` 渲染 `custom`（part2 已含） |
| 人数既是私密简报字段又出现在条款里 | **曾需要改** → 已修正 | 条款对全房间公开，人数会被提案隐式披露。修正：`FieldSpec.disclosure.implicitInTerms`，引擎强制其受众为 room，并在确认时提示（part2 已含）。scope_change 没有这类字段 |
| 人数变化使旧提案失效 | 不改 | 人数是 rule 字段 → 约束递增 → 旧签核过期；引擎检查 `terms_consistent` 用当前人数重算条款，不一致即 `TERMS_MISMATCH`，提案被阻断 |
| 候选含日期维度、组合数暴涨 | 不改 | 插件负责剪枝与 `maxCandidates`；引擎只消费有序列表与 `truncated` 标志 |
| 任务派给非提出方、截止日相对活动日期 | 不改 | `TaskDraft.assigneeRoleKey` 任意角色；日期由插件计算 |
| 预算检查、取舍上调预算 | 不改 | 台账是引擎能力，金额由 `records.commitmentCents` 给出 |
| 私密检查的投影（vendor 黑名单日期） | 不改 | 由检查声明的 `inputs` 自动投影为 `verdict_only` |
| 签核类型 terms / budget | 不改 | `RoleSpec.signoff` 声明 |
| 场景专属面板（organizer 的人数与日期面板） | 不改 | `ScenarioUi.RolePanels` |

结论：在 part2 的最终接口下，event_budget 只需新增 `scenarios/event-budget/` 与组合层的三处注册（schema 联合、服务端注册表、UI 注册表）。

## 6.17 明确不支持（需要改引擎，列入 17）

| 需求 | 为什么现在不支持 | 若要支持，引擎要加什么 |
| --- | --- | --- |
| 多币种 | `currency` 固定 `USD`，台账求和假设单币种 | 台账按币种分账、汇率来源与快照 |
| 负金额（折扣冲抵、退款） | `assertCents` 要求 ≥ 0；台账只增不减（执行承诺不可冲销） | 冲销条目类型、对执行记录的修订链 |
| 一个角色多名用户、按金额分级审批 | 每角色一席、每席一人；签核恒为必需 | `seatCount > 1` 与签核策略 `requiredWhen(terms, view)` |
| 同时摆出多个候选让人挑（选项集） | 每房间同时只有一个 active 提案（I-13）；"让人选"由 `preference` 请求承担 | 选项组实体与"选中即审批"的流程 |
| 跨房间共享预算 | 台账按房间 | 房间之上的预算实体与跨房间执行锁 |
| 外部系统写入（ERP、付款） | 执行边界（核心 7） | outbox 与适配器，执行事务只写 outbox（17） |

## 6.18 为什么不把插件做成"可配置 DSL"

- 备选：用 JSON 配置描述字段与规则（低代码），引擎解释执行。
- 否决理由：规则（候选枚举、日期交集、取舍最小放宽）本质是程序；DSL 要么表达力不足，要么演化成一门语言。TypeScript 纯函数 + 类型 + 单元测试更简单、可测、可审查。插件仍是**声明 + 纯函数**，满足"场景不碰数据库、引擎不懂场景名词"的边界。
