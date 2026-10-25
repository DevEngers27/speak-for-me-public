# 12 · 后端函数目录（part3）：约束写入流程、briefs、budget、ledger、sharedFacts、catalog

## 12.8 约束写入的公共流程

`briefs.confirm`、`budget.setCap`、`catalog.confirm`、`catalog.retire`、`ledger.recordBaseline` 与 `humanRequests.answer` 的约束类选项共用同一条事务内流程（helper 见 03 §3.13 与 09 §9.4）：

1. **校验**：`openRoomTx(allow: ["setup", "open"])`、`expectedConstraintsVersion === room.constraintsVersion`（`version.stale_constraints`）、字段值（金额 / 日期窗口 / 长度 / 目录成员关系）、角色专属前置（如 D23 的 `capCents >= committedCents`）。
2. **比较**：与该源的当前版本逐字段比较，完全相同 → 返回 `unchanged`，不写行、不写事件、不计节流。
3. **只追加写源**：`insertBriefVersion` / `appendCatalogRow` / `appendLedgerEntry`；源行永不修改。简报与基线写入后调用 `materializeDisclosures`，把被勾选的可共享字段写进 `sharedFacts`（07 §7.8.3：他方投影只读这张表）。
4. **`withConstraintChange`**（09）：房间 `setup` 时只写来源并调用 `openIfReady`——不递增；`openIfReady` 在就绪（04：三席满员、三方简报已确认、基线已录、至少一个已确认的 `kind: "item"` 目录项）时 `setup → open`，再 `constraints.bump(cause: "room_opened")` 得到 cv 1，随后 `react()` 开第一个 run（D12：最后一项就绪条件满足的那次写入自动开 run，cause `room_opened`）。房间 `open` 时按场景 `hardProjection(RuleInput)` 比较写前写后，投影不变则不递增（只改目录 `title` / `taskTemplates`、只改软字段或披露开关）；投影改变则 `constraints.bump`：`rooms.constraintsVersion + 1`、写一行 `constraintRevisions { cause, actorUserId, sourceRefs }`，同事务执行 D06（当前非终态 run → `superseded`，其 `active` 提案 → `stale`，open 请求 → `superseded`，审批不改行而自然失效），再 `react()` 迭代到不动点（深度 ≤ 4）：**仅当被取代的 run 处于 `pending_approval`**、且其当前提案在新约束下 `passesChecks` 时，沿用同一 `proposalId`（同事务 `stale → active`）直接 `pending_approval`（canon D06 / C47）；否则全量可行集非空 → `negotiating`、为空 → `needs_input`。
5. **排空**：`opsFlags.draining` 置位时 `react()` 照常建 run，只是首个 live 回合停泊（10 §10.12.3：拒绝建 run 会回滚约束变更本身）；排空结束后由 `runs.reconcile` 恢复。
6. **事件**：一条命令事件（payload 只含角色、版本号、itemKey 等房间可见字段，无数值或文本内容，私密细节用 `restrictedRef`）＋ bump 产生的 `constraints_changed{ fromVersion, toVersion }`（按受众三种渲染，D14）＋ 披露变化时的 `disclosure_changed{ fromRole }`。

返回值统一为 `confirmResultV = v.object({ status: v.union(v.literal("confirmed"), v.literal("unchanged")), version: v.number(), constraintsVersion: v.number(), bumped: v.boolean() })`。不返回 run 的去向：它对 provider 可能多泄露一位，界面从 `rooms.view` 读取已投影的 run 状态。

## 12.9 briefs

