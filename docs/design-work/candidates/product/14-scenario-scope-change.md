# 14 首个场景：软件服务范围变更 scope_change（part1）：角色、清单、字段、候选与条款、检查

> 本章分 3 片：part1（本文件）14.1–14.5；part2 14.6 取舍规则、14.7 stub 策略、14.8 模板、14.9 话题与原因码、14.10 记录与就绪；part3 14.11 fixture 与变体、14.12 预算下调完整走查、14.13 变体 B 走查。
> 插件位置：`scenarios/scope-change/`（`index.ts` 服务端纯入口，`ui/` 客户端片段）。`key: "scope_change"`，`version: 1`，`currency: "USD"`。

## 14.1 角色

| roleKey | label | capabilities | signoff | joinDisclosure（摘要） |
| --- | --- | --- | --- | --- |
| `customer` | Customer | `list.author:scope`、`proposal.author` | `terms` | "Your required items are shared with the room by default; your deadline, preferred date and notes stay private unless you share them. Others see whether a proposal meets your date requirement (yes/no)." |
| `provider` | Provider | `list.author:quote`、`proposal.author` | `terms` | "Everyone sees your confirmed quote lines. Your minimum change value and notes stay private; others see only whether a proposal meets your minimum." |
| `finance` | Finance | `ledger.manage` | `budget` | "Everyone sees whether a proposal fits your budget (yes/no). Your cap and committed spend are shared with the customer by default; the provider never sees them unless you share." |

`negotiation`：`proposerRoleKey: "provider"`，`reviewerRoleKeys: ["customer","finance"]`，`maxRounds: 3`，`maxRankedCandidates: 5`。

## 14.2 清单

| listKey | 作者 | data | 校验（`lists[listKey].validate`） | maxItems |
| --- | --- | --- | --- | --- |
| `scope` | customer | `{list:"scope", title, description}` | title 1–80 字符；description ≤ 500 | 12 |
| `quote`（报价行） | provider | `{list:"quote", kind:"line", scopeItemKey, variantLabel?, priceCents, standardDate, expeditedDate?}` | `scopeItemKey` 是已确认的范围项；`assertCents(priceCents)` 且 > 0；`standardDate ≥ today`；`expeditedDate` 若有则 `today ≤ expeditedDate ≤ standardDate`；variantLabel ≤ 60 | 30 |
| `quote`（加急费） | provider | `{list:"quote", kind:"expedite_fee", priceCents}` | itemKey 必须为保留键 `EXPEDITE`；`assertCents`；全清单至多一个 | — |

- 报价行的 itemKey 通常与范围项同名（`LOGIN`）；同一范围项的变体用新键（`LOGIN_LITE`），一个候选对每个范围项至多选一行。
- 报价行确认即全房间可见，这是报价的本意（Q4 的决定：报价在 provider 确认时公开，确认对话框明确提示）。

## 14.3 简报字段

| 角色 | fieldKey | kind | format | 确认必填 | 披露默认 | 校验 |
| --- | --- | --- | --- | --- | --- | --- |
| customer | `requiredItemKeys` | rule | item_keys | 否（可为空） | room | ⊆ 已确认范围项键 |
| customer | `hardDeadline` | rule | date | 否 | none | ≥ today |
| customer | `preferredDate` | preference | date | 否 | none | ≥ today；若有截止日则 ≤ 截止日 |
| provider | `minChangeValueCents` | rule | cents | 否 | none | `assertCents` |
| finance | `budgetCapCents` | rule | cents | 是 | `["customer"]` | `assertCents`；场景守卫 ≥ 已承诺（`CAP_BELOW_COMMITTED`） |
| finance（派生） | `committedCents` | — | cents | — | `["customer"]` | 引擎台账汇总 |

所有角色另有引擎字段：私密 `notes`（≤ 4,000）、`sharedNote`（≤ 500，需披露项 `shared_note`）。公开原因码 `publicReasonCode` 枚举：`budget_revision`、`scope_update`、`schedule_update`、`quote_update`、`correction`、`other`。

## 14.4 候选与条款

### 选择（selection）

`{ scenario:"scope_change", lineKeys: string[] /* 报价行 itemKey，排序 */, schedule: "standard" | "expedited" }`；候选键 `lineKeys.join("+") + "@" + schedule`，例如 `LOGIN+REPORTS@standard`。

