# 14 · 首个场景：软件服务范围变更（part1：目标、决定、角色、字段、目录）

> 分片：`14-scenario-scope-change.md`（§1 目标、§2 决定、§3 角色与协议参数、§4 字段、§5 目录）→ `14-scenario-scope-change-part2.md`（§6 候选空间、物化、stub、放松选项；§7 场景检查）→ `14-scenario-scope-change-part3.md`（§8 公共文本模板）→ `14-scenario-scope-change-part4.md`（§9 fixture：相对锚点、变体、金丝雀）→ `14-scenario-scope-change-part5.md`（§10 主走查 S0–S13）→ `14-scenario-scope-change-part6.md`（§11 变体走查 A–G、§12 算术核对）→ `14-scenario-scope-change-part7.md`（§13 测试、§14 不变量、§15 开放问题、§16 与 canon 的对照）。
> 底稿：candidates/security/14（目录派生的绝对交付日、加急费是目录字段、来源核对）与 deepdives/fixtures-walkthrough（走查结构、变体表、seed 原则）。吸收：fixtures-walkthrough-review r01–r14、scenario-plugin 及其反驳、spikes §0.1/§5/§6/§7、protocol-rules 与 privacy-canary 报告、foundation fixture-types。数字以 canon D27 为准；规则机制见 06。

## 1. 目标与范围

把 06 的引擎接口落成第一个场景 `scope_change`：customer 追加范围，provider 给出确认过的报价目录，finance 守住预算上限；代理在代码枚举的候选里协商，人对具体版本审批，执行写入变更单、预算承诺与任务。本章给出角色与协议参数、字段与目录 schema、插件成员（06 §12.1：16 个必需 + 2 个可选）的场景实现、公共模板、唯一一套 fixture 与变体、预算下调的完整走查、测试清单。

范围外：状态迁移（04）、模型调用（10）、执行事务（08）、页面（13），本章只引用。

## 2. 决定

