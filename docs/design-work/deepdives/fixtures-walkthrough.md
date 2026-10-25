# 专题深潜：首个场景 fixture 与完整走查（part1：目标、决定、fixture 明细）

> 分片：本文件（§1 目标与范围、§2 决定与理由、§3 fixture 明细与可行性表）→ fixtures-walkthrough-part2.md（§4 主线走查 S0–S7）→ part3（§4 S8–S14）→ part4（§5 反例与边界、§6 seed/reset、§7 测试、§8 接口、§9 待验证）。
> 代码：fixtures-walkthrough/scopeChangeFixture.ts（fixture 与纯函数，已用 node 24 `--experimental-strip-types` 跑过全部组合，下表数字为实际输出）。
> 本文所有数据都是 **simulated**。函数名是工作名，最终以 12-api 为准（见 §8）。

## 1. 目标与范围

目标：给 14-scenario-scope-change 提供一套**只定义一次**、带行项目明细、能把原 README 的 $5,000 / $4,000 / $1,400 / $900 / $4,800 讲成一个有结局的故事的 fixture；并用它把引擎的全部关键路径（私密简报确认、协商、确定性校验、版本化审批、约束变更阻断、代码判定的取舍请求、原子幂等执行）逐步走一遍，每步落到函数、表、事件和三方界面文案。

范围内：fixture 数据与派生规则；主线走查 S0–S14；无解变体、边界变体（恰等于余量 / 差 1 分）、低于已承诺变体；seed / archive / purge 设计；由 fixture 驱动的测试清单。
范围外：表结构全貌（03）、状态机全表（04）、模型 prompt（10）。这里只用到它们的最小子集，并在 §8 列出需要对齐的字段。

## 2. 决定与理由

| # | 决定 | 理由 | 否决的备选 |
| --- | --- | --- | --- |
| D1 | 采用 F14.2 第 1 套"带加急费行项目"的思路，但改价：`sso_login` $450 / `usage_reports` $300 / `csv_export` $500 / `expedite_fee` $150 | 全量加急 $1,400、一期加急 $900 与原 README 一致；降到 $4,800（余量 $800）后**主线落在 $750，不压边界**；$800 不再是任何含必需项组合的价格（唯一 $800 的组合 `csv_export+usage_reports@standard` 缺 `sso_login`），边界测试改由 finance 降到 $4,750 制造（同一目录，见 §5.2） | F14.2 原价（A+B 标准 = $800 恰等于余量，主线踩边界，与"主线不落在边界上"冲突）；第 3 套（降预算后只剩一个组合，演示不出取舍） |
| D2 | 日期存为相对锚点的天数，seed 时按房间时区解析；文档与 golden 测试用锚点 2026-10-26 | 绝对日期过几周就落到过去，`DATE_IN_PAST` 会让 fixture 失效；测试注入固定锚点保证可重复 | 写死 2026-11-20 一类绝对日期（Role A 做法） |
| D3 | 交付日期由代码从 provider 已确认的 `deliverySchedule`（私密产能）派生；模型只选 `itemKeys` + `deliveryTier` | 核心 4：日期与金额都不能由模型发明；产能是 provider 私密输入，不能交给别人的代理 | 模型输出 `deliveryDate` 后由代码比对（多一个可被模型写错的字段，且需额外 reasonCode） |
| D4 | customer 的"必需/想要/可延后"放在 customer brief；目录只描述供给 | F02.1 整理者注：必需与否是 customer 的判断 | 在目录条目上标 priority |
| D5 | 取舍请求由代码在 run 开头的可行性预检里决定：可行集非空，且 customer 的软目标帕累托前沿 ≥ 2，且 `conflictPolicy = 'ask_me'` → 开 `humanRequests(kind:'tradeoff', targetRole:'customer')`，不调模型 | F05.6：升级给人由代码决定、选项由代码生成；把"要日期还是要报表"交给代理等于让代理替人做价值判断（核心 2） | 先让 provider 代理出方案、customer 代理拒绝后再升级（多两次模型调用，结果仍由代码决定，徒增不确定性） |
| D6 | customer 的取舍回答记录为**软偏好**，不递增 constraintsVersion，run 从 needs_input 回到 negotiating | F09.1【改写】：软偏好不使旧审批失效；回答前没有任何有效审批可失效 | 回答即 bumpConstraints 并新建 run（版本号膨胀，且语义错误） |
| D7 | 无解时目标人按"绑定约束的所有者"确定：所有候选都只因预算失败 → finance；都只因日期失败 → customer；混合 → 先 customer（必需范围与截止日都是 customer 的） | 原文"相关的人"是空白（GAP-12）；规则可测、确定 | 同时向两人开请求（两个回答可能冲突，需要合并规则） |
| D8 | seed 只写到"三份 brief 为 draft、预算与基线为 draft"为止；**不 seed 确认、提案、审批**；dev 环境允许一个带标注的 `briefs_confirmed` 快进 | 审批与确认是人的行为，预置它们等于伪造（核心 8）；回答 Q11 | 阶段快照直接写入"已批准的 v1"（F15.1 允许但须来自真实 run 存档，v1 不做） |
| D9 | reset = 归档（room.status → closed，`archivedAt`），每次排练 seed 新房间；硬删除只在 dev 且仅限 `isSimulated && fixtureKey` 的房间 | 核心 6 历史不可篡改；已打开的 `/rooms/[roomId]` 不失效 | 原地删除重建（URL 全部失效、历史丢失） |
| D10 | 金额口径：`amountCents`（本次变更）、`committedAfterCents`（批准后已承诺合计，派生）、`headroomCents`（余量，派生），三者分开命名；后两者只给买方 | F14.3、GAP-03 | 沿用"$4,900 方案"这种混合口径 |

