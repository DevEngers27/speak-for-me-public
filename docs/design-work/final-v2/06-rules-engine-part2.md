# 06 · 确定性规则引擎与场景插件接口（part2：模块、原语、RuleInput 与 hardProjection）

> 分片总表见 `06-rules-engine.md` 顶部。本片：§3 模块与依赖、§4 原语、§5 RuleInput / 角色视图 / hardProjection。

## 3. 模块与依赖

| 文件 | 内容 | 复用来源 |
| --- | --- | --- |
| `core/engine/money.ts` | `assertCents`（0 ≤ n ≤ 1e11 安全整数）、`addCents`、`sumCents`（溢出返回 `null`） | foundation money-dates（以 `{ max: 1e11 }` 调用）、protocol-rules `primitives.ts` |
| `core/engine/dates.ts` | `isIsoDate`、`addDays`、`daysBetween`、码点比较 | foundation money-dates（无 `Date`） |
| `core/engine/canonicalJson.ts` | `canonicalJson`、`candidateKeyOf` | foundation idempotency-ids |
| `core/engine/reasonCodes.ts` | `REASON_CODES`、受众声明、`vReasonCode` 的源数组 | foundation errors-result `defineReasonCodes` |
| `core/engine/checks.ts` | `CheckDecl`、`runChecks`（依赖传播）、`assemble` | rules-engine `engine.ts` |
| `core/engine/checkProposal.ts`、`budget.ts` | 引擎级检查 E1–E6、预算 B1–B2、组合插件检查 | rules-engine `scope-change.ts`、protocol-rules `rules.ts` |
| `core/engine/view.ts` | `viewFor`（构造角色视图的唯一函数，§5.2）；按角色投影检查结果的 `projectChecks` 归 07 §7.11（`core/engine/privacy/projectChecks.ts`），本章不另设投影模块 | security §6.4、foundation context-projection |
| `core/engine/candidates.ts`、`humanRequests.ts` | `enumerateCandidates`、`buildHumanRequests`、`assertOptionsProjected` | rules-engine `feasibility.ts`（修 r02/r13/r14） |
| `core/engine/executable.ts` | `isExecutable`（语义归 08） | protocol-rules `isExecutable` 四段判定 |
| `core/engine/plugin.ts`、`validate.ts` | `ScenarioPlugin` 类型；写入口语义校验 | — |
| `core/scenarios/scope-change/*` | `ScenarioPlugin` 成员（1–16 必需、17–18 可选，§12.1）的场景实现（14） | — |
| `convex/lib/ruleInput.ts`、`convex/lib/today.ts` | `loadRuleInput`（按索引读、显式白名单、不 spread）；`todayInTimeZone`（唯一接触时钟处） | rules-engine `today-adapter.ts`（去掉吞错的 `catch {}`，r09） |

依赖规则（D21，ESLint `no-restricted-imports` 强制）：`core/engine` ← `core/scenarios/scope-change` ← `convex/` ← `src/`；`core/**` 禁止 import `convex/*`、`zod`、`react`、`next/*`；引擎纯度规则禁止标识符 `Date`、`Intl`、`Math.random`、`fetch`、`console`、`process`。词汇 lint（按标识符与字符串字面量整词匹配，不按子串）：`core/engine/**` 中出现场景角色名或场景字段名 `customer` / `provider` / `finance` / `deadline` / `requiredItemKeys` / `rush` / `scope_change` 即失败（插件以字符串声明角色，引擎只按声明处理）；显式白名单只有协议封闭枚举与固定标签的字面量——`Effect.type` 的 `raise_cap` / `drop_items` / `extend_deadline`（§11.1）与 `RelaxEntry` 后缀、`REASON_CODES` 中的 `date.after_deadline`、定界块属性 `source="provider.catalog_titles"`（05 §5.13.2）——以及 schema 声明里的示例注释，白名单外的命中一律失败；放松效果的场景语义仍只在插件 `relaxations` 与回答处置里，引擎不为绕过 lint 改用不受校验的任意 patch 对象（T06-S2）。

## 4. 原语（`core/engine/money.ts`、`dates.ts`、`canonicalJson.ts`）

