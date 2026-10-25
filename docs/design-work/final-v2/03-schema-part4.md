# 03 · Convex schema v1（part4）：披露账本、目录、台账、约束修订

> 分片清单见 `03-schema.md` 顶部。

## 3.6（续）sharedFacts（披露账本，只追加）

```ts
const sharedFactValueV = v.union(             // 无自由文本（canon §1.1）
  v.object({ kind: v.literal("date"), date: v.string() }),            // IsoDate + 日期窗口
  v.object({ kind: v.literal("itemKeys"), itemKeys: v.array(v.string()) }),
  v.object({ kind: v.literal("enum"), value: v.string() }),           // 场景枚举成员
  v.object({ kind: v.literal("cents"), cents: v.number() }),          // assertCents
);
sharedFacts: defineTable({
  roomId: v.id("rooms"),
  fromRole: roleV,
  field: v.string(),                          // SHAREABLE_FIELDS[fromRole] 的键（07 §7.8.4）
  seq: v.number(),                            // (roomId, fromRole, field) 内从 1 连续；"最新行"按它取，不按 _creationTime
  value: v.union(sharedFactValueV, v.null()), // null = 撤回
  audience: v.array(roleV),                   // 不含 fromRole；⊆ 允许受众；撤回行为空
  briefVersion: v.number(),                   // 值所属的 fromRole 简报版本（历史值按版本判定受众，07 PV-12）
  source: v.union(v.literal("brief_confirm"), v.literal("manual"),
                  v.literal("request_answer"), v.literal("ledger")),
  humanRequestId: v.optional(v.id("humanRequests")), // source === "request_answer" 必有
  createdBy: v.union(v.id("users"), v.null()),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_room_from_field", ["roomId", "fromRole", "field", "seq"]),
```

- 唯一写入 helper `appendSharedFact(tx, …)`，只被 `materializeDisclosures`（`insertBriefVersion` 之后；`ledger.recordBaseline` 之后重写 finance 派生字段 `committedCents` / `headroomCents`）、`sharedFacts.add`（无 value 参数，值从本人当前简报复制，07 §7.8.3）与 `humanRequests.answer` 的 `disclose` 效果（`source: 'request_answer'`，受众 = 最新行受众 ∪ `effect.toRoles`，值同样从回答者当前简报复制，3.9）调用；写前过 07 §7.15 LP-3 闸门（`disclosure.blocked` / `disclosure.needs_own_confirmation`）；`itemKeys` 值的每个键必须属于本房间曾确认过的 item 键 confirmed ∪ retired（`item.unknown`，只在 draft 行出现 → `item.unconfirmed`；与 `insertBriefVersion` 同一集合：既关闭伪 itemKey 自由文本信道，又不让已 retired 的必需项在披露时失败，privacy-08）。值与受众都与最新行相同 → 不插行。
- finance 的金额字段允许受众只有 `customer`，provider 永不出现（canon D12 ④）：`SHAREABLE_FIELDS` 声明 + `appendSharedFact` 写入断言双重保证，违例抛 `internal` 并记 `publicOpsLog('shared_fact.audience_violation', { fn })`（它在 `sharedFacts.add` / `briefs.confirm` / `humanRequests.answer` 等公开路径上执行，只能用闭集三键的公开 logger，15 §15.6.2、07 E1）。
- 有效可见性与"按值所属版本判定"见 07 §7.8.3；本表保证"最新行"可由 `(roomId, fromRole, field)` 前缀 `order("desc").first()` 一次取到，历史判定用同一前缀按 `briefVersion` 过滤（每键行数个位数）。
- 披露类：行级受众 `audience ∪ {fromRole}`；`createdBy` 为 `system`。不变量：INV-01、INV-02、INV-18、INV-19。

## 3.7 目录、台账、约束修订

### catalogItems（只追加行）

```ts
catalogItems: defineTable({
  roomId: v.id("rooms"),
  itemKey: v.string(),                        // 房间内稳定；item 与 modifier 共用键空间；同键 kind 不可变
  revision: v.number(),                       // 定价修订号：仅 priceCents / leadDays / status 变化 +1；draft 行为 0（09 §9.1.3）
  editNo: v.number(),                         // 同一 revision 内的展示修订号：新 revision 从 0 起，只改 title / taskTemplates 时 +1
  status: v.union(v.literal("draft"), v.literal("confirmed"), v.literal("retired")),
  kind: v.union(v.literal("item"), v.literal("modifier")),
  title: v.string(),                          // ^[^<>\r\n]{1,80}$；唯一进入他方代理上下文的人写串
  priceCents: v.number(),                     // assertCents 且 <= MAX_CATALOG_ROW_CENTS（8e9，06 §4）
  leadDays: v.number(),                       // item：标准工期天数；modifier：加急缩短的天数（物化归 14）；整数 0–365
  taskTemplates: v.array(v.object({ title: v.string(), assigneeRole: roleV })), // item ≤ 5 条，在架 item 合计 ≤ 50（3.13.1 appendCatalogRow）；modifier 必须为空；
                                              // assigneeRole 恒为场景 CatalogDecl.ownerRole（v1 = provider），写入口校验（14 §5、12 §12.12）
  confirmedBy: v.optional(v.id("users")),     // status !== "draft" 必有
  confirmedAt: v.optional(v.number()),
  createdBy: v.id("users"),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_room_item", ["roomId", "itemKey", "revision", "editNo"]),
```