#### `briefs.confirm` · memberMutation · 节流 `constraint_writes`
- **args** `{ roomId: v.id("rooms"), expectedConstraintsVersion: v.number(), hardFields: v.union(customerHardV, providerHardV, financeHardV), softFields: v.union(customerSoftV, providerSoftV, financeSoftV), disclosures: v.record(v.string(), v.array(roleV)) }`。validator 与字段以 03 §3.6 为准（以 `schemaKey` 判别，如 `scope_change.customer.v1`：硬字段 `requiredItemKeys` / `deadline`，软字段 `preferredItemKeys` / `notes`（v1 没有 `preferredDate`，03 §3.6、14 §4）；finance 硬字段 `capCents`；provider 硬字段为空——它的硬数据只有目录）。
- **returns** `confirmResultV`
- **守卫** ① 成员；② `openRoomTx(allow: ["setup", "open"])`；③ `hardFields.schemaKey` 与 `softFields.schemaKey` 都属于 `ctx.member.role`（`input.invalid{field:"hardFields"}`）；④ `expectedConstraintsVersion`；⑤ 值规则：`requiredItemKeys` 非空、去重、字典序、≤ 12，形如 `^[a-z][a-z0-9_]{1,39}$`，且每个键（`preferredItemKeys` 同）必须属于本房间曾确认过的 item 键 confirmed ∪ retired（否则 `item.unknown`——关闭伪 itemKey 自由文本信道，privacy-08；已 retired 的由规则报 `item.required_missing(not_offered)`）；`preferredItemKeys` 与必需项不相交；日期 `localDate ≤ d ≤ localDate + 365`（`date.invalid` / `date.in_past` / `date.out_of_range`）；金额 `assertCents`（`amount.out_of_range`）；`notes` NFC 后 ≤ 2,000 码点（`input.invalid{field:"notes"}`）；⑥ `disclosures` 的键 ∈ `SHAREABLE_FIELDS[role]`、受众 ⊆ 允许受众且不含本角色（`input.invalid{field:"disclosures"}`；finance 的金额字段只许 `customer`，canon D12 ④）；⑦ finance：`capCents >= committedCents`，否则 `budget.below_committed{ minAllowedCapCents }`，不写、不递增（D23）；⑧ 节流。
- **读** `rooms`、`members`、`briefs.by_room_role_version`（本角色当前版本）、`ledgerEntries.by_room_kind`（finance 上限校验与派生字段）、`sharedFacts.by_room_from_field`、§12.8 所需的 `RuleInput`、`runs`、`proposals`、`approvals`、`humanRequests`。
- **写** `briefs`（`version = 当前 + 1`、`source: "form"`、`confirmedBy`、`provenance`）；`sharedFacts`（`materializeDisclosures`）；经 §12.8：`rooms`、`constraintRevisions`、`runs`、`proposals`、`turns`、`attempts`、`humanRequests`、`events`（`brief_confirmed{role, version, hardChanged}`——带 `actorUserId`，每次非 `unchanged` 的 `insertBriefVersion` 都写（`briefs.updateSoft` 写的 `source: "soft_update"` 版本除外，它只写 `brief_soft_updated`），含硬字段变化与 `budget.setCap`，字段以 03 §3.11.1 为准；`disclosure_changed`、`constraints_changed`、`room_opened`）。
- **幂等** 自然幂等（内容与当前版本相同 → `unchanged`）。两个标签页先后确认不同的软字段时后者生效、历史版本全保留；硬字段冲突被 ④ 拦下。
- **失败码** `auth.not_member`、`run.invalid_state`、`input.invalid`、`version.stale_constraints`、`item.duplicate`、`date.*`、`amount.out_of_range`、`budget.below_committed`、`run.rate_limited`。
- 草稿不入库：表单状态只在客户端。简报全文只回给本人（`briefs.mine`），他方只经 `sharedFacts` 看到被勾选的字段。

#### `briefs.updateSoft` · memberMutation · 节流 `soft_writes`
- **args** `{ roomId: v.id("rooms"), notes: v.string() }`；**returns** `v.object({ briefVersion: v.number() })`
- **语义** 本人写给本方代理的指导（13 §13.10 F "Guide my agent"）：复制本角色**最新已确认版本**，只替换 `softFields.notes`，`hardFields`、`disclosures` 与其余软字段原样照抄，`source: "soft_update"`，经同一个只追加的 `insertBriefVersion` 写入。notes 不在 `hardProjection` 内，所以**不走** §12.8 的 `withConstraintChange`：不递增 `constraintsVersion`、不写 `constraintRevisions`、不动 run / 提案 / 审批 / 请求；披露不变，不调用 `materializeDisclosures`，不写 `sharedFacts`、不写 `disclosure_changed`。三个角色都可调用，只作用于 `(roomId, 本人角色)`。
- **守卫** ① 成员；② `openRoomTx(allow: ["setup", "open"])`（`executed` / `closed` → `run.invalid_state{guard:"room_status"}`）；③ 本角色尚无已确认简报 → `run.invalid_state{guard:"brief_missing"}`（首次填写走 `briefs.confirm`；与 `budget.setCap`、`sharedFacts.add` 同一守卫与码）；④ 只校验 `notes`：NFC 后 ≤ 2,000 码点（`input.invalid{field:"notes"}`），不要求 `^[^<>]*$`（notes 只出现在本方 `<principal_notes>` 块内并经 `encodeBlock`，05 §5.13.2），空串表示清空；照抄的字段不重新校验（确认时已校验）；⑤ 节流。
- **读** `rooms`、`members`、`briefs.by_room_role_version`（本角色当前版本）、`events.by_room_actor`（节流）。
- **写** `briefs`（`version = 当前 + 1`、`source: "soft_update"`、`confirmedBy`、`provenance`）；`events`：恰一条 `brief_soft_updated{ briefVersion }`（带 `actorUserId`、`restrictedRef → briefs`，只对所有者渲染，03 §3.11.1），不写 `brief_confirmed`。
- **幂等** 自然幂等：NFC 后的 notes 与当前版本相同 → 返回当前 `briefVersion`，不写行、不写事件、不计节流（§12.2 第 4、5 条的只读快速路径）。
- **失败码** `auth.not_member`、`run.invalid_state`（`room_status` / `brief_missing`）、`input.invalid`、`run.rate_limited`。

