# 14 首个场景插件：`software_change`（part1：插件实现草案）

> 场景：外包工作室（provider）与客户（customer）就已有项目的范围变更达成一致，客户内部的预算负责人（finance）控制预算。插件代码位于 `packages/scenarios/software-change/`，只依赖 `zod` 与 `@sfm/engine` 的类型。全部示例数据标 `simulated`。

## 1. 角色与审批

| roleKey | label | side | 起草提案 | 必需审批 kind | 写什么约束 |
| --- | --- | --- | --- | --- | --- |
| `customer` | Customer | requesting | 否 | `terms` | 自己的简报（必需条目、截止日、偏好） |
| `provider` | Provider | supplying | **是**（`proposerRole`） | `terms` | 目录条目（唯一 `catalog.authorRoles`） |
| `finance` | Finance | controlling | 否 | `commitment` | 账户 `change_budget` 的上限（ownerRole） |

`requiredApprovals = [{customer,'terms'},{provider,'terms'},{finance,'commitment'}]`。界面文案：terms → "Accept terms"，commitment → "Approve budget commitment"。

## 2. 目录条目 schema（provider 创建并确认）

```ts
export const catalogEntry = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('work_item'),
    title: z.string().min(1).max(80),
    priceCents: cents,                         // cents = z.number().int().min(0).max(100_000_000)
    standardDate: isoDate,                     // isoDate = z.iso.date()
    expeditedDate: isoDate.nullable(),         // 不可加急则 null；必须 <= standardDate（refine）
    taskTitles: z.array(z.string().min(1).max(80)).min(1).max(5),
  }),
  z.strictObject({ kind: z.literal('expedite_fee'), title: z.string().max(80), priceCents: cents }),
]);
```

- 目录内至多一个 `expedite_fee` 条目（写入口 `catalog.confirm` 调插件 `catalogInvariant(entries)` 检查）。
- `visibleTo`：已确认条目对全部参与方可见（provider 确认前界面提示 "Confirmed catalog entries are visible to everyone in this room"，回答开放问题 Q4）。

## 3. 简报 schema

```ts
export const customerBrief = z.strictObject({
  requiredEntryKeys: z.array(z.string()).min(1),     // 硬：必须包含
  niceToHaveEntryKeys: z.array(z.string()),           // 软：影响代理取舍，不影响可行性
  deadline: isoDate,                                   // 硬
  preferredDate: isoDate.nullable(),                   // 软
  notes: z.string().max(2000),                         // 软，私密自由文本，只进本方代理上下文
});
export const providerBrief = z.strictObject({
  minimumMarginNote: z.string().max(2000),             // 私密自由文本（例："prefer bundles with REPORTS"）
});
export const financeBrief = z.strictObject({
  notes: z.string().max(2000),                         // 预算本身不在简报里，在账本账户
});
```

| 角色 | `hardKey(payload)` | `disclosable` |
| --- | --- | --- |
| customer | `req=${sorted(requiredEntryKeys)}|dl=${deadline}` | `requiredEntryKeys`（mandatoryFor provider）、`deadline`（mandatoryFor provider）、`niceToHaveEntryKeys`、`preferredDate` |
| provider | `''`（无硬约束；其硬约束是目录本身） | 无 |
| finance | `''` | 无 |

必需条目与截止日被设为对 provider **强制披露**：provider 不知道就无法提出合法方案，且 reasonCode `sc.deadline_missed` 本身会泄露截止日的存在（开放问题 Q3 的回答：对硬约束采用"强制披露 + 提示用户"，而不是假装可以保密）。

## 4. 选择、派生、规范化

```ts
export const selection = z.strictObject({
  entryKeys: z.array(z.string()).min(1).max(8),   // 只含 work_item
  expedite: z.boolean(),
});
type Derived = { amountCents: number; deliveryDate: string; deferredEntryKeys: string[]; lines: Array<{ entryKey: string; cents: number }> };

function derive(sel, snap) {
  const items = sel.entryKeys.map(k => findWorkItem(snap, k));          // 未知键→ ok:false, 'engine.catalog_unknown'
  const fee = sel.expedite ? findFee(snap) : null;                      // 无 fee 条目→ 'sc.expedite_unavailable'
  if (sel.expedite && items.some(i => i.expeditedDate === null)) return fail('sc.expedite_unavailable');
  const lines = [...items.map(i => ({ entryKey: i.key, cents: i.priceCents })), ...(fee ? [{ entryKey: fee.key, cents: fee.priceCents }] : [])];
  const amountCents = sum(lines.map(l => l.cents));                     // 安全整数加法，超上限→ 'sc.amount_out_of_range'
  const deliveryDate = maxDate(items.map(i => sel.expedite ? i.expeditedDate! : i.standardDate));
  const requested = customer(snap).requiredEntryKeys ∪ customer(snap).niceToHaveEntryKeys;
  const deferredEntryKeys = sorted(requested − sel.entryKeys);           // "延后"由代码计算，不由模型声明
  return { ok: true, derived: { amountCents, deliveryDate, deferredEntryKeys, lines },
           ledgerImpact: [{ accountKey: 'change_budget', amountCents }] };
}
const canonicalize = (s, d) => `items=${sorted(s.entryKeys).join(',')}|exp=${s.expedite}|amt=${d.amountCents}|date=${d.deliveryDate}`;
```

