# 14 首个场景（part2）：取舍规则、stub 策略、模板、话题与原因码、记录与就绪

## 14.6 取舍规则（`tradeoffs(view, report)`：最小放宽）

输入：完整规则视图下的全部候选（排除本约束版本被拒的候选）及其检查结果。只考虑**单一角色**的放宽：一个候选的全部失败检查都属于同一角色时，该角色的放宽才能使它可行。

| 目标角色 | 触发 | 选项（意图） | 选项文案（只给目标） |
| --- | --- | --- | --- |
| finance | 存在"只失败 `budget`"的候选 | 最多 2 档 `patch_brief {budgetCapCents}`：①使至少一个候选可行的最低上限 = 已承诺 + 这些候选中的最小金额；②包含项数多于第①档候选的"只失败预算"候选中最便宜者所需的上限（若存在）；末项 `decline` | "Raising the cap to $4,450 makes LOGIN (standard, +$450) possible." |
| customer | 存在"只失败 `required_items` 且只缺 1 项"的候选 | 最多 2 个 `patch_brief {requiredItemKeys: 去掉该项}` | "Making REPORTS optional allows LOGIN (standard, +$450)." |
| customer | 存在"只失败 `deadline`"的候选 | `patch_brief {hardDeadline: 这些候选的最早交付日}` | "Moving your deadline to 2026-11-27 allows LOGIN + REPORTS + EXPORT (standard)." |
| provider | 存在"只失败 `provider_minimum`"的候选 | `patch_brief {minChangeValueCents: 这些候选中最大金额}` | "Lowering your minimum to $300 allows REPORTS (standard)." |
| provider | 只要无解（总是附带） | `edit_list {listKey:"quote"}`；不附任何预算或截止日数字 | "Add a lower-priced or reduced-scope quote line for a required item." |

- 若没有任何单角色放宽可行（例如每个候选同时失败 `budget` 与 `deadline`），则不发请求，阶段 `blocked/awaiting_trigger`，并提示需要多方一起调整（09 第 9.6 节）。多方联合放宽列入 17。
- `enablesCandidateKeys` 记录每个选项能使哪些候选可行，选项卡片据此展开条款预览。
- 选项中的数值是目标角色本人的数据或公开数据（finance 看到的上限档位由其自己的台账算出），不会把一方的私密值放进另一方的请求。

## 14.7 stub 策略（`agent.stub`，确定性）

| 角色 / 回合 | 规则 |
| --- | --- |
| provider / propose | 在 `allowedCandidateKeys` 中排序：①包含全部"对 provider 可见的必需项" ②若第 2 轮起有审阅方 counter 且其首选在允许集合中，把它排第一（采纳） ③金额降序 ④候选键；a2 时先剔除 `feedback.blocked` 中的候选；取前 5 个，`rationale` 为固定模板文本 |
| customer / review | 在 customer 可见检查都通过的候选中求"最佳"：①包含项数降序 ②是否不晚于 `preferredDate` ③金额升序；当前提案即最佳，或与最佳包含项数相同且满足偏好日（或最佳也不满足）→ `recommend_accept`；否则 `counter`，首选为最佳，原因码 `PREFER_MORE_SCOPE` 或 `PREFER_EARLIER_DELIVERY` |
| finance / review | 当前提案通过 `budget` → `recommend_accept`（提案创建即保证可执行，所以恒为接受） |
| 全部 | stub 从不 `reject` / `clarify`；需要演示这些路径时用真实模型或集成测试直接注入 `move` |

按标准 fixture，stub 的结果与 14.12 走查的终点一致：run 1 的前 5 名中前四个被预算或截止日挡住，代码选中第 5 名 `LOGIN+REPORTS@expedited`；run 2 的前 5 名全部被挡（含 `LOGIN+REPORTS@expedited`），a2 排除这些后选中 `LOGIN+REPORTS@standard`。两次审阅都是共识。stub 因此也确定性地覆盖了 a2 路径（16）。

