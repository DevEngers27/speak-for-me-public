# 06 确定性规则与校验（part1：调用点、输入、求值流水线、reasonCode 与投影、时间）

> 本章分 2 个文件：part1（本文件）；part2 候选枚举、全局可行性、放宽选项、场景插件接口、共享输入校验、对 Role A 缺陷的修正。

## 6.1 定位与调用点

规则引擎是一组纯函数：不读数据库、不调模型、不读时钟（"今天"作为参数传入）。同一个 `evaluate` 在以下位置被调用，保证"界面看到的"与"执行时判定的"是同一段代码：

| 调用点 | 函数 | 输入 | 用途 |
| --- | --- | --- | --- |
| `rooms.view`、`proposals.list`、`events.list` | `evaluate` → `viewEvaluation` | 当前或历史 cv 的完整输入 | 显示检查结果（按查看者粗化，X5） |
| `decisions.decide(approve)` | `evaluate` | 当前 cv 的完整输入 + 执行时刻的今天 | 批准守卫（R06：不能批准不可执行的版本） |
| `executeInTx` | `evaluate` | 同上，含当前台账 | 执行前最后一次重算（I-18） |
| `resolveRound`、`startRun`、`bumpConstraints` | `evaluate`、`globalFeasible` | 完整输入 | 推进 run、决定新 run 的起始状态 |
| `beginTurn` | `enumerateCandidates` | 本角色视图输入（部分） | 代理候选集 |
| `openRequests` | `relaxations` | 目标角色视图输入（部分） | 人工请求选项 |
| `briefs.confirm`、`budget.update` | `validateBriefContent`、`changeGuards` | 新旧内容 + 台账 | 拒绝非法输入与越界变更 |
| 前端表单 | `validateBriefContent`、`validateCatalog` | 草稿 | 即时反馈（服务端仍会重做） |

## 6.2 输入

```ts
// packages/scenario-scope-change/src/input.ts
export type ScopeInput = {
  catalog: { versionId: string; rushFeeCents: number; items: CatalogItem[] };   // 总是已知（公开）
  requestedItemKeys?: string[];      // customer
  requiredItemKeys?: string[];       // customer
  deadline?: string;                 // customer
  minChangeOrderCents?: number;      // provider
  headroomCents?: number;            // finance：capCents − committedCents
};
// 完整输入：全部字段都有值（服务端从约束快照 + 台账组装）
export function toFullInput(s: SnapshotDocs, committedCents: number): Required<ScopeInput>;
// 视图输入：只填入本角色自己的硬字段与已对本角色披露的字段；其余为 undefined
export function toViewInput(view: RoleView<…>): ScopeInput;
```

预算检查只通过 `headroomCents` 表达（`price ≤ headroom` ⟺ `committed + price ≤ cap`），这样"把余量披露给 customer"就足以让 customer 视图里的预算检查成立，而不必披露上限与已承诺两个原始数。

**未知字段对应的检查被跳过**，这是同一个 `evaluate` 能同时服务"全局判定"与"本角色视图判定"的关键：全局输入下所有检查都执行；provider 视图下预算与截止日检查被跳过，所以 provider 的候选集不会携带任何关于预算与截止日的信息（07 T-04、T-09）。

## 6.3 求值流水线

```ts
export function evaluate(p: ProposalLike, input: ScopeInput, today: string): Evaluation {
  const checks: Check[] = [];
  // ① 来源：提案必须基于当前已发布目录，且条款可由目录逐项重算
  if (p.catalogVersionId !== input.catalog.versionId) checks.push(fail("CATALOG_STALE"));
  const unknown = p.terms.itemKeys.filter((k) => !input.catalog.items.some((i) => i.itemKey === k));
  if (unknown.length) checks.push(fail("UNKNOWN_ITEM", { itemKeys: unknown }));
  if (!unknown.length && p.catalogVersionId === input.catalog.versionId) {
    const re = deriveTerms({ itemKeys: p.terms.itemKeys, deliveryOption: p.terms.deliveryOption },
                           input.catalog, input.requestedItemKeys ?? p.terms.itemKeys);
    if ("error" in re) checks.push(fail(re.error));                     // DELIVERY_OPTION_UNAVAILABLE
    else if (re.pricingKey !== pricingKeyOf(p)) checks.push(fail("CATALOG_STALE"));  // 明细、费用、日期、价格
  }
  // ② 时间
  if (p.terms.deliveryDate < today) checks.push(fail("DELIVERY_IN_PAST"));
  // ③ customer
  if (input.requiredItemKeys) {
    const missing = input.requiredItemKeys.filter((k) => !p.terms.itemKeys.includes(k));
    if (missing.length) checks.push(fail("MISSING_REQUIRED_ITEM", { missingItemKeys: missing }));
  }
  if (input.requestedItemKeys) {
    const extra = p.terms.itemKeys.filter((k) => !input.requestedItemKeys!.includes(k));
    if (extra.length) checks.push(fail("ITEM_NOT_REQUESTED", { itemKeys: extra }));
    const deferred = sortKeys(input.requestedItemKeys.filter((k) => !p.terms.itemKeys.includes(k)));
    if (deferred.join("+") !== p.terms.deferredItemKeys.join("+")) checks.push(fail("DEFERRED_MISMATCH"));
  }
  if (input.deadline && p.terms.deliveryDate > input.deadline)
    checks.push(fail("AFTER_DEADLINE", { daysLate: daysBetween(input.deadline, p.terms.deliveryDate) }));
  // ④ provider
  if (input.minChangeOrderCents !== undefined && p.priceCents < input.minChangeOrderCents)
    checks.push(fail("BELOW_PROVIDER_MINIMUM", { gapCents: input.minChangeOrderCents - p.priceCents }));
  // ⑤ finance
  if (input.headroomCents !== undefined && p.priceCents > input.headroomCents)
    checks.push(fail("OVER_BUDGET", { shortfallCents: p.priceCents - input.headroomCents }));
  return { ok: checks.length === 0, checks, rulesVersion: "scope_change@1" };
}
```