## 12.10 budget 与 ledger

#### `budget.setCap` · memberMutation · `roles: ["finance"]` · 节流 `constraint_writes`
- **args** `{ roomId: v.id("rooms"), capCents: v.number(), expectedConstraintsVersion: v.number() }`；**returns** `confirmResultV`
- **语义** finance 的便捷入口：复制 finance 当前简报版本，只替换 `hardFields.capCents`，`source: "set_cap"`，软字段与披露不变，交给与 `briefs.confirm` 相同的 `insertBriefVersion`（§12.8），因此守卫、读写、事件、递增规则完全一致。
- **额外守卫** finance 尚无已确认简报 → `run.invalid_state{guard:"brief_missing"}`（首次设上限走简报表单）。
- **幂等** 同上限 → `unchanged`。**失败码** 同 `briefs.confirm`，外加 `auth.role_forbidden`。
- 走查（D27）：上限 $5,000 → $4,800 时 `capCents: 480000 ≥ committed 400000`，通过并递增；$3,900 → `budget.below_committed{ minAllowedCapCents: 400000 }`，不递增、不写事件。

#### `ledger.recordBaseline` · memberMutation · `roles: ["finance"]`
- **args** `{ roomId: v.id("rooms"), amountCents: v.number() }`；**returns** `v.object({ status: v.union(v.literal("recorded"), v.literal("unchanged")), ledgerEntryId: v.id("ledgerEntries") })`
- **守卫** ① finance；② `openRoomTx(allow: ["setup"])`（`open` 及之后 → `run.invalid_state{guard:"room_status"}`：开房后基线不可改，`committedCents` 在 `open` 期间只随执行变化，09 §9.1.2）；③ `assertCents`（可为 0）；④ 已有 baseline：金额相同 → `unchanged`（双击安全），不同 → `run.invalid_state{guard:"baseline_exists"}`；⑤ finance 已有简报时 `amountCents <= capCents`，否则 `budget.below_committed{ minAllowedCapCents: amountCents }`（保持"余量恒 ≥ 0"）。
- **写** `ledgerEntries`（`appendLedgerEntry`：`kind: "baseline"`、`recordedByUserId`、`provenance`）；`materializeDisclosures(finance)`（派生字段 `committedCents` / `headroomCents` 若已勾选共享则重写）；`events`：`baseline_recorded`（payload 无数值，`restrictedRef` 指向台账行）；随后 `openIfReady`。基线只能在 `setup` 写入，此时没有提案与审批，所以不递增（D05 的"`ledgerEntries` 不递增"在此成立）。
- **幂等** 自然幂等。**失败码** `auth.role_forbidden`、`run.invalid_state`、`amount.out_of_range`、`budget.below_committed`。
- 后续房间（D04）：`rooms.view` 给 finance 预填旧执行的 `committedAfterCents`，但仍由 finance 显式调用本函数。

## 12.11 sharedFacts

