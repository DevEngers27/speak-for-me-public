# 09 · 约束变化（part1）：目标与决定、硬投影、递增矩阵

> 分片（按顺序阅读）：
> 1. `09-constraint-changes.md`（本文件）：9.0 目标与决定、9.1 什么是约束（硬投影）、9.2 递增矩阵
> 2. `09-constraint-changes-part2.md`：9.3 `constraintRevisions` 表、9.4 `withConstraintChange` / `constraints.bump` / `react()` 不动点
> 3. `09-constraint-changes-part3.md`：9.5 约束变化后 run 的处置、9.6 各写入口规格（参数 / 守卫 / 读写 / 失败码）、9.7 预算低于已承诺
> 4. `09-constraint-changes-part4.md`：9.8 预算下调到 $4,800 的完整走查、9.9 变体（$4,700、$4,799.99、$3,900、上调、被拒不复活、改标题、无关改价、跨午夜、回合在途、并发）
> 5. `09-constraint-changes-part5.md`：9.10 历史保留与重放、9.11 不变量、9.12 备选与否决、9.13 测试、9.14 开放问题、9.15 与 canon 的对照
>
> 底稿：`candidates/product/09-constraint-changes*`（递增调用点全表、生效来源快照、重放）、`candidates/security/09-constraint-changes.md` §9.4（约束变化后三分支）。吸收：`deepdives/versioned-approvals-part2/part3` 与反驳 r01/r02/r03/r05/r10/r11/r14、`candidates2/eventsourcing/09`（反应链与因果）、`inputs/07` 时间类 / 标题冻结 / 单层反应 / 复活被拒提案条目。命名与决定以 `00-canon*.md` 为准（D05、D06、D22、D23 为本章主轴）。

## 9.0 目标与决定

**目标**：精确回答"什么变化会让已给出的审批失效"，并保证（1）不漏递增——规则结论可能变化的写入一定递增 `constraintsVersion`；（2）不多递增——同值写入、改标题、改偏好不会无故作废审批；（3）递增之后 run、提案、请求在同一事务内被处置到一个有出口的状态；（4）每个版本都能回答"为什么是 vN、谁改的、改了哪些来源"。

| # | 决定 | 理由 |
| --- | --- | --- |
| CC-D1 | `rooms.constraintsVersion` 只经 `constraints.bump` 改变，每次恰好 +1；是否调用由 `withConstraintChange` 的**硬投影比较**决定，而不是由各调用点手写判断 | RA-B02 正是"开发者判断这次不算约束变化"导致的漏递增；投影与规则读同一份 `RuleInput`，"规则输入变了 ⇔ 版本变了"（canon D05） |
| CC-D2 | 硬投影 = `canonicalJson({ capCents, requiredItemKeys, deadline, catalog[{itemKey, revision, status, priceCents, leadDays}] })`；目录在投影内；`localDate`、已承诺额、标题、任务模板、软字段、披露、成员不在投影内，各有替代防线（9.1.2） | 价格来源必须受版本保护（核心 4）；被排除的输入要么在 `open` 期间恒定，要么由快照或单独机制兜底 |
| CC-D3 | 目录 `revision` 是**定价修订号**：只有 `priceCents` / `leadDays` / `status` 变化才 +1；只改 `title` / `taskTemplates` 插入同 `revision`、`editNo + 1` 的新行（9.1.3） | canon D05 要求"仅改标题不 bump"，D25 又用 `lines[].revision` 判 `version.stale_source`；只有定价修订号能同时满足二者，消除 inputs/07"改标题冻结协商" |
| CC-D4 | 上调预算同样 bump，旧审批一律变 stale；不按"terms / budget 类"分类失效 | 核心 3"约束变了必须重新审批"要简单可解释；分类失效需要证明无关性（versioned-approvals D11） |
| CC-D5 | 执行不 bump；`setup` 期写入不逐条 bump，开房（`setup → open`）时一次 bump 到 v1 | 执行后房间终态，无可失效的审批（canon D03/D04）；`setup` 期没有 run / 提案 / 审批，逐条 bump 只制造噪音 |
| CC-D6 | bump 同事务：取代当前非终态 run、其 active 提案 → `stale`、open 请求 → `superseded`，然后 `react()` 迭代到不动点（深度上限 4）开新 run；新 run 预检可直接 `pending_approval` 沿用同一 `proposalId`；被拒提案不参与 | canon D06；关闭 inputs/07 的单层反应、活性死锁 1、复活被拒提案三类反例 |
| CC-D7 | 时间不进投影；`clock.rollLocalDate` 推进 `rooms.localDate`，只有当当前 `pending_approval` 提案或 open 请求选项的时间结论翻转时才 `bump(cause: "clock")` | 把 today 放进投影会每天午夜作废全部审批（canon D22 否决 R-I）；不处理则跨午夜静默卡死（inputs/07 ≥ 8 条） |
| CC-D8 | 新上限低于已承诺额 → 直接拒绝（`budget.below_committed`），不写任何行、不 bump | 系统内没有合法出路；保持"余量恒 ≥ 0"（canon D23） |
| CC-D9 | 每个 cv 恰一行 `constraintRevisions { cause, actorUserId, sourceRefs }`，不存任何约束值 | 回答"为什么是 vN"（核心 6）且不把私密值写进他方可达的表 |

