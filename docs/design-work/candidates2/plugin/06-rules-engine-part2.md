# 06 规则引擎与场景插件接口（part2：第二场景 `event_budget` 草案与边界反推）

> 第二场景不在 v1 交付，但 v1 引擎接口必须能不改一行引擎代码装下它。这里写到 schema 与函数签名的粒度，用来逼出引擎边界；它的 fixture 也进入引擎的契约测试（16）。

## 1. 场景
公司团建活动：组织者（organizer）从场地方（venue）和餐饮方（caterer）的已确认报价中组合方案，财务（finance）控制活动预算。四个角色、两个供给方、**提案由需求方起草**——这三点都与 `software_change` 相反，是故意的压力测试。

| roleKey | side | 起草 | 必需审批 | 写什么约束 |
| --- | --- | --- | --- | --- |
| `organizer` | requesting | **是** | `terms` | 简报：人数、可选日期、必需类别 |
| `venue` | supplying | 否 | `terms` | 自己的目录条目 |
| `caterer` | supplying | 否 | `terms` | 自己的目录条目 |
| `finance` | controlling | 否 | `commitment` | 账户 `event_budget` 上限 |

## 2. Schema 草案

```ts
const ebCatalogEntry = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('space'), title: z.string().max(80), flatCents: cents,
                   capacity: z.number().int().min(1).max(5000), availableDates: z.array(isoDate).min(1).max(30) }),
  z.strictObject({ kind: z.literal('per_head'), title: z.string().max(80), perHeadCents: cents,
                   minHeads: z.number().int().min(1), availableDates: z.array(isoDate).min(1).max(30) }),
  z.strictObject({ kind: z.literal('addon'), title: z.string().max(80), flatCents: cents }),
]);
// catalog.authorRoles = ['venue','caterer']；space/addon 只允许 venue 创建，per_head 只允许 caterer（插件 catalogAuthorCheck）
const organizerBrief = z.strictObject({
  headcount: z.number().int().min(1).max(5000),          // 硬
  acceptableDates: z.array(isoDate).min(1),              // 硬
  requiredKinds: z.array(z.enum(['space','per_head'])),  // 硬
  preferredDate: isoDate.nullable(),                     // 软
  notes: z.string().max(2000),                           // 软，私密
});
const ebSelection = z.strictObject({ entryKeys: z.array(z.string()).min(1).max(6), eventDate: isoDate });
type EbDerived = { lines: Array<{ entryKey: string; authorRole: 'venue'|'caterer'; qty: number; unitCents: number; cents: number }>;
                   totalCents: number; byRole: Record<'venue'|'caterer', number> };
```

- `derive`：`per_head` 行的 qty = organizer 简报的 `headcount`——**派生依赖他方私密简报**。
- `hardKey(organizer) = hc=${headcount}|dates=${sorted}|kinds=${sorted}`；`disclosable`：`headcount` mandatoryFor `venue`、`caterer`（供给方不知道人数就无法报价，同时金额本身可反推人数，所以必须强制披露并提示）；`acceptableDates` mandatoryFor 两个供给方。
- `checks`：`eb.capacity_short`（space.capacity < headcount）、`eb.date_unavailable`（eventDate 不在所选条目的 availableDates 或不在 acceptableDates）、`eb.kind_missing`、`eb.min_heads`（headcount < minHeads）。
- `catalog.visibleTo(entry, viewer)`：author 本人、organizer、finance 可见；**venue 看不到 caterer 的报价**，反之亦然。
- `project.derived(d, viewer)`：organizer/finance 得全部 lines 与 totalCents；venue/caterer 只得自己 authorRole 的 lines 与 `byRole[viewer]`。
- `ledger.accounts = [{accountKey:'event_budget', ownerRole:'finance', visibleTo:['finance','organizer']}]`；`ledgerImpact = [{event_budget, totalCents}]`。
- `deriveExecution`：两份文档 `booking_order`，audienceRoles 分别是 `[organizer, finance, venue]` 与 `[organizer, finance, caterer]`；任务分派给 venue（"Hold {date}"）与 caterer（"Confirm menu for {qty}"）。