| # | 决定 | 理由 | 被否决的备选 |
| --- | --- | --- | --- |
| S-D1 | 目录 = provider 确认的 5 个 `item` 行 + 1 个 `modifier` 行 `rush`；`rush` 整单计一次费用（D25 默认） | 加急费必须来自确认过的信息（核心 4，C38）；整单一次与 F14.2 一致 | 插件常量 RUSH 费（inputs/07 第 33 条）；每个条目各自的加急日期与费用（security、scenario-plugin，日期绝对值会过期） |
| S-D2 | 交付日 = `addDays(插入当天 localDate, effectiveLeadDays)`；`effectiveLeadDays = max(0, max(item.leadDays) − Σ modifier.leadDays)`，modifier 的 `leadDays` 表示"缩短天数" | 交付日由确认数据派生（D10），插入后不重算（D22）；只用 `leadDays`，硬投影无需新字段 | 模型选 `deliveryTier`（fixtures-walkthrough r02）；provider 私密产能表（D05） |
| S-D3 | rush 变体只在"该视图不知道截止日"或"基础变体晚于截止日"时生成 | 不无理由收加急费（scenario-plugin r12）；候选数压在 12 内 | rush 作为模型开关；每个组合总生成两种变体 |
| S-D4 | 字段最小集：customer 硬字段 `requiredItemKeys`、`deadline`，软字段 `preferredItemKeys`；finance 硬字段 `capCents`，派生开关 `committedCents` / `headroomCents`；provider 只有目录；各方 `notes` 永不披露 | 每个字段都有用途；没有请求 / 可延后清单，就没有 deferred 泄露面（D11） | security 的 `requestedItemKeys`、`minChangeOrderCents`；fixtures-walkthrough 的 `wantedItemKeys`、`preferredDate`、`conflictPolicy` |
| S-D5 | fixture 数字 = protocol-rules spike：5 项合计 $1,400，必需 $800，+`usage_dashboard` = $900；截止日以相对锚点 `+18` 天存储，文档与 golden 测试冻结锚点 2026-11-02（→ 2026-11-20） | D27；相对锚点让 fixture 不随真实日期过期（fixtures-walkthrough D2） | fixtures-walkthrough 的 $450/$300/$500/$150 目录（C37）；写死绝对日期 |
| S-D6 | 主 fixture 的披露：customer 把必需项与截止日披露给 provider 与 finance、把愿望清单披露给 provider；finance 只把 `capCents` 披露给 customer（U1 默认） | provider 无需预算即得到满足截止日的候选；canary 变体对 provider 隐藏截止日，专测掩码与截断。这是唯一的"主 fixture 披露"口径：07 §7.8.4 的"主 fixture"列与 16 §16.7.4 的 C1 都以 §9.2 为准，"deadline 只给 finance"只属于 canary 变体（§9.5） | 全部私密（provider 候选 16 个） |
| S-D7 | `relaxationOrder = ['customer.drop_items', 'finance.raise_cap']`；customer 被选中时其请求同时带 `extend_deadline` 选项 | D15；必需范围与截止日都是 customer 的，先问能用自身视图算出答案的人 | 同时问多人；按"绑定约束所有者"的字面规则（fixtures-walkthrough D7 自相矛盾，review r04） |
| S-D8 | stub 策略（`stubDecide`）：provider 选与已披露愿望清单重合最多的候选、再按金额低；customer 当前提案不劣于自身快照最优时建议接受，否则 counter；finance 当前提案在自身视图通过即建议接受，否则拒绝 | 确定、只读本方可见输入；与模型同一输出 schema（D26） | 按预算"用足"排序（stub 看不到预算）；按 customer 偏好给 provider 排序 |
| S-D9 | 公共文本按 `room` / `buyer` / `owner` 三受众渲染；没有任何 deferred 措辞，customer 自己看到"未纳入的愿望项" | D13、D11 | 模型写公共措辞；"EXPORT deferred" 全员可见（16 条评委反例） |
| S-D10 | 走查全部走生产写入口 + stub 驱动；seed 不预置提案、审批、执行（D18） | 核心 8；fixture 只描述输入与期望 | seed 中间状态（"已批准的 v1"） |

## 3. 角色与协议参数（插件成员 `roles`、`protocol`、`relaxationOrder`）

| role | label | side | approvalKind | budgetOwner | 审批按钮（13 绑定版本号） |
| --- | --- | --- | --- | --- | --- |
| `customer` | Customer | buyer | `terms` | — | "Approve v{n} under constraints v{m}" |
| `provider` | Service provider | seller | `terms` | — | "Accept terms v{n} under constraints v{m}" |
| `finance` | Finance | buyer | `budget` | ✓ | "Approve budget commitment v{n} under constraints v{m}" |

`protocol`：`proposerRole: 'provider'`；`evaluatorOrder: ['customer', 'finance']`；`counterRoles: ['customer']`；`maxRounds: 3`；`maxCandidates: 12`；`maxProposalsPerRolePerRun: 4`。

clarify 话题表（`topics`；05 决定何时代答）：

| topicKey | toRole | askableBy | field | answer | 说明 |
| --- | --- | --- | --- | --- | --- |
| `item_required` | customer | provider、finance | `requiredItemKeys` | `human` | 字段已披露给发问者时话题不可问（05 §5.9.1），所以 v1 不需要代码代答 |
| `deadline_value` | customer | provider、finance | `deadline` | `human` | 同上 |
| `budget_room` | finance | customer | `headroomCents` | `human` | provider 不可问（D12 ③）；回答 `disclose` 等价于 finance 打开 `headroomCents` 开关 |

没有以 provider 为所有者的话题（早稿的 `item_scope` 已删：provider 没有可披露的简报字段，对它的提问只能以自由文本作答，违反 D13）；任何角色都没有 `option_fits_constraints`（05 §5.9.1）。本表是 05 §5.9.1 的唯一取值来源。

拒绝理由封闭枚举（`reasonKeys`）：