**revision 契约**（06 §5.3 INV-R8、09 §9.1.3，本表落存储；`(roomId, itemKey, revision, editNo)` 逻辑唯一，09 Q2）：

| 写入 | 新行 | `revision` | `editNo` |
| --- | --- | --- | --- |
| `catalog.confirm` 新键（含 rush 修饰项、含 follow-up 房间里的 draft 键） | `status: confirmed` | 1 | 0 |
| `catalog.confirm` 改 `priceCents` 或 `leadDays` | `confirmed` | 当前行 + 1 | 0 |
| `catalog.confirm` 只改 `title` / `taskTemplates` | `confirmed` | **不变** | 当前行 + 1 |
| `catalog.confirm` 重新上架已 `retired` 的键 | `confirmed` | + 1 | 0 |
| `catalog.retire` | `status: retired`，其余字段照抄 | + 1 | 0 |
| `rooms.startFollowUp` 复制旧房间中**未执行**条目的当前已确认行（已执行的 itemKey 不复制，12 §12.6） | `status: draft`（新房间） | 0 | 0 |
| 与当前行逐字段相同 / `kind` 不同 | 不插行，返回 `unchanged` / 拒绝 `item.duplicate` | — | — |

- **draft 行从不被修改**：确认总是插新行（草稿行留作"从哪里复制来"的历史），所以本表是纯只追加（与 11 §11.7 的 `APPEND_ONLY` 一致；04 §4.9 C2 已按此改为"确认插入 revision 1 的新行"）。
- "当前行" = `by_room_item` 前缀 `(roomId, itemKey)` 上的最后一行（`(revision, editNo)` 最大）；"当前目录"（`RuleInput.catalog`，06 §5.1）= 每个 `itemKey` 的当前行中 `status !== 'draft'` 者，`confirmed` 进入可选集合，`retired` 只用于报 `item.retired`。一次读取前缀 `eq(roomId)`（≤ 14 键 × 少量编辑）。草稿只存在于 follow-up 房间的首次确认之前，确认后的新行（revision 1）必排在草稿（revision 0）之后。
- `hardProjection` 只读 `(itemKey, revision, status, priceCents, leadDays)`，因此只改标题不会 bump（C8），改价必 bump（D05）；`lines[].revision` 与当前行比较（`version.stale_source`，06 E4）与投影比较对规则字段给出同一结论。
- 唯一写入 helper `appendCatalogRow(tx, …)`：被 `catalog.confirm`（一次调用确认一批 ≤ 14 行，计一次节流，避免 seed 与正常使用撞上 6 次 / 小时）、`catalog.retire`、`rooms.startFollowUp` 调用。校验：键格式、`kind` 与该键既有行一致（否则 `item.duplicate`）、当前非 retired 的 item ≤ 12 行、modifier ≤ 2 行且在架 item 的 `taskTemplates` 条数之和 ≤ `MAX_TASKS_PER_EXECUTION`（50，3.13.1）（否则 `item.limit_exceeded`，06 新增码）、值规则（3.2）。整批写入包在 `withConstraintChange(cause: 'catalog_changed')` 内（09 §9.4：setup 期只写来源并 `openIfReady`；open 期投影变化才 bump，一批至多一次）。
- 披露类：非草稿行的 `itemKey` / `kind` / `title` / `priceCents` / `leadDays` / `taskTemplates` / `revision` / `status` / `provenance` 为 `room`（确认即披露，07 §7.8.3 路径 ①）；草稿行整行 `self(provider)`；`confirmedBy` / `createdBy` 为 `system`。不变量：INV-05、INV-24、INV-37、INV-38。

### ledgerEntries（已承诺额的唯一真相源，只追加）

```ts
ledgerEntries: defineTable({
  roomId: v.id("rooms"),
  kind: v.union(v.literal("baseline"), v.literal("commit")),
  amountCents: v.number(),                    // assertCents；baseline 可为 0
  executionId: v.optional(v.id("executions")),// commit 必有、baseline 必无（handler 断言 + 对账 R5）
  recordedByUserId: v.id("users"),            // baseline：finance；commit：投最后一票的人
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_room_kind", ["roomId", "kind"]),
```