```ts
export const MAX_CENTS = 100_000_000_000;              // canon §1.2 assertCents 上界
export const MAX_CATALOG_ROW_CENTS = 8_000_000_000;    // 单行上限；候选 ≤ 13 行，极端溢出由 materialize 返回 null 丢弃（INV-R6）
export type Cents = number & { readonly __brand: 'Cents' };
export type IsoDate = string & { readonly __brand: 'IsoDate' };
export type ItemKey = string & { readonly __brand: 'ItemKey' };   // ^[a-z][a-z0-9_]{1,39}$（与 12 一致），不含 '+' '@'

export const isCents = (n: unknown): n is Cents =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS;
export function addCents(a: Cents, b: Cents): Cents | null;      // 越界返回 null，绝不静默
export function sumCents(xs: readonly Cents[]): Cents | null;
export function isIsoDate(s: unknown): s is IsoDate;             // 正则 + 真实日历日；拒 2026-02-30 / 2026-11-31 / 2027-02-29 / 0000-01-01
export function addDays(d: IsoDate, n: number): IsoDate;         // epoch-day 整数运算，不构造 Date
export function daysBetween(from: IsoDate, to: IsoDate): number;
export const codeUnitCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0); // 禁用 localeCompare（随区域变化）

export function canonicalJson(v: JsonValue): string;             // 键按 UTF-16 码点排序；数字必须是安全整数；拒 undefined/NaN/非普通对象
export function candidateKeyOf(c: { itemKeys: readonly ItemKey[]; modifiers: readonly ItemKey[] }): string {
  const items = [...c.itemKeys].sort(codeUnitCmp).join('+');
  return c.modifiers.length ? `${items}@${[...c.modifiers].sort(codeUnitCmp).join('+')}` : items;
}
// terms 在物化时已排好序；termsKey = canonicalJson(terms)（D25，规范串，不哈希）
// 例：{"amountCents":80000,"deliveryDate":"2026-11-16","itemKeys":["audit_log_export","sso_login"],"modifiers":[]}
```

写入口的语义校验只有这一份实现（`core/engine/validate.ts` + 插件字段声明），浏览器表单只做即时反馈、服务端重做：

| 值 | 规则 | 失败码 |
| --- | --- | --- |
| 任意金额 | `isCents` | `amount.out_of_range` |
| 目录行价格 | `isCents` 且 ≤ `MAX_CATALOG_ROW_CENTS` | `amount.out_of_range` |
| 任意日期 | `isIsoDate` | `date.invalid` |
| 简报截止日、shared fact 日期（窗口语义，spike privacy-canary 的 `4800-01-01` 通道） | `localDate ≤ d ≤ addDays(localDate, 365)` | `date.in_past` / `date.out_of_range` |
| `leadDays` | 整数 0–365 | `date.out_of_range` |
| itemKey 引用（简报、shared fact） | 合法格式且属于本房间目录（任一非草稿行）；只在草稿里出现 | `item.unknown` / `item.unconfirmed` |
| 列表 | 无重复 | `item.duplicate` |
| 目录标题（唯一进入他方代理上下文的人写字符串，D13） | 1–80 码点、`^[^<>\r\n]+$`（格式 / 长度）；NFKC 并去不可见字符后大小写不敏感地不含定界词 `untrusted_data \| room_state \| candidates \| shared_facts \| clarify_answers \| principal_brief \| principal_notes \| turn_instruction \| system` 的原文或 `&lt;` / `\\u003c` 形式（05 §5.13.2） | 格式 / 长度 → `input.invalid { field: 'title' }`；定界词 → `disclosure.blocked { field: 'title' }`（12 §12.12、14 §5 同此） |
| 预算上限变更 | `capCents >= committedCents`（等于允许） | `budget.below_committed`（`params.minAllowedCapCents` 只给 finance） |

边界 Zod（只在 convex 层）：`zIsoDate = z.iso.date().refine(isIsoDate)`（保留 SDK 支持的 `format: "date"`，r10）；`zCents = z.int().nonnegative().max(MAX_CENTS)`（`z.int()` 已拒 2^53）。

## 5. RuleInput、角色视图与 hardProjection

### 5.1 RuleInput：规则的唯一输入