## 5. 场景级检查

| code | 条件 | audience（params 可见范围） |
| --- | --- | --- |
| `sc.required_missing` | `requiredEntryKeys ⊄ entryKeys`（必需项不能被"显式延后"后通过） | room（params: 缺失 entryKey，已强制披露） |
| `sc.deadline_missed` | `deliveryDate > deadline` | room |
| `sc.date_in_past` | `deliveryDate < snap.today` | room |
| `sc.expedite_unavailable` | 选了加急但条目不支持 | room |
| `ledger.over_cap` | 由引擎检查（06 §4） | `change_budget.visibleTo = [finance, customer]` |

`niceToHaveEntryKeys` 与 `preferredDate` 不产生检查，只进入代理上下文与候选 `rank`。

## 6. 枚举与排序

`enumerate(snap, limit)`：对 work_item 的全部子集（目录 ≤ 8 项，≤ 256 种）× `expedite ∈ {false,true}`，保留"包含全部必需项且 `evaluate` 全过"的组合；`rank` 依次按：①包含的 niceToHave 数（多优先）②是否满足 preferredDate ③金额（低优先）。`candidateKey` = `c_` + contentKey 的短稳定编码（如 `c_LOGIN+REPORTS_std`），同一 snapshot 下稳定。

`stubChoose(candidates, role)`：proposer 取 rank 最高；评估方对 rank 最高者 `recommend_accept`（与真实代理共用输出 schema，回合标 `mode:'stub'`）。

## 7. 人工取舍 `tradeoffs(snap)`

| 情形（代码判定） | targetRole | 选项（optionKey → 效果） |
| --- | --- | --- |
| 候选为空且 `minRequiredCents > headroom` | `finance` | `raise_cap_to_min` → `{kind:'ledger_cap', newCapCents: committed + minRequiredCents}`；`keep_cap_close` → `{kind:'none'}` 并关闭 run |
| 候选为空且仅因截止日 | `customer` | `extend_deadline_to_<date>` → `{kind:'brief', roleKey:'customer', patch:{deadline}}`；`keep` |
| 僵持（轮次用尽，评估方偏好不同候选） | `customer` | 前两名候选各一项 → `{kind:'proposal', selection}` |
| 代理 `ask_principal` 话题 `sc.topic.scope_vs_date` | 提问代理的委托人 | 同"僵持" |

选项标签由模板生成，例如 `opt.keep_scope_later_date`："Keep {items}, deliver {date} (+{amount})"；金额只在 targetRole 可见账户时出现（给 customer 显示金额，给 provider 的同类请求不会出现，因为 provider 不是任何取舍的 targetRole）。

## 8. 执行派生 `deriveExecution`

- documents：一份 `change_order`，audienceRoles = 全部三方；body = `{entries, expedite, amountCents, deliveryDate, deferredEntryKeys}`；provider 看到的文档不含账户余额（文档本身只含本次变更金额，provider 已知）。
- tasks：每个选中 work_item 的每个 `taskTitles` 一个任务，`taskKey = ${entryKey}:${i}`，assigneeRole = `provider`。
- 账本：引擎把 ledgerImpact 写成 `{account:'change_budget', kind:'execution', amountCents}`。

## 9. 公共文本模板（英文，`templates`）

| templateKey | 文本 | 受众 |
| --- | --- | --- |
| `proposal.line` | `Provider proposes {items} for +{amount}, delivery {date}{deferredClause}.` | room |
| `check.sc.deadline_missed` | `Delivery {date} is after the deadline.` | room |
| `check.ledger.over_cap.buyer` | `+{amount} change / {committedAfter} committed after approval / {cap} cap / over by {shortfall}` | finance, customer |
| `check.ledger.over_cap.other` | `+{amount} · Blocked: exceeds the finance limit` | provider |
| `event.constraints_changed` | `{roleLabel} changed a constraint; proposal v{seq} needs review.` | room（不带数字） |
| `doc.change_order.title` | `Change order #{seq}: {items}` | 文档受众 |