## 9.1 什么是约束：硬投影

### 9.1.1 规则输入与投影

```ts
// 规则输入的形状归 06 §5.1（这里只摘本章用到的字段）：loadRuleInput(ctx, roomId) 在 query 与 mutation 共用；
// checkProposal / passesChecks / buyerFeasible / hardProjection 读同一个对象
export type RuleInputBase = {
  localDate: IsoDate;                 // = rooms.localDate，绝不读 Date.now()；不进投影（9.1.2）
  catalog: readonly CatalogRow[];     // 每个 itemKey 的当前行（confirmed | retired），不含 draft
  capCents: Cents | undefined;        // finance 最新已确认简报的硬字段
  committedCents: Cents | undefined;  // Σ ledgerEntries.amountCents；open 期间恒定
  headroomCents: number | undefined;  // 派生，只在可见视图里出现
};
export type ScopeChangeRuleInput = RuleInputBase &
  { requiredItemKeys: readonly ItemKey[] | undefined; deadline: IsoDate | undefined };   // 14
// CatalogRow（03 §3.7）：{ itemKey, kind, revision, editNo, status, priceCents, leadDays, title, taskTemplates, … }

// hardProjection 的唯一实现在 06 §5.3（core/scenarios/scope-change/，签名 View<ScopeChangeRuleInput> → string），本章不另写实现：
// 形状即 canon D05 —— canonicalJson({ capCents, requiredItemKeys（排序）, deadline, catalog: [{ itemKey, revision, status, priceCents, leadDays }]（按 itemKey 排序）})；
// 本章的 bump 与测试 CC-02 / CC-03 直接调用 06 的导出（T06-S6 式的"仓库内只有一个导出名为 hardProjection 的函数"结构测试同样适用）
```

- 投影只在事务内存中求值（before / after），**从不持久化**：它含 finance 私密的 `capCents`；存哈希也不行——上限的值域小，可被枚举反推（versioned-approvals D4 否决 c）。
- v1 provider 的硬字段只有目录（没有 `earliestStartDate`），三方全部硬字段都在规则输入里，规则不存在"已声明却未校验"的硬约束（inputs/07 核心 4 反例）。
- 性质测试 CC-02："`localDate` 与 `committedCents` 相同时，投影相等 ⇒ 任意提案的阻断集合相等"（与 06 §13 HP1–HP4 同一组）；CC-03："改任一投影字段 ⇒ 投影不等；只改排除字段 ⇒ 投影相等"。

### 9.1.2 不在投影内的输入与替代防线