```ts
// core/engine/ruleInput.ts
export type CatalogRow = {
  itemKey: ItemKey; kind: 'item' | 'modifier'; revision: number;
  status: 'confirmed' | 'retired';                       // 草稿行不进入 RuleInput
  priceCents: Cents; leadDays: number;                   // modifier 的 leadDays 含义由插件 materialize 定义（14：缩短天数）
  title: CatalogTitle; taskTemplates: readonly { title: CatalogTitle; assigneeRole: RoleKey }[];
  provenance: 'live' | 'seeded' | 'stub';
};
export type RuleInputBase = {
  localDate: IsoDate;                                    // rooms.localDate，绝不读 Date.now()
  catalog: readonly CatalogRow[];                        // 每个 itemKey 取最新非草稿行
  capCents: Cents | undefined;                           // 字段声明 semantic: 'budget_cap'
  committedCents: Cents | undefined;                     // Σ ledgerEntries.amountCents（baseline + commit），不存计数器
  headroomCents: number | undefined;                     // 派生 = cap − committed；只在可见的视图里出现
};
export type View<RI extends RuleInputBase> = Readonly<RI> & { readonly viewer: RoleKey | 'system' };   // 角色视图只由 viewFor 构造、经 isRoleView 识别（模块私有 WeakSet 登记，不是类型级品牌，§5.2）；全局视图只由插件 toRuleInput 构造
export type SharedLedger = Readonly<Record<FieldKey, { fromRole: RoleKey; value: unknown; audience: readonly RoleKey[] }>>;   // 07 §7.8.3：每个 (fromRole, field) 的最新 sharedFacts 行（撤回行不进入）；角色视图里他方字段值的唯一来源
// 场景扩展（14）：ScopeChangeRuleInput = RuleInputBase & { requiredItemKeys: readonly ItemKey[] | undefined; deadline: IsoDate | undefined }
```

`loadRuleInput(ctx, roomId)`（`convex/lib/ruleInput.ts`，query 与 mutation 共用，非纯）：

1. `ctx.db.get(roomId)` 取 `localDate`、`scenarioKey`、`scenarioVersion`；插件只经 `scenarioOf(room)` 取得（canon §1.6），房间钉住的版本未注册 → `run.invalid_state{ guard: 'scenario_version' }`（canon §1.5，与 04 M1、08 S5 同码），不抛 `internal`。
2. 每个角色按 `briefs` 的 `(roomId, role, version)` 索引倒序取第一条**已确认**版本，只取 `hardFields`（软字段另由 07 的代理上下文组装读取，不进规则；`briefs.disclosures` 只是确认表单的勾选输入，不作可见性来源）；`sharedFacts` 按 `by_room_from_field` 对每个 `(fromRole, field)` 取 `seq` 最大行，组成有效披露账本 `shared`（07 §7.8.3 的有效可见性：撤回行 `value === null` 不进入；手动共享、请求回答的披露与撤回都只在这张表里生效，不改简报）。
3. `catalogItems` 按 `(roomId, itemKey, revision)` 索引，每个 itemKey 取最大 revision 的非草稿行。
4. `ledgerEntries` 按 `roomId` 索引区间读取并 `sumCents`；`null` → 抛 `internal`（INV-R6 保证不该发生）。
5. 调用插件 `toRuleInput(docs)` 得全局输入，`loadRuleInput` 同时返回第 2 步的 `shared: SharedLedger`。显式白名单取字段，不 spread 任何文档（F07.5）。

### 5.2 角色视图 `viewFor`

```ts
export function viewFor<RI extends RuleInputBase>(
  p: ScenarioPlugin<RI>, full: View<RI>, shared: SharedLedger, viewer: RoleKey,
): View<RI> {
  const out: Record<string, unknown> = { localDate: full.localDate, catalog: full.catalog, viewer };  // 已确认目录全员可见
  for (const f of p.fields) {
    if (!(f.key in full)) continue;                        // 软字段与备注不在 RuleInput 里
    const s = shared[f.key];
    out[f.key] = f.owner === viewer ? (full as Record<string, unknown>)[f.key]                      // 本人字段：本人已确认简报 / 台账
      : s !== undefined && s.fromRole === f.owner && s.audience.includes(viewer) ? s.value         // 他方字段：只取有效 sharedFacts 行的值
      : undefined;                                         // 从不从 full 复制他方的值
  }
  if (out.headroomCents === undefined && out.capCents !== undefined && out.committedCents !== undefined)
    out.headroomCents = (out.capCents as number) - (out.committedCents as number);   // 07 §7.8.5：cap 与 committed 同时可见才派生
  return out as View<RI>;
}
```