| reasonKey | 可用者 | 他方的人看到的形式 | 他方代理 |
| --- | --- | --- | --- |
| `cannot_deliver` | provider 模型（propose 回合） | 不显示（买方只见 run 进入 `needs_input` / `run_waiting`） | 不进 |
| `missing_required_item`、`after_deadline`、`preference_not_met` | customer 模型 | **不显示**：provider 与 finance 的人只见轮次结局 "v{n} not accepted" / "Agents start round 2"（07 DX-4；`turn_completed` 对他人只是 "finished"） | 不进（05 §5.12） |
| `over_budget`、`price_too_high` | finance 模型（`price_too_high` 也给 customer） | 同上，不显示 | 不进 |
| `terms_not_acceptable`、`scope_insufficient`、`needs_earlier_delivery`、`other` | 人（`approvals.record` reject） | 全房间可见（`humanReasonKeys[].audience = 'room'`，07 DX-6、08 A13） | 不进任何他方代理上下文（canon C28） |
| `over_our_limit` | 人（finance） | `audience = 'buyers'`：customer 见 "Finance rejected v{n} · over our limit"，provider 只见 "Finance rejected v{n}"（它隐含"金额超出 finance 的私密额度"） | 不进 |

本表是 05 §5.4.1 `reasonKeys` 与 06 §12.1 成员 18 `humanReasonKeys` 的唯一取值来源；所有代理拒绝对他方的人一律不按角色显示（privacy-04 / names-14）。人类拒绝理由按声明的受众显示：默认 `room`；唯一的 `buyers` 键 `over_our_limit` 保留（07 DX-6、08 A13、12 `proposals.get.decisions[].reasonKey` 已按受众裁剪），全部键都是类别级、不含数字（08 O6），拒绝者在选项旁看到实际受众。

`roleCharters`：三段静态英文角色说明（进 10 的可缓存前缀），不含数字与私密值。

## 4. 字段（插件成员 `fields`）

| key | owner | class | valueKind | 写入口校验（失败码） | disclosableTo | 主 fixture |
| --- | --- | --- | --- | --- | --- | --- |
| `requiredItemKeys` | customer | hard | itemKeys | 每个键属于本房间曾确认过的 item 键 confirmed ∪ retired（`item.unknown`；只在草稿里 → `item.unconfirmed`），关闭伪 itemKey 自由文本信道（privacy-08）；无重复（`item.duplicate`）；**非空**、≤ 12（03 §3.6、04 §4.2.1）；已 retired 的必需项由规则报 `item.required_missing(not_offered)` | provider、finance | `['audit_log_export', 'sso_login']`，披露给二者 |
| `deadline` | customer | hard | isoDate | `localDate ≤ d ≤ localDate + 365`（`date.in_past` / `date.out_of_range`） | provider、finance | 锚点 +18 → 2026-11-20，披露给二者 |
| `preferredItemKeys` | customer | soft | itemKeys | 同上（可为空）；与 `requiredItemKeys` 不相交（`item.duplicate`） | provider、finance | `['slack_alerts', 'usage_dashboard']`，只披露给 provider |
| `capCents` | finance | hard | cents | `isCents`；`≥ committedCents`（`budget.below_committed`，D23） | customer | 500000，披露给 customer |
| `committedCents` | finance | derived | cents | 只读（Σ 台账） | customer | 不披露 |
| `headroomCents` | finance | derived | cents | 只读 | customer | 不披露 |
| `notes` | 各方 | note | text | NFC 后 ≤ 2,000 码点（03 §3.6、12 §12.9） | 永不 | 见 §9 |