## 3. 示例数字（simulated）
HALL_A：$2,000，容量 80，日期 12-05 / 12-12；HALL_B：$1,200，容量 50；BUFFET：$45/人，最少 30；BOXED：$28/人；AV：$300。organizer：60 人、日期 {12-05, 12-12}、首选 12-05；finance 上限 $5,500，已承诺 $0。
- 候选：HALL_A+BUFFET = 2,000 + 2,700 = $4,700 ✓；+AV = $5,000 ✓；HALL_B 因容量 ✗。
- 转折：organizer 把人数改为 75（**简报硬约束变化，不是预算变化**）→ `bumpConstraints` → 旧提案 `derive` 得 2,000 + 3,375 + 300 = $5,675 → `engine.content_drift` + `ledger.over_cap` → run superseded → 新 run，候选 HALL_A+BUFFET $5,375 / HALL_A+BOXED $4,100 …

## 4. 两个插件逼出的引擎边界

| # | 两场景的差异 | 引擎因此必须提供 | 引擎因此不能知道 |
| --- | --- | --- | --- |
| B1 | 3 个角色 vs 4 个角色；起草者是供给方 vs 需求方 | `roles[]`、`proposerRole`、`requiredApprovals[]` 由插件声明，房间席位按插件生成 | 角色名、"provider 起草"的假设 |
| B2 | 目录由 1 个角色 vs 2 个角色维护，且互不可见 | `catalogEntries.authorRole`；确认/撤回只许作者；可见性回调 `catalog.visibleTo` | 条目里有什么字段（价格、容量、日期） |
| B3 | 金额只依赖目录 vs 依赖他方私密简报 | `Snapshot` 含**全部**已确认简报（服务端）；投影与派生分离 | 金额怎么算 |
| B4 | 派生结果对不同角色可见粒度不同（行级） | `project.derived(d, viewer)` 必经；`rooms.view` 永不返回原始 `derived` | 哪些行属于谁 |
| B5 | 一份 vs 两份执行文档，受众不同 | `outcomeDocuments.audienceRoles`；任务 `assigneeRole` 任意 | 文档叫"变更单"还是"预订单" |
| B6 | 都有预算上限 | 账本原语：账户 cap + 条目台账 + `ledgerImpact` 统一检查 | 账户叫什么、谁看得见（由插件声明） |
| B7 | 日期由派生得出 vs 由选择给出 | 不提供任何日期字段；只提供 `snap.today` 与房间时区 | "交付日""活动日" |
| B8 | 硬约束变化点不同（截止日/必需项 vs 人数/日期） | `hardKey` 比较决定是否 `bumpConstraints`；引擎对任何 payload 一视同仁 | 哪些字段是硬约束 |
| B9 | 约束变化后条款可能"自动变价"（人数变了金额就变） | `engine.content_drift` 检查：用当前 snapshot 重新 `canonicalize` 与存储的 contentKey 比较 | — |
| B10 | 取舍问题的对象与选项不同 | `humanRequests` 只存 `targetRole/templateKey/params/options[].effect(unknown)`；回答经 `applyAnswer` 变成 `ConstraintPatch` | 选项的业务含义 |

## 5. 边界泄露清单（实现时用 lint 规则守护）
- `packages/engine/**` 中出现以下标识符即 CI 失败：`scope|quote|delivery|deadline|itemKeys|headcount|venue|provider|customer|finance|changeOrder`（正则规则见 16 §6）。`finance` 等角色名只允许出现在 `packages/scenarios/**` 与 fixture 中。
- 引擎表字段中**不出现** `amountCents`：金额只存在于 `derived`（插件形状）与 `ledgerEntries.amountCents`/`ledgerAccounts.capCents`（账本原语，场景中立）。
- 引擎事件类型只描述引擎动作（`proposal_created`、`constraints_changed`…），场景含义只在 `params` 与模板里。