| 输入 | 为什么不进投影 | 替代防线 |
| --- | --- | --- |
| `localDate` | 进投影会每天作废全部审批（canon D22） | 交付日在提案插入时物化为绝对日期、之后不重算；`clock.rollLocalDate` 只在结论翻转时 bump（9.6.7） |
| `committedCents` | `open` 期间恒定：基线只能在 `setup` 录入（`ledger.recordBaseline` 在 `open` 拒绝），`commit` 只由执行写，执行后房间终态 | 执行事务内重读台账区间重算（08）；INV-CC-06 |
| 目录 `title` / `taskTemplates` | 只影响展示与任务派生，不影响任何检查结论 | 提案插入时快照 `lines[].title` 与 `plannedTasks`（canon D25）；标题进他方上下文前定界转义（canon D12 ⑧） |
| 目录 `kind` | 每个 itemKey 的 `kind` 首次确认后不可改（`catalog.confirm` 拒绝） | 9.6.3 |
| 软字段、备注、披露开关 | 只影响代理上下文与他方视图，不改规则结论 | 新简报版本即生效；进行中的 run 从下一回合读到 |
| 成员 / 席位 | 成员更替不改条款（v1 也不支持更替） | `evaluateApprovalSet` 只认当前成员的决定（canon D02） |
| `scenarioVersion` | 房间建立时钉住，不做就地升级 | 新版本只用于新房间（9.2 M29） |

### 9.1.3 目录的定价修订号

`catalogItems` 纯只追加（03 §3.7）；某个 itemKey 的"当前行"是 `by_room_item (roomId, itemKey, revision, editNo)` 上的最后一行，`RuleInput.catalog` 取各键当前行中非 `draft` 者。`catalog.confirm` 对每个输入条目与当前行比较：

| 情形 | 新行 `revision` | `editNo` | 投影 | bump |
| --- | --- | --- | --- | --- |
| 新 itemKey（item 或 modifier，如 rush；含 follow-up 房间里 `revision 0` 的 draft 键——draft 行从不修改，确认总是插新行） | 1 | 0 | 变 | 是 |
| 当前行 `retired`，重新确认 | +1 | 0 | 变 | 是 |
| `priceCents` 或 `leadDays` 变化 | +1 | 0 | 变 | 是 |
| 只有 `title` / `taskTemplates` 变化 | 不变 | +1 | 不变 | 否 |
| 与当前行完全相同 | 不写行 | — | 不变 | 否 |
| `kind` 与已有行不同 | 拒绝 `item.duplicate` | — | — | — |
| `catalog.retire` | +1，`status: retired` | 0 | 变 | 是 |

提案的 `lines[].revision` 记的是定价修订号，所以改标题后 `version.stale_source` 不会触发，提案照常可批；改价必 bump，`version.stale_source` 只可能在守卫层（审批 / 执行重算）作为纵深防御出现（canon D25）。`(itemKey, revision)` 不再唯一定位一行，03 已以 `(roomId, itemKey, revision, editNo)` 建索引与唯一写入 helper `appendCatalogRow`（03 §3.7，9.14 Q2）。

## 9.2 递增矩阵

"递增"一律经 `withConstraintChange` → `constraints.bump`（9.4）。表驱动测试 CC-01 逐行断言。