```ts
// convex 边界（Zod，只在 mutation 入参）；Convex validator 只校验形状，语义在 06 validate.ts
const itemKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
export const customerBriefInput = z.strictObject({
  hardFields: z.strictObject({ requiredItemKeys: z.array(itemKey).min(1).max(12), deadline: z.iso.date() }),
  softFields: z.strictObject({ preferredItemKeys: z.array(itemKey).max(12), notes: z.string().max(8_000) }),
  disclosures: z.strictObject({ requiredItemKeys: z.array(z.enum(['provider', 'finance'])),
    deadline: z.array(z.enum(['provider', 'finance'])), preferredItemKeys: z.array(z.enum(['provider', 'finance'])) }),
});
export const financeBriefInput = z.strictObject({
  hardFields: z.strictObject({ capCents: z.int().nonnegative().max(100_000_000_000) }),
  softFields: z.strictObject({ notes: z.string().max(8_000) }),
  disclosures: z.strictObject({ capCents: z.array(z.literal('customer')), committedCents: z.array(z.literal('customer')),
    headroomCents: z.array(z.literal('customer')) }),
});
export const providerBriefInput = z.strictObject({ hardFields: z.strictObject({}),
  softFields: z.strictObject({ notes: z.string().max(8_000) }), disclosures: z.strictObject({}) });
```

（`notes` 的码点上限 2,000 在代码校验，Zod 的 8,000 只是粗上界；`requiredItemKeys` / `preferredItemKeys` 是否属于房间目录键在 06 `validateBriefFields` 用 `catalogKeys` 判。）

## 5. 目录（插件成员 `catalog`）

`CatalogDecl = { ownerRole: 'provider', maxItemRows: 12, maxModifierRows: 2, maxRowCents: 8_000_000_000, maxLeadDays: 365, titleMaxCodePoints: 80, maxTaskTemplatesPerRow: 5 }`（03 §3.7、12 §12.12）。

```ts
export const catalogRowInput = z.strictObject({
  itemKey: itemKey, kind: z.enum(['item', 'modifier']),
  title: z.string().min(1).max(320),                         // 码点 ≤ 80、^[^<>\r\n]+$ 在代码里校验
  priceCents: z.int().nonnegative().max(8_000_000_000),
  leadDays: z.int().min(0).max(365),                         // modifier 必须 ≥ 1（缩短 0 天的加急无意义）
  taskTemplates: z.array(z.strictObject({ title: z.string().min(1).max(320), assigneeRole: z.literal('provider') })).max(5),
  // 模板标题：码点 ≤ 80（03 §3.2 TEXT_LIMITS；12 §12.12 ⑥ 现写 120，已记跨章待对齐）、字符规则同目录标题，代码校验；
  // modifier 的 taskTemplates 必须为空（input.invalid，12 §12.12 ⑥、03 §3.7）
});
// catalog.confirm({ rows }) / retire 的每行按此校验；参数形状以 12 §12.12 为准（批量 rows[] 1–14 行，计一次节流）
```

语义：

- `item`：可被选入范围的工作项，`leadDays` = 从提案插入日起最早交付所需天数。`modifier`：整单可选附加项（v1 只有 `rush`），`leadDays` = 把交付缩短的天数，`priceCents` = 整单一次的费用；一个候选至多带一个 modifier。
- 任务模板由 provider 执行（`assigneeRole` 字段恒为 `catalog.ownerRole`，写入口校验），插入提案时快照为 `plannedTasks`。
- 状态：`draft`（不进规则输入）→ `confirmed` → `retired`（终态）。`catalog.confirm`：新键 → revision 1；改 `priceCents` / `leadDays` 或重新上架已 retired 的键 → 新行 `revision + 1`；只改 `title` / `taskTemplates` → `revision` 不变（06 INV-R17）；改 `kind` → `item.duplicate`；在架第 13 个 item 或第 3 个 modifier → `item.limit_exceeded`；标题格式 / 长度不合 → `input.invalid { field: 'title' }`，含定界词 → `disclosure.blocked { field: 'title' }`（06 §4、12 §12.12）；以上都受 D12 ⑥ 节流与 `price_writes` 桶（`run.rate_limited`，07 §7.13）。
- 递增：改价、改 `leadDays`、新增、撤下（含 `rush`）都改变硬投影 → `constraints.bump`；只改标题或任务模板不递增（D05、C8）。
- 已确认行的 `title`、`priceCents`、`leadDays` 全员可见；provider 的成本、产能只能写在 `notes`。