#### `sharedFacts.add` · memberMutation
- **args** `{ roomId: v.id("rooms"), field: v.string(), audience: v.array(roleV), confirmOwnDisclosure: v.boolean() }`。**没有 value 参数**：值从调用者本人当前已确认简报（或 finance 的台账派生值）复制（07 §7.8.3、LP-3），结构上无法转述他方的值；用于不改简报内容时扩大或缩小受众，`audience: []` 表示撤回（写 `value: null` 行，对之后的查看者隐藏，已被看到的值无法收回）。
- **returns** `v.object({ status: v.union(v.literal("shared"), v.literal("withdrawn"), v.literal("unchanged")), sharedFactId: v.union(v.id("sharedFacts"), v.null()) })`
- **守卫** ① 成员；② `openRoomTx(allow: ["setup", "open"])`；③ `field ∈ SHAREABLE_FIELDS[role]` 且 `audience ⊆` 该字段的允许受众、不含本角色（否则 `disclosure.blocked`；finance 金额字段给 provider 在写入断言处另抛 `internal`）；④ 本角色尚无已确认简报 → `run.invalid_state{guard:"brief_missing"}`；⑤ 该字段 `requiresAck` 且 `audience` 新增了角色而 `confirmOwnDisclosure === false` → `disclosure.needs_own_confirmation`；⑥ 值的语义校验（日期窗口 `date.out_of_range`；itemKeys ⊆ 本房间曾确认过的 item 键 confirmed ∪ retired，否则 `item.unknown`，只在 draft 行出现 → `item.unconfirmed`——与 `briefs.confirm` 同一集合，否则披露已 retired 的必需项会失败，03 §3.6 / §3.13.1、privacy-08）。闸门不把值与他方秘密比对——比对结果本身就是"你的值等于某人的秘密"预言机（07 LP-3）。
- **写** `sharedFacts`（`appendSharedFact`：`source: "manual"`、`seq + 1`、`briefVersion`、`createdBy`）；`events`：`disclosure_changed{ fromRole }`（值不进 payload，`restrictedRef` 指向该行，只对受众连接；03 §3.11.1、07 §7.12.2 一致）。共享事实不在硬投影内，不递增、不改 run。
- **幂等** 值与受众都与该键最新行相同 → `unchanged`。
- **失败码** `auth.not_member`、`run.invalid_state`、`disclosure.blocked`、`disclosure.needs_own_confirmation`、`date.out_of_range`、`item.unknown`、`item.unconfirmed`。

## 12.12 catalog

目录只追加：`(roomId, itemKey, revision, editNo)` 逻辑唯一；`revision` 只在价格、工期、状态变化时 +1，只改标题或任务模板时 `editNo + 1`（03 §3.7 的 revision 契约）。rush 等加急是 `kind: "modifier"` 的目录项（D25）。