### 枚举（`candidates.enumerate`）

```ts
function enumerate(view: RuleView<SC> | ScopedRuleView<SC>) {
  const scope = confirmed(view.lists.scope);                         // 有序：按范围清单顺序
  const lines = confirmed(view.lists.quote).filter(l => l.data.kind === "line" && !l.expired
                  && scope.some(s => s.itemKey === l.data.scopeItemKey));
  const fee = confirmed(view.lists.quote).find(l => l.itemKey === "EXPEDITE" && !l.expired);
  const perScope = scope.map(s => [null, ...lines.filter(l => l.data.scopeItemKey === s.itemKey)]);
  const out = [];
  for (const combo of cartesian(perScope)) {                         // 超过 maxCandidates(2,000) 时先固定必需项再截断
    const chosen = combo.filter(Boolean);
    if (chosen.length === 0) continue;
    out.push(sel(chosen, "standard"));
    if (fee && chosen.every(l => l.data.expeditedDate)) out.push(sel(chosen, "expedited"));
  }
  return out.sort((a, b) => compare(toTermsUnchecked(a, view), toTermsUnchecked(b, view)));
}
```

排序 `compare`：①包含的范围项数降序 ②交付日升序 ③金额升序 ④候选键字典序。作用域视图下照样枚举（隐藏字段不影响枚举，只影响检查）。

### 条款计算（`candidates.toTerms`）

1. 每个 `lineKey` 必须是 confirmed 当前版本且未过期，且每个范围项至多一行；否则 `{error}`。
2. 每行 `deliveryDate = schedule === "expedited" ? expeditedDate : standardDate`。
3. `feeCents = expedited ? EXPEDITE.priceCents : 0`；`amountCents = Σ priceCents + feeCents`，`assertCents`。
4. `deliveryDate = max(行交付日)`。
5. `includedItemKeys` = 所选行的 `scopeItemKey`（按范围清单顺序）；`deferredItemKeys` = 已确认范围项 − 已包含（解决 RA-B13：未报价的请求项也计入延后）。
6. `refs` = 已包含范围项的当前版本 + 所选报价行 + （加急时）`EXPEDITE`。

## 14.5 检查

| checkId | inputs | 通过码 / 失败码 | 判定 | params（投影为"结"时移除） |
| --- | --- | --- | --- | --- |
| `non_empty` | 公开 | `SCOPE_NONEMPTY` / `EMPTY_SCOPE` | `includedItemKeys.length ≥ 1` | — |
| `required_items` | `customer.requiredItemKeys` | `REQUIRED_ITEMS_MET` / `REQUIRED_ITEM_MISSING` | `required ⊆ included`；必需项不能以"显式延后"通过（ADR-23） | `missing: string[]` |
| `deadline` | `customer.hardDeadline` | `DEADLINE_MET` / `DEADLINE_MISSED` | 未设截止日 → 通过；否则 `deliveryDate ≤ hardDeadline` | `hardDeadline`、`lateByDays` |
| `date_not_past` | 公开 + today | `DATE_VALID` / `DATE_IN_PAST` | 每行交付日 ≥ today | `earliestDate` |
| `budget` | `finance.budgetCapCents`、派生 `committedCents` | `BUDGET_FITS` / `BUDGET_EXCEEDED` | `committedCents + amountCents ≤ budgetCapCents`（等于上限通过） | `committedAfterCents`、`headroomAfterCents` / `overByCents` |
| `provider_minimum` | `provider.minChangeValueCents` | `MINIMUM_MET` / `BELOW_PROVIDER_MINIMUM` | 未设 → 通过；否则 `amountCents ≥ min` | `shortByCents` |
| `expedite_available` | 公开 | `EXPEDITE_OK` / `EXPEDITE_UNAVAILABLE` | 加急时费用行存在且每行有加急日 | — |

再加引擎检查 `source_resolvable`、`source_current`、`source_unexpired`、`terms_consistent`（06 第 6.5 节）。投影矩阵见 07 第 7.4 节。

Role A 的缺陷回归（RA-B01、RA-B11）：标准 fixture 中 `LOGIN+REPORTS+EXPORT@standard` 既超预算（$5,250 > $5,000）又晚于截止日（11-27 > 11-23），两个失败码同时报出；只比较版本号的"Matches current constraints"不存在，对应文案改为 "Checked against constraints v{n}"。