## 3. fixture 明细（全部 simulated）

### 3.1 参与方与房间

| 字段 | 值 |
| --- | --- |
| `rooms.title` | Harbor Lane Clinics - Q4 portal scope change (simulated) |
| `rooms.timezone` | America/Los_Angeles |
| `rooms.isSimulated` / `fixtureKey` | true / `scope_change.v1` |
| `runs.maxRounds`（场景配置） | 2 |
| customer | Harbor Lane Clinics (simulated)，Product owner |
| provider | Fernway Software (simulated)，Delivery lead |
| finance | Harbor Lane Clinics Finance (simulated)，Budget owner |

### 3.2 provider 目录（provider 确认后全房间可见）

| itemKey | title | priceCents | effortDays | taskTemplates |
| --- | --- | --- | --- | --- |
| `sso_login` | SSO login (SAML via Okta) | 45_000 | 4 | Implement SAML SSO login and admin toggle |
| `usage_reports` | Monthly usage report dashboard | 30_000 | 3 | Build monthly usage report dashboard |
| `csv_export` | CSV export for audit logs | 50_000 | 5 | Add CSV export for audit logs |

| termKey | kind | deltaCents | 条件 |
| --- | --- | --- | --- |
| `expedite_fee` | `rush_fee` | 15_000 | `deliveryTier === 'expedited'` |

### 3.3 provider 私密产能 `deliverySchedule`（只有 provider 与其代理可见）

| tier | maxEffortDays | 交付日（偏移 → 规范日期） |
| --- | --- | --- |
| expedited | 7 | +21 → 2026-11-16 |
| expedited | 12 | +28 → 2026-11-23 |
| standard | 7 | +28 → 2026-11-23 |
| standard | 12 | +42 → 2026-12-07 |

规则：组合的交付日 = 同 tier 中第一个 `maxEffortDays ≥ Σ effortDays` 的行；没有匹配行 → `NOT_DELIVERABLE`。共享政策："No fixed price without a confirmed scope"；共享偏好："Prefers phased delivery"。私密备注带金丝雀 `CANARY-PROV-4K9`。

### 3.4 customer brief