## 14.8 模板（en，读时渲染）

| 模板 | 输入 | 例 |
| --- | --- | --- |
| `candidateLabel` | selection | "LOGIN + REPORTS · standard"；变体 "LOGIN (Admin-only SSO) · standard" |
| `termsSummary` | terms | "LOGIN + REPORTS · standard delivery by 2026-11-20 · +$750 · EXPORT deferred" |
| `termsLines`（买方，需同时看见上限与已承诺） | terms + 投影事实 | "+$750 change · $4,750 committed after approval · $4,800 cap · $50 headroom" |
| `termsLines`（其他人） | terms | "+$750 · LOGIN $450 · REPORTS $300" |
| `checkText` full / verdict_only（budget） | 投影检查 | "Over the cap by $100 ($4,900 after approval vs $4,800 cap)" / "Blocked: exceeds the finance limit" |
| `checkText`（deadline） | 同上 | "Misses your hard deadline 2026-11-23 by 4 days" / "Misses the customer's date requirement" |
| `checkText`（provider_minimum） | 同上 | "Below your minimum by $50" / "Below the provider's minimum" |
| `checkText`（required_items） | 同上 | "Missing required item: LOGIN" |
| `diffText` | 结构化差异 `{field, before, after}` | "Delivery 2026-11-13 → 2026-11-20 · Expedite fee removed · Cost −$150"；"Moves EXPORT to deferred"（与"移除"区分，RA-R14） |
| `reasonText`（约束变化） | publicReasonCode + 角色 | "Finance updated their constraints (budget revision)" |
| `tradeoffText` / `clarifyText` | 请求草稿 / 话题 | 见 14.6；"Provider's agent asks for your delivery deadline. If you share, Provider and their agent will see it." |
| `fieldValueText` | 字段值 | `budgetCapCents` → "$4,800"；`requiredItemKeys` → "LOGIN, REPORTS" |

金额格式：整美元不显示分（"$4,800"），否则两位小数；日期显示为 `YYYY-MM-DD`（以 UTC 解释日历日，避免跨时区错一天，RA-X02）。

## 14.9 话题与原因码

| 话题 topicKey | 目标角色 | 可发问角色 | 共享即披露 |
| --- | --- | --- | --- |
| `share_deadline` | customer | provider、finance | `customer.hardDeadline` |
| `share_minimum` | provider | customer、finance | `provider.minChangeValueCents` |
| `share_budget` | finance | provider | `finance.budgetCapCents` + 派生 `committedCents` |

- 拒绝原因码 `rejectReasonCodes`：`SCOPE_INSUFFICIENT`、`TOO_LATE`、`TOO_EXPENSIVE`、`TERMS_UNCLEAR`、`OTHER`（人与代理共用）。
- 还价原因码 `counterReasonCodes`：`PREFER_MORE_SCOPE`、`PREFER_EARLIER_DELIVERY`、`PREFER_LOWER_COST`、`OTHER`。

## 14.10 记录派生与就绪

- `records.commitmentCents(terms) = terms.amountCents`；`records.snapshotFields = [{kind:"brief", roleKey:"finance", fieldKey:"budgetCapCents"}]`；`agreementPrefix = "CO"`。
- `records.tasks(terms, view)`：每个 `terms.lines[i]` 生成 `{title: "Deliver " + 范围项标题 + (variantLabel ? " (" + variantLabel + ")" : ""), itemKey: scopeItemKey, assigneeRoleKey: "provider", dueDate: line.deliveryDate}`。
- `readiness(view)` 缺项码：`SEAT_OPEN`（按角色）、`BRIEF_UNCONFIRMED`（按角色）、`BUDGET_MISSING`、`SCOPE_EMPTY`、`QUOTE_EMPTY`（没有引用已确认范围项的报价行）。台账可以为空（已承诺 $0 合法）。