- `committedCents = sumCents(by_room_kind 前缀 eq(roomId) 的全部行)`，**不存计数器**（canon §1.1、08 A11）；`headroomCents = capCents − committedCents`（D23 保证恒 ≥ 0）。
- 写者只有两个：`ledger.recordBaseline`（finance，`room.status === 'setup'` 且该房间尚无 baseline，否则 `run.invalid_state`；follow-up 房间的界面预填旧执行的 `committedAfterCents`，但仍由 finance 显式录入，canon D04）与 `executions.executeIfComplete`（每次执行恰一条 commit，`amountCents = proposal.terms.amountCents`）。没有"外部已承诺"的可编辑字段——评委反例"改 externalCommitted 让 committed > cap"在结构上不存在。
- 披露类：整行 `roles: [finance]`；customer 只能经 finance 的 `committedCents` / `headroomCents` 开关在 `sharedFacts` 里看到派生值；provider 永不。不变量：INV-02、INV-39（D23）、INV-50、08 的 R1–R11。

### constraintRevisions（"cv 为什么是 N"，只追加；字段按 09 §9.3 定稿）

```ts
export const revisionCauseV = v.union(v.literal("room_opened"), v.literal("brief_confirmed"),
  v.literal("catalog_changed"), v.literal("human_answer"), v.literal("clock"),
  v.literal("scenario_migrated"));   // 15 的场景版本迁移（08 O12）：对受影响房间强制 bump 后重批；v1 无迁移脚本时不出现
export const sourceRefV = v.union(
  v.object({ kind: v.literal("brief"), briefId: v.id("briefs"), role: roleV, version: v.number() }),
  v.object({ kind: v.literal("catalogItem"), catalogItemId: v.id("catalogItems"),
             itemKey: v.string(), revision: v.number() }),
  v.object({ kind: v.literal("ledgerEntry"), ledgerEntryId: v.id("ledgerEntries") }), // 只出现在 room_opened 行
  v.object({ kind: v.literal("humanRequest"), humanRequestId: v.id("humanRequests") }),
  v.object({ kind: v.literal("clock"), localDate: v.string() }),
);
constraintRevisions: defineTable({
  roomId: v.id("rooms"),
  version: v.number(),                        // bump 后的 rooms.constraintsVersion；(roomId, version) 从 1 连续
  previousVersion: v.number(),                // = version - 1
  cause: revisionCauseV,
  actorUserId: v.optional(v.id("users")),     // 只有 cause === "clock" 时缺省
  sourceRefs: v.array(sourceRefV),            // room_opened：全部生效来源；其余：本次变化的来源
  localDate: v.string(),                      // bump 时的 rooms.localDate（重放用）
  supersededRunId: v.optional(v.id("runs")),
  staleProposalId: v.optional(v.id("proposals")),
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"]),
```

- 唯一写者 `constraints.bump`（09 §9.4）：经 `withConstraintChange` 在同一事务内对写入前后的全局 `RuleInput` 求 `hardProjection` 并比较（**投影不持久化**——它含 finance 私密的 `capCents`，存哈希也可被小值域枚举反推，09 §9.1.1）；不同才 `room.constraintsVersion + 1` 并插入本行；`cause: 'clock'` 由 `clock.rollLocalDate` 在结论翻转时强制递增（canon D22）；setup 期不 bump，`openIfReady` 打开房间时插入 v1（04 M2、09 M3）。
- **不存任何约束值**：新旧上限只在 finance 简报版本里；"版本 N 的输入"由 `sourceRefs` 折叠重放（09 `replayRuleInput`）。没有 `producedConstraintsVersion` 回填（versioned-approvals r11）、没有作废审批计数（现算）。
- `humanRequests.answer` 产生的 bump：`cause: 'human_answer'`，`sourceRefs` 同时含请求与新简报版本；请求先置 `answered` 再 bump（04 §4.8.2），修正评委"回答自取消导致追溯断链"。
- 事件：`bump` 写 `constraints_changed`，payload 只有 `{ fromVersion, toVersion }`（room 类），`cause` / 变更角色 / 新旧值经 `restrictedRef → constraintRevisions` 在渲染时按查看者连接（canon D14、07 DX-5：provider 只见 "Constraints changed (vN)"），见 3.11。
- 披露类：`version` / `previousVersion` / `createdAt` 为 `room`；`cause` 与由 `actorUserId` 推出的角色为 `roles: [customer, finance]`；`actorUserId` / `sourceRefs` / `localDate` / `supersededRunId` / `staleProposalId` 为 `system`。不变量：INV-24、INV-32、INV-33、INV-57。