| # | 写入（函数） | 调用者 | 房间状态 | 递增？ | `cause` | `sourceRefs` / 备注 |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | `rooms.create` | 任一用户 | ∅ → `setup` | 否 | — | `constraintsVersion = 0` |
| M2 | `setup` 期的 `briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`、`ledger.recordBaseline`、`invites.accept` | 各自角色 | `setup` | 否 | — | 只写来源行；末尾 `openIfReady` |
| M3 | 就绪满足：`setup → open`（`openIfReady`） | 系统（`actorUserId` = 完成最后一个就绪条件的成员） | → `open` | 是，0 → 1 | `room_opened` | 全部生效来源：三份简报版本、全部 confirmed / retired 目录行、基线账本行 |
| M4 | `budget.setCap` 新值 ≠ 旧值（**下调或上调**） | finance | `open` | 是 | `brief_confirmed` | `[finance 新简报版本]`；上调也让旧审批 stale |
| M5 | `budget.setCap` 新值 = 旧值 | finance | `open` / `setup` | 否 | — | 返回 `unchanged`，不写简报、不写事件、不计节流 |
| M6 | `budget.setCap` / finance `briefs.confirm` 新值 < `committedCents` | finance | 任意 | 否（拒绝） | — | `budget.below_committed`，不写任何行（9.7） |
| M7 | `briefs.confirm`（finance）`capCents` 变化 | finance | `open` | 是 | `brief_confirmed` | 同 M4 |
| M8 | `briefs.confirm`（customer）`requiredItemKeys` 或 `deadline` 变化 | customer | `open` | 是 | `brief_confirmed` | `[customer 新简报版本]` |
| M9 | `briefs.confirm` 只改软字段 / 备注 / 披露 | 本人 | `open` | 否 | — | 写新简报版本；事件 `brief_confirmed { role, version, hardChanged: false }`（不含值，`constraints_changed` 不出现；payload 以 03 §3.11.1 为准） |
| M10 | `briefs.confirm`（provider） | provider | `open` | 否 | — | v1 provider 无硬字段 |
| M11 | `catalog.confirm` 新 itemKey（含 modifier） | provider | `open` | 是 | `catalog_changed` | 变化行；与当前提案无关也 bump（CC-D4） |
| M12 | `catalog.confirm` 已确认项 `priceCents` / `leadDays` 变化（含 rush 修饰项） | provider | `open` | 是 | `catalog_changed` | 一批至多一次 bump |
| M13 | `catalog.confirm` 只改 `title` / `taskTemplates` | provider | `open` | **否** | — | 新行同 `revision`、`editNo + 1`；提案快照不受影响 |
| M14 | `catalog.confirm` 与当前行相同 | provider | 任意 | 否 | — | 不写行 |
| M15 | `catalog.retire` | provider | `open` | 是 | `catalog_changed` | 新行 `status: retired` |
| M16 | `humanRequests.answer`：`raise_cap` / `drop_items` / `extend_deadline` | `toRole` | `open` | 是 | `human_answer` | `[humanRequest, 新简报版本]`；请求先置 `answered` |
| M17 | `humanRequests.answer`：`choose_candidate` / `disclose` / `retry_turn` / `pass_to_next` / `keep_as_is` / `end_run` | `toRole` | `open` | 否 | — | 04 R14 / R15 / R17 / R19 / R20 / R21 |
| M18 | `sharedFacts.add` | 本人 | 任意 | 否 | — | 披露改他方视图，不改规则输入 |
| M19 | `approvals.record`（任何决定） | 必需审批人 | `open` | 否 | — | — |
| M20 | 提案插入、run / turn / attempt 生命周期、请求创建与过期 | 系统 | `open` | 否 | — | — |
| M21 | `executions.executeIfComplete`（写 `ledgerEntries(commit)`、`changeOrders`、`tasks`） | 系统 | `open → executed` | **否** | — | canon D03；执行后房间终态 |
| M22 | `ledger.recordBaseline` | finance | `open` | 否（拒绝） | — | `run.invalid_state` |
| M23 | `invites.*` / `members` 变化 | — | `setup` | 否 | — | v1 只在 `setup`，成员不可更换 |
| M24 | `clock.rollLocalDate`：`localDate` 前进、结论不变 | 系统 | `setup` / `open` | 否 | — | 只 patch `rooms.localDate`（`setup` 期同样推进、从不 bump，9.6.7） |
| M25 | `clock.rollLocalDate`：当前 `pending_approval` 提案或 open 请求选项的时间结论翻转 | 系统 | `open` | 是 | `clock` | `[{ kind: "clock", localDate }]`；无 `actorUserId` |
| M26 | `rooms.close` | creator | → `closed` | 否 | — | 终态 |
| M27 | `rooms.startFollowUp` | 成员 | 旧房间 `executed` | 否 | — | 新房间从 `setup`、cv 0 开始 |
| M28 | `seed.fromFixture` | dev 脚本 | — | 按上面各行 | 同上 | 走生产写入口（canon D18） |
| M29 | 场景版本升级 | — | — | 不适用 | — | 房间钉住 `scenarioVersion` |
| M30 | 直接 `patch(rooms.constraintsVersion)` 或绕过 `withConstraintChange` 写来源表 | — | — | 禁止 | — | 结构测试 CC-17 |