- `viewFor(plugin, full, shared, role)` 是构造角色视图的**唯一**函数（他方字段的值只取 `shared` 中查看者在受众内的有效行，不从 `full` 复制，所以经 `sharedFacts.add` 的手动共享与撤回、请求回答的披露在下一次构造视图时即生效，07 §7.8.3），返回由 `viewFor` 构造并经 `isRoleView` 识别的 View（`viewFor` 返回前把对象登记进模块私有 WeakSet，`isRoleView(view)` 只查该集合，不是类型级品牌）；快照模式下引擎只接受这种对象，其余抛 `unprojected_view`（`viewer: 'system'` 的全局视图在快照模式抛 `system_view_in_snapshot_mode`，只在 feasibility 模式可用）；`buildHumanRequests` 的 `viewOf`、`createTurnTx` 与测试里的任何便利 helper 都只是它的薄包装、返回同一个 `View<RI>`，不另写裁剪逻辑；`enumerateCandidates(viewFor(role))` 必须给出 §13 的 golden（T06-U18 / U21）。
- 预算三字段 `capCents` / `committedCents` / `headroomCents` 都是 finance 拥有的字段（后两者 `class: 'derived'`），各自一个披露开关，只能披露给 customer（D12 ④、U1 默认全关；14 的 fixture 只开 `capCents`）。provider 视图永远没有任何预算字段。
- 视图下读不到的字段，相关检查记 `unknown`、不阻断；所以 provider 候选不携带预算与未披露截止日的任何信息（D10、C26）。
- `viewFor` 不做"派生值解密"：customer 只拿到 `capCents` 时，`headroomCents` 仍为 `undefined`，预算检查在 customer 视图里是 `unknown`（派生值继承输入中最严格的披露类，D11）；只有 `capCents` 与 `committedCents` 都对查看者可见时（两值取自同一次 `loadRuleInput` 读到的同一账本快照）才派生 `headroomCents = capCents − committedCents`，与 07 §7.8.5、§8 第 2 条的 `projectChecks` 可见性和 07 XP-2 `projectBudgetPanel` 是同一谓词；单有上限永不推出余量。

### 5.3 hardProjection

```ts
// core/scenarios/scope-change/projection.ts（插件成员 8）
export const hardProjection = (i: View<ScopeChangeRuleInput>): string => {
  if (i.viewer !== 'system') throw new PluginContractError('projection_on_view');   // 只在全局输入上算
  return canonicalJson({
    capCents: i.capCents ?? null,
    requiredItemKeys: i.requiredItemKeys ? [...i.requiredItemKeys].sort(codeUnitCmp) : null,
    deadline: i.deadline ?? null,
    catalog: [...i.catalog].sort((a, b) => codeUnitCmp(a.itemKey, b.itemKey))
      .map(r => ({ itemKey: r.itemKey, revision: r.revision, status: r.status, priceCents: r.priceCents, leadDays: r.leadDays })),
  });
};
```

投影内外的划分与理由（D05）：

| 在投影内 | 不在投影内 | 不在投影内仍然安全的原因 |
| --- | --- | --- |
| `capCents`、`requiredItemKeys`、`deadline`、目录 `(itemKey, revision, status, priceCents, leadDays)`（含 modifier） | `localDate` | 时间翻转由 `clock.rollLocalDate` 以 `cause: 'clock'` 显式 bump（D22） |
| | `committedCents` / `headroomCents` | 台账只由 setup 期的 `ledger.recordBaseline` 与执行写入，执行后房间终态（D03/D04），`open` 期间恒定 |
| | `title`、`taskTemplates` | 提案插入时已快照 `lines[].title` 与 `plannedTasks`；检查不读它们 |
| | `kind` | 同一 `(roomId, itemKey)` 的 kind 不可变，`catalog.confirm` 改 kind → `item.duplicate` |
| | 软字段、备注、披露开关、成员 | D05 不递增清单 |

`revision` 契约（INV-R8，03 落存储）：草稿不占 revision 号（确认时才分配，scenario-plugin r18）；只有 `priceCents`、`leadDays`、`status` 变化才产生 `revision + 1` 的新行；仅改 `title` / `taskTemplates` 时 `revision` 不变（03 以 `(revision, editNo)` 落存储，只改标题时 `editNo + 1`）。这样"投影比较"与"`lines[].revision` 比较"对规则相关字段给出同一结论，C8 的"改标题冻结协商"不可能发生。

`constraints.bump` 用法：`withConstraintChange`（09 §9.4）在**同一事务内**先对写入前的全局输入算一次 `hardProjection`，写入数据后再算一次，两串不同才递增；投影串**不持久化**到任何表（它含 finance 私密的 `capCents`；`constraintRevisions` 只存 `version / cause / sourceRefs`，09 §9.1.1）；`cause: 'clock'` 例外（时间结论翻转时强制递增）；`room_opened` 没有前值，直接记 v1。`hardProjection` 只有本章一份实现（09 引用，不另写）。性质测试 HP1–HP4 见 §13。