- 等于余量算通过（`≤`）。fixture 的边界测试：余量 $750 时 LOGIN+REPORTS standard $750 通过。
- `pricingKey` 只覆盖由目录决定的部分（条目、交付方式、日期、明细、费用、价格、目录版本）；延后项由 customer 的请求范围决定，单独以 `DEFERRED_MISMATCH` 检查，因此在不知道请求范围的视图（如 provider 视图）里不会被误判。
- ① 是 RA-B04 的修正：提案引用的目录版本被新版本取代后，旧提案以 `CATALOG_STALE` 阻断；即便新目录价格相同，也要以新目录重新提出（新提案、新审批），审批永远对应它所看到的报价。
- 每条检查都报出，不在第一条失败时停止：fixture v1 同时报出 `OVER_BUDGET` 与（若适用）`AFTER_DEADLINE`（RA-F03）。粗化在投影阶段去重（07 §7.12）。
- 引擎级检查（不属于场景）：提案属于本房间、`requiredApproverRoleKeys` 非空、提案是当前提案、cv 一致。这些属于状态守卫（04 §4.9），不进入 `Evaluation`，以免把"是不是当前版本"与"条款是否合规"混在一张检查清单里（RA-B01 的命名问题：界面不再出现 "Matches current constraints"，而是 "Checked against constraints v2"）。

## 6.4 reasonCode 声明与投影

```ts
export type ReasonCodeDecl = {
  code: string; ownerRoleKey: string | null; requiresFields: string[];
  publicClass: "CATALOG" | "TIMING" | "BUYER_CONSTRAINT" | "SELLER_CONSTRAINT";
  paramFields: string[];
};
export function viewEvaluation(ev: Evaluation, viewerRoleKey: string, disclosed: Set<string>,
                               decls: ReasonCodeDecl[]): EvaluationView {
  const items = ev.checks.map((c) => {
    const d = decls.find((x) => x.code === c.code)!;
    const exact = d.ownerRoleKey === null || d.ownerRoleKey === viewerRoleKey
      || d.requiresFields.every((f) => disclosed.has(f));
    return exact ? { kind: "exact", code: c.code, params: c.params } : { kind: "class", publicClass: d.publicClass };
  });
  return { ok: ev.ok, items: dedupe(items) };          // DTO 另附 checkedAtConstraintsVersion
}
```

reasonCode 表见 07 §7.12。`disclosed` 是"已对查看者披露的 fieldKey 集合"，由 `computeSharedFacts` 的同一份数据计算。`viewEvaluation` 是 X5 的唯一实现；DTO、事件渲染、`PROPOSAL_BLOCKED` 错误参数都调用它。

## 6.5 今天与时区

- 房间建房时固定 `timeZone`（IANA）。`todayIn(tz, nowMs)` 用 `Intl.DateTimeFormat("en-CA", { timeZone })` 得到 `YYYY-MM-DD`。Convex 默认运行时对 `timeZone` 选项的支持：待验证；不支持时退回内置的固定偏移表（只支持场景声明的若干时区，文档写明夏令时误差）。
- mutation（批准、执行、回合裁决）在事务内用 `Date.now()` 计算今天，是权威判定。
- query 中的今天只用于显示：Convex query 在数据不变时可能复用缓存结果，跨越午夜后显示可能滞后（具体缓存语义待验证）；任何因此产生的不一致都会在 `decide` 时以 `PROPOSAL_BLOCKED (DELIVERY_IN_PAST)` 暴露，不会产生错误执行。
- "今天"不进入 cv（02 §2.4）：时间流逝导致的阻断由执行时重算处理，不使审批失效。

## 6.6 金额与日期的单一校验源

| 函数 | 规则 | 使用位置 |
| --- | --- | --- |
| `assertCents(n)` | `Number.isSafeInteger(n) && 0 ≤ n ≤ 100_000_000` | 简报、目录、补丁、seed |
| `parseDollarsToCents(s)` | 去掉 `$`、`,`、空格后匹配 `^\d{1,9}(\.\d{1,2})?$`，按字符串拼接换算，不经浮点乘法 | 前端输入；服务端只接收美分 |
| `parseIsoDate(s)` | `^\d{4}-\d{2}-\d{2}$` + 用 UTC 构造后回读年月日相等（拒绝 `2026-02-30`，修复 RA-B10） | 所有日期入口 |
| `isItemKey(s)` | `^[A-Z][A-Z0-9_]{1,23}$` | 目录、简报、候选 |
| `sanitizeInlineText(s, max)` | 07 §7.13 | 所有他人可见或进入他方 prompt 的文本 |

这些函数在 `packages/engine/src/validate.ts`，被 Convex mutation、前端表单与测试共同导入；不存在第二套实现。