#### `catalog.confirm` · memberMutation · `roles: ["provider"]` · 节流 `constraint_writes`（一批计一次）+ `price_writes`（含定价变化的批）
- **args** `{ roomId: v.id("rooms"), expectedConstraintsVersion: v.number(), rows: v.array(v.object({ itemKey: v.string(), kind: v.union(v.literal("item"), v.literal("modifier")), title: v.string(), priceCents: v.number(), leadDays: v.number(), taskTemplates: v.array(v.object({ title: v.string(), assigneeRole: roleV })) })) }`，`rows` 1–14 行（一次确认一批，避免 seed 与正常使用撞上 6 次 / 小时）。**这是唯一签名**：单行确认也传 `rows: [row]`，不存在单条 `item` 形态；一批无论几行只计 `constraint_writes` 一次、至多一次 bump（completeness-17：01 P2、18 N-24 的"按 12 现签名每行一次"已过时，以本节为准）。
- **returns** `v.object({ status: v.union(v.literal("confirmed"), v.literal("unchanged")), rows: v.array(v.object({ itemKey: v.string(), revision: v.number(), editNo: v.number(), changed: v.boolean() })), constraintsVersion: v.number(), bumped: v.boolean() })`
- **守卫** ① provider；② `openRoomTx(allow: ["setup", "open"])`；③ `expectedConstraintsVersion`；④ 批内 itemKey 唯一、形如 `^[a-z][a-z0-9_]{1,39}$`；已有 itemKey 的 `kind` 不可变（`item.duplicate`）；后续房间（`room.followsExecutionId` 非空）中 `itemKey ∈ 旧执行 proposal.terms.itemKeys` → `item.duplicate{ itemKeys }`（已交付范围不得以同一键再上架；要再卖须换新键，§12.6，invariants-06）；⑤ `title` NFC、trim 后 1–80 码点、`^[^<>\r\n]+$`（否则 `input.invalid{field:"title"}`）；NFKC 并去不可见字符后大小写不敏感地不得含定界词 `untrusted_data | room_state | candidates | shared_facts | clarify_answers | principal_brief | principal_notes | turn_instruction | system` 的原文或 `&lt;` / `\u003c` 形式（否则 `disclosure.blocked{field:"title"}`，05 §5.13.2、06 §4）（D13：它是唯一进入他方代理上下文的人写字符串，进入时再经 `<untrusted_data>` 定界并转义）；⑥ `priceCents` `assertCents` 且 ≤ `MAX_CATALOG_ROW_CENTS`（`amount.out_of_range`）；`leadDays` 为 0–365 的整数（`date.out_of_range`）；item 的 `taskTemplates` ≤ 5 条（标题规则同 ⑤：1–80 码点，与 03 §3.2 `TEXT_LIMITS`、14 §5 一致），modifier 必须为空（`input.invalid`）；⑦ 写后当前非 retired 的 item ≤ 12、modifier ≤ 2，且在架 item 的 `taskTemplates` 条数之和 ≤ `MAX_TASKS_PER_EXECUTION`（50，08 §8.4.4；03 §3.13.1）（`item.limit_exceeded`）；⑧ 全批与当前行逐字段相同 → `unchanged`；⑨ 节流。
- **写** `catalogItems`（`appendCatalogRow` 逐行按 revision 契约插入或跳过；follow-up 房间的 `revision 0` 草稿行不修改，确认插 `revision 1` 新行）；§12.8：整批包在一次 `withConstraintChange(cause: "catalog_changed")` 内，一批至多一次 bump；只改标题 / 模板的批不递增（提案已在插入时快照 `lines[].title` 与 `plannedTasks`，D05、D25）；`events`：`catalog_item_confirmed{ items: [{ itemKey, kind, revision, priceCents, leadDays }], priceChanged }`（`priceChanged` 按 03 §3.11.1：本批任一行 `revision` 变化为真，只改标题 / 模板为假；已确认目录是 provider 的显式披露，房间可见；标题是自由文本，不进 payload）。
- **读** `catalogItems.by_room_item`（前缀 `eq(roomId)`）、`RuleInput`、`runs` 等（bump）；后续房间另读 `executions`（按 `followsExecutionId`）与其 `proposals` 行取已交付的 `terms.itemKeys`。
- **幂等** 自然幂等。**失败码** `auth.role_forbidden`、`run.invalid_state`、`version.stale_constraints`、`input.invalid`、`disclosure.blocked`、`item.duplicate`、`item.limit_exceeded`、`amount.out_of_range`、`date.out_of_range`、`run.rate_limited`（含 `price_writes` 桶）。

#### `catalog.retire` · memberMutation · `roles: ["provider"]` · 节流 `constraint_writes`
- **args** `{ roomId: v.id("rooms"), itemKey: v.string(), expectedConstraintsVersion: v.number() }`；**returns** `v.object({ status: v.union(v.literal("retired"), v.literal("unchanged")), revision: v.number(), constraintsVersion: v.number(), bumped: v.boolean() })`
- **守卫** ① provider；② `openRoomTx(allow: ["setup", "open"])`；③ `expectedConstraintsVersion`；④ 当前行存在（`item.unknown`）；已 `retired` → `unchanged`；⑤ 节流。
- **写** 追加 `status: "retired"` 行（`revision + 1`、`editNo: 0`，其余字段照抄）；状态在投影内，房间 `open` 时必然递增；`events`：`catalog_item_retired{ itemKey, revision }`。
- **失败码** `auth.role_forbidden`、`run.invalid_state`、`version.stale_constraints`、`item.unknown`、`run.rate_limited`。

这两个函数是零模型成本预言机的入口：provider 反复改价并观察新 run 是直接协商还是 `run_waiting`，每次得到 1 bit 全局可行性，候选金额又由自己定，可二分出 finance 的余量。D12 ⑥ 的每小时 ≤ 6 次只能减速（07 算出约 2.3 小时即可精确到 $1），所以另设 `price_writes` 桶：每房间 open 期间每 24 小时 ≤ 3 批含定价变化的确认 / 撤下，每个 open run 内同一 itemKey 改价 ≤ 1 次（§12.2 第 7 条；07 §7.13 给出每房间每日总量上界）；provider 对任何提案只见 `fit: ok | blocked`（D12 ①）。