| 字段 | 层 | 披露 | 值 |
| --- | --- | --- | --- |
| `requiredItemKeys` | hard | shared | [`sso_login`] |
| `hardDeadline` | hard | **private** | +35 → 2026-11-30 |
| `wantedItemKeys` | soft | shared | [`usage_reports`]（"想在本期拿到"） |
| `deferrableItemKeys` | soft | shared | [`usage_reports`, `csv_export`] |
| `preferredDate` | soft | shared | +21 → 2026-11-16 |
| `conflictPolicy` | soft | **private** | `ask_me` |
| 私密备注 | — | private | "Security audit starts Dec 1 …" + `CANARY-CUST-7Q2` |

### 3.5 finance

| 字段 | 位置 | 披露 | 值 |
| --- | --- | --- | --- |
| `totalBudgetCents` | `budgets` | 买方（customer + finance） | 500_000（seed 为 draft，finance 确认 brief 时一并确认） |
| 基线承诺 | `commitments(kind:'baseline', isSimulated:true)` | 买方 | 400_000，"Existing SOW: portal maintenance Q3-Q4 (simulated)" |
| 规则 | 代码常量 | 全员知道规则存在 | 新承诺必须 finance 批准（`REQUIRED_APPROVER_ROLES`）；`committed + amount ≤ total` |
| `paymentTerms` | brief soft | private | `milestone`（只影响 finance 代理的措辞，不进规则） |
| `budgetDisclosure` | brief | — | `buyer_side`（F07.1 推荐方案） |
| 私密备注 | — | private | `CANARY-FIN-8M1` |

### 3.6 全组合可行性表（锚点 2026-10-26；硬截止 2026-11-30；首选日 2026-11-16）

`enumerateAll` 穷举 3 项 × 2 档 = 14 个组合。不含 `sso_login` 的 6 个一律 `MISSING_REQUIRED_ITEM`，下表只列含必需项的 8 个（候选 id = 排序后的 itemKeys + `@tier`）：

| # | 候选 id | 金额 | 工作量 | 交付日 | cap 5,000（余 1,000） | cap 4,800（余 800） | 软目标（报表 / 首选日） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | `sso_login@standard` | $450 | 4 | 11-23 | OK | OK | ✗ / ✗ |
| C2 | `sso_login@expedited` | $600 | 4 | 11-16 | OK | OK | ✗ / ✓ |
| C3 | `sso_login+usage_reports@standard` | $750 | 7 | 11-23 | OK | OK | ✓ / ✗ |
| C4 | `sso_login+usage_reports@expedited` | $900 | 7 | 11-16 | OK | `OVER_BUDGET`(+$100) | ✓ / ✓ |
| C5 | `csv_export+sso_login@standard` | $950 | 9 | 12-07 | `DATE_CONFLICT` | `OVER_BUDGET`+`DATE_CONFLICT` | — |
| C6 | `csv_export+sso_login@expedited` | $1,100 | 9 | 11-23 | `OVER_BUDGET` | `OVER_BUDGET` | — |
| C7 | 全量 `@standard` | $1,250 | 12 | 12-07 | `OVER_BUDGET`+`DATE_CONFLICT` | 同左 | — |
| C8 | 全量 `@expedited`（原文 "full change $1,400"） | $1,400 | 12 | 11-23 | `OVER_BUDGET`(+$400) | `OVER_BUDGET`(+$600) | — |

读法：
- cap $5,000 时 C4 同时满足两个软目标，帕累托前沿只有 C4 → 不需要取舍，协商收敛到 **$900 一期（延后 `csv_export`）**，批准后已承诺 $4,900。
- cap $4,800 时 C4 超出 $100；可行集 {C1, C2, C3}；C1 被 C2、C3 支配；前沿 {C2, C3} 互不支配 → `conflictPolicy = ask_me` → 代码向 customer 开取舍请求："保首选日、延后报表（+$600）" vs "要报表、晚一周交付（+$750）"。主线 customer 选 C3。
- C7 同时报 `OVER_BUDGET` 与 `DATE_CONFLICT`（满足 RA-F03 修正一的回归要求）。
- 帕累托比较只看 customer 软目标；金额不进 customer 的支配关系（金额是 finance 的硬约束，已在可行性里处理）。
