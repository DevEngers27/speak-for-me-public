# 03 · Convex schema v1（part9）：事件

> 分片清单见 `03-schema.md` 顶部。可见性模型是 canon D14 / 07 PV-12（PD-8）：`events` 全部对房间成员可读，没有 `visibility` 字段；`payload` 只含房间可见的结构化字段；私密细节经 `restrictedRef` 在 `timeline.page` 渲染时按查看者连接；`EventView` 从不包含 `payload` 或 `restrictedRef`。

## 3.11 events（只追加）

```ts
export const restrictedRefV = v.union(       // 只指向本就按角色控制访问的行
  v.object({ table: v.literal("briefs"), id: v.id("briefs") }),
  v.object({ table: v.literal("humanRequests"), id: v.id("humanRequests") }),
  v.object({ table: v.literal("attempts"), id: v.id("attempts") }),
  v.object({ table: v.literal("ledgerEntries"), id: v.id("ledgerEntries") }),
  v.object({ table: v.literal("approvals"), id: v.id("approvals") }),           // 只为作者连接 note
  v.object({ table: v.literal("constraintRevisions"), id: v.id("constraintRevisions") }),
  v.object({ table: v.literal("sharedFacts"), id: v.id("sharedFacts") }),
  v.object({ table: v.literal("executions"), id: v.id("executions") }),         // 金额链只给 finance 类
);
export const eventActorV = v.union(
  v.object({ kind: v.literal("user"), role: roleV }),
  v.object({ kind: v.literal("agent"), role: roleV }),
  v.object({ kind: v.literal("system") }),
);
events: defineTable({
  roomId: v.id("rooms"),
  payload: eventPayloadV,                     // 以 payload.type 判别的联合，见下表；无自由文本、无私密数值
  restrictedRef: v.optional(restrictedRefV),
  actor: eventActorV,
  actorUserId: v.optional(v.id("users")),     // 归属与节流计数；system 类，永不进 DTO（12 §12.2 B7）
  rateUser: v.optional(v.union(v.literal("constraint_writes"), v.literal("soft_writes"))),  // 节流计数行标记（3.11.3）：appendEvents 按 payload 派生、调用方不能传；system 类
  rateRoom: v.optional(v.union(v.literal("price_writes"), v.literal("hard_writes"))), // 每房间 24 小时总量桶计数行标记（3.11.3）；同上
  refs: v.object({ runId: v.optional(v.id("runs")), proposalId: v.optional(v.id("proposals")),
                   executionId: v.optional(v.id("executions")) }),
  commitTs: v.commitTs(),                     // 提交时由平台填入（techstack D02/X3；1.48 拼写待验证 V-S1）
  seq: v.number(),                            // 同一事务内 0..n-1，由 events.append 分配
  provenance: provenanceV,                    // = 房间 provenance
  createdAt: v.number(),
}).index("by_room_order", ["roomId", "commitTs", "seq"])   // timeline.page 唯一排序与游标
  .index("by_room_actor", ["roomId", "actorUserId", "rateUser"])  // + _creationTime：constraint_writes / soft_writes 窗口计数，只扫带标记的行
  .index("by_room_rate", ["roomId", "rateRoom"]),                  // + _creationTime：price_writes / hard_writes 的滚动 24 小时窗口
```

`restrictedRefV` 的八个目标与 canon D14（C59）逐一相同：除 `briefs` / `humanRequests` / `attempts` / `ledgerEntries` 外，`approvals`（只为作者连接 note）、`constraintRevisions`（`constraints_changed` 的受众渲染需要 cause 与变更角色）、`sharedFacts`（披露变化）、`executions`（finance 的金额链）同样是本就按角色控制访问的行；新增目标须满足同一条件并登记在本表（3.20 Q13 已关闭）。

`eventPayloadV` 逐个手写 `v.object({ type: v.literal("…"), … })` 再 `v.union(...)`（字面量类型不丢失，3.2 第 1 条），例：

```ts
v.object({ type: v.literal("proposal_created"), proposalVersion: v.number(), origin: v.union(v.literal("agent"), v.literal("human_choice")),
  authorRole: roleV, itemKeys: v.array(v.string()), modifiers: v.array(v.string()),
  amountCents: v.number(), deliveryDate: v.string() }),
v.object({ type: v.literal("constraints_changed"), fromVersion: v.number(), toVersion: v.number() }),
v.object({ type: v.literal("run_needs_input"), runNo: v.number() }),
```

### 3.11.1 事件目录（v1 全集）

| type | payload（room 类，全部字段） | restrictedRef | 受限渲染要点 | 他章别名 |
| --- | --- | --- | --- | --- |
| `room_created` | `scenarioKey`、`scenarioVersion` | — | — | — |
| `member_joined` | `role` | — | 显示 `members.displayName` | — |
| `invite_created` | `role`、`mode` | — | 邮箱只在邀请面板给 creator | — |
| `room_opened` | `constraintsVersion` | — | — | — |
| `brief_confirmed` | `role`、`version`、`hardChanged`（布尔：本版 `hardFields` 与该角色上一版不同为 true，含 `budget.setCap` 与约束类 `humanRequests.answer` 写的版本；只改软字段 / 披露为 false；12 §12.2 第 7 条硬字段子桶的计数源，渲染不读它） | `briefs` | 本人见改了哪些字段；买方他人见 "{Role} confirmed brief v{n}"；**provider 变体**：房间 `open` 后非本人的确认不单独渲染（并入同一提交的 "Constraints changed (v{n})"），`setup` 期只见 "{Role} confirmed their brief"——否则 provider 能从"finance 简报版本 +1 与 cv +1 同一提交"推出是谁改了上限（privacy-02，D14） | 09 M9 `brief_updated` |
| `brief_soft_updated` | `briefVersion` | `briefs` | **只对所有者渲染**（"You updated guidance for your agent"）；其他成员（买方他人与 provider）的 `timeline.page` 不渲染本条、也不并入任何条目——本表没有 `visibility` 字段，"仅本人可见"即此渲染规则；只由 `briefs.updateSoft` 写（12 §12.9），同一事务没有 `brief_confirmed` / `constraints_changed` / `disclosure_changed`；`soft_writes` 桶的计数源（3.11.3） | — |
| `baseline_recorded` | — | `ledgerEntries` | finance 见金额；customer 按 `committedCents` 共享行；provider 只见事件 | `ledger_baseline_recorded`（14 早稿；14 的 `ledger.baseline_recorded` 是 templateKey，不是事件名） |
| `catalog_item_confirmed` | `items[{ itemKey, kind, revision, priceCents, leadDays }]`、`priceChanged`（布尔：本批任一行 `revision` 变化——新增键、改 `priceCents` / `leadDays`、重新上架——为 true；只改 `title` / `taskTemplates` 为 false；12 §12.2 第 7 条 `price_writes` 桶的计数源） | — | 标题从 `catalogItems` 当前行读（标题是自由文本，不进 payload） | 09 `catalog_changed`（cause）；14 早稿 `catalog_confirmed` |
| `catalog_item_retired` | `itemKey`、`revision` | — | — | — |
| `disclosure_changed` | `fromRole` | `sharedFacts` | 只对该行新旧 `audience` 内的成员显示字段与值；其余成员：若同一提交含 `constraints_changed`，并入那一条 "Constraints changed (v{n})"、不单独渲染（finance 改上限时 `materializeDisclosures` 会重写已共享的 `capCents` 行，单独渲染 "Finance updated what they share" 会暴露变更者，privacy-02）；否则只渲染 "{role} updated what they share" | — |
| `constraints_changed` | `fromVersion`、`toVersion` | `constraintRevisions` | 事件 `actor` 恒为 `{ kind: 'system' }`（09 §9.4）：变更角色只经 `restrictedRef → constraintRevisions` 在渲染时按查看者连接，`EventView.actor` 因此不对 provider 暴露是谁改的。finance：cause + 新旧上限；customer：变更角色 / 类别，上限按共享行；provider：对任何 cause 都只有 "Constraints changed (v{n})"（canon D14），目录事实由同一提交的 room 类 `catalog_item_confirmed` / `catalog_item_retired` 向三方渲染（14 §8.3，旧价取上一 revision 行），不经本事件；他人引起的约束变更提交内全部条目对 provider 的 actor 标签为空（07 §7.17 作者中立） | — |
| `run_started` | `runNo`、`cause` | — | — | — |
| `run_awaiting_approval` | `runNo`、`proposalVersion` | — | — | 14 早稿 `run_pending_approval` |
| `run_needs_input` | `runNo` | `humanRequests` | 买方见 `kind` / `toRole`；provider（非 `toRole`）渲染为 `run_waiting` | — |
| `human_request_opened` | `runNo` | `humanRequests` | 同上（R19 重新生成时单独写） | — |
| `human_request_answered` | `runNo` | `humanRequests` | `toRole` 本人见选项；买方见 "answered"；provider 非 `toRole` 时见 "Negotiation resumed"，且若同一提交含 `constraints_changed` 则只渲染后者（privacy-02） | — |
| `human_request_closed` | `runNo`、`status`（`expired` / `superseded`） | `humanRequests` | 同上；`superseded` 且同一提交含 `constraints_changed` 时，对 provider 并入后者、不单独渲染（privacy-02） | 04 `human_request_superseded`、`human_request_expired` |
| `run_resumed` | `runNo`、`roundNo` | — | — | — |
| `run_renegotiation_requested` | `runNo` | — | — | — |
| `run_ended` | `runNo`、`status`（`superseded` / `ended_no_agreement` / `canceled` / `executed`）、`endedReason` | — | — | 04 `run_canceled`、`run_superseded` |
| `turn_scheduled` | `runNo`、`turnSeq`、`roundNo`、`role`、`kind` | — | "Provider agent drafting…"；只由 `createTurnTx` 在建回合时写一次（04 R4 / U1），attempt 的创建、重试、退避、延期都不写事件 | 10 早稿 `agent_turn_started` |
| `turn_completed` | `runNo`、`turnSeq`、`role` | `attempts` | 本方见动作与 rationale 链接；他人只见 "finished"（评估动作是 `self`，07 §7.8.5） | 00-invariants INV-20 `agent_recommended` |
| `turn_failed` | `runNo`、`turnSeq`、`role`、`failureKind`（`timeout` / `invalid_output` / `error` / `refused`） | `attempts` | 本方见 reasonCode 与粗类；**他方（含 provider）渲染为 "{Role} agent finished"，不带 `failureKind`**（privacy-06：失败痕迹能还原 `agent_failed` 的 kind / toRole） | — |
| `turn_rejected_stale` | `runNo`、`turnSeq`、`guard`（`G1` / `G2` / `G3`） | — | 唯一名；G0 情形不写事件（canon D07） | `turn_result_discarded`、10 早稿 `agent_result_discarded`、16 早稿 `turn_stale` |
| `proposal_created` | `proposalVersion`、`origin`、`authorRole`、`itemKeys`、`modifiers`、`amountCents`、`deliveryDate` | — | provider 另见当前提案 `fit`（读时现算，不进 payload） | — |
| `proposal_status_changed` | `proposalVersion`、`to`（`superseded` / `rejected` / `stale` / `executed` / `active`） | — | provider 的历史只见 `superseded / rejected / executed / current`（canon D12 ①） | 04 `proposal_rejected`、`proposal_stale` |
| `reapproval_required` | `proposalVersion`、`constraintsVersion` | — | 无金额、无人名（04 R2） | — |
| `approval_recorded` | `proposalVersion`、`role`、`decision`、`boundConstraintsVersion`、`reasonKey?`（**仅当**该键的场景受众为 `room`） | `approvals` | 只为作者连接 `note`（note 永不进 payload）；受众为 `buyers` 的 `reasonKey`（v1 只有 finance 的 `over_our_limit`）不进 payload，只经 `restrictedRef → approvals` 对 customer / finance 连接，provider 只见 "Finance rejected v{n}."（canon D14 / D13，08 S12 / A13） | — |
| `room_executed` | `proposalVersion`、`amountCents`、`taskCount`、`changeOrderNumber` | `executions` | finance（及按执行时共享行的 customer）见金额链 | `execution_completed`（08 旧称）、14 早稿 `executed` |
| `task_completed` | `taskKey` | — | — | — |
| `room_closed` | `by?`（`'ops'`，仅 internal `rooms.forceClose` 写；creator 关房不带） | — | — | — |
| `follow_up_started` | `followUpRoomId` | — | 只写在旧房间 | — |
| `pii_redacted` | `table`、`field` | — | — | — |

payload 里出现的 `v.string()` 只能是键类值（`itemKey`、`taskKey`、`scenarioKey`、`reasonKey`、`IsoDate`、枚举），由测试遍历 `eventPayloadV` 的叶子对账白名单 `EVENT_STRING_FIELDS`；出现其他字符串字段即失败（INV-12）。`amountCents` 只出现在"金额 = 公开目录价之和"的类型里（`proposal_created`、`room_executed`、`catalog_item_confirmed.items[].priceCents`）。

**目录之外不设事件**：本表是 v1 全集，`eventPayloadV` 是封闭联合，validator 拒绝目录外的 `type`；"他章别名"列只用于把旧稿里的名字映射到这里，各章正文与测试一律写 `type` 列的名字（跨章核对阶段已回改全部已知残留，3.20 Q5 关闭）。特别地，**没有 `agents_deferred`**：回合因全局日美元上限、排空或退避而等待时只写 `turns.waitingReason` + `beginFnId`，不写事件（10 §10.4.5、§10.23 第 6 条已关闭；本方界面由 `waitingReason` 渲染）；运维指标按 `waitingReason` 计数。

### 3.11.2 唯一写入口 `events.append`

```ts
export async function appendEvents(tx: RoomTx, evs: Array<{
  payload: EventPayload; restrictedRef?: RestrictedRef; actor: EventActor;
  actorUserId?: Id<"users">; refs?: EventRefs }>): Promise<void>;
```

- 每个事务调用一次（或多次时内部累加），给本事务的事件分配 `seq = 0..n-1`，写 `commitTs` 占位、`provenance = tx.room.provenance`、`createdAt`，并按 3.11.3 派生 `rateUser` / `rateRoom`（参数里没有这两个字段）。lint 禁止在门面外出现 `ctx.db.insert("events"` 与 `commitTs` 字面写入（techstack X3）。
- 守卫：`restrictedRef.id` 所指行必须属于同一房间（运行时断言）；`actor.kind === 'user'` ⇒ `actorUserId` 必填且是成员；`payload` 已由 validator 保证形状。失败即 `internal`（编程错误）并回滚整个业务事务。
- 读：`timeline.page`（12）按 `by_room_order` 倒序、单次原生 `.paginate()`，游标是它返回的不透明字符串：客户端原样回传，服务端不自行构造或解析，只对同一查询有效；`commitTs` / `seq` 不进任何 DTO（canon D14、12 B9）；每页元素替换为按查看者渲染的 `EventView = { id, type, at, actor, text, refs }`（privacy review r06：声明 `returns: v.union(v.null(), paginationResultValidator(eventViewV))`）。

### 3.11.3 节流计数（canon D12 ⑥；12 §12.2 B7）

计数行由 `appendEvents` 标记，调用方不能传入或省略标记：同一事务内第一条类型 ∈ `{ brief_confirmed, catalog_item_confirmed, catalog_item_retired, run_renegotiation_requested, human_request_answered }`、或 `run_started` 且 `cause === 'manual_start'`、且带 `actorUserId` 的事件得 `rateUser: 'constraint_writes'`，同事务其余事件不再标记——每个命令事务恰一行计数行，行数即 **distinct `commitTs`**（例如 `raise_cap` 回答同时写 `human_request_answered` 与 `brief_confirmed`，只标一条、只算一次）。

`assertWithinRate(tx, actorUserId)`：读 `by_room_actor` 前缀 `(roomId, actorUserId, 'constraint_writes')` 且 `_creationTime > now − 3,600,000` 的行（`take(6)`）；索引只含带标记的行，审批、任务完成、邀请等无关事件不占扫描额度，不能把计数稀释为 0；≥ 6 → `run.rate_limited { retryAfterMs }`（`retryAfterMs` 由最早一行的 `_creationTime` 算出，只给调用者）。被拒调用回滚、不计数；`unchanged` 不写事件、不计数。`_creationTime` 在这里只作"大约一小时内"的墙钟窗口边界，不承担排序语义；窗口不用 `commitTs` 做时间运算。

每房间 24 小时总量桶（canon D12 ⑥；阈值与覆盖的函数以 12 §12.2 第 7 条为唯一定义，计数行的标记与索引读法以本节为准）同样一个命令事务至多一行：`price_writes` 标在 `catalog_item_confirmed{ priceChanged: true }` 或 `catalog_item_retired` 上；`budget.setCap` 与 customer 硬字段变更共用的子桶 `hard_writes` 标在 `brief_confirmed{ hardChanged: true }` 上。两者只在命令事务加锁时读到的房间状态（`tx.room.status`，本事务写入之前）为 `open` 时标记：`setup` 期的首次确认（`hardChanged` / `priceChanged` 必为 true）与使房间打开的那次确认都不计入，配额只在 `open` 期间消耗。读 `by_room_rate` 前缀 `(roomId, bucket)` 且 `_creationTime > now − 86,400,000` 的行（`take(上限)`），达到上限（`price_writes` 3、`hard_writes` 6）→ `run.rate_limited { retryAfterMs }`（同样由最早一行算出）。`run_starts` 不读事件：人工 `runs.start` 与 10 §10.5.2 B6a 共用同一个滚动 24 小时计数——`runs.by_room_runNo` 倒序前 7 行中 `startedAt > now − 86,400,000` 的个数（墙钟；含 `room_opened` 的首个 run 与 `react()` 自动开局）。人工 `runs.start` 插入前计数已达 6 → 抛 `run.rate_limited`；系统开局不抛错、照常建 run，计入本 run 后超过 6 时首回合停泊为 `turns.waitingReason: 'run_cap'`（3.8，10 §10.5.2 B6a）。

`soft_writes`（12 §12.2 第 7 条，只覆盖 `briefs.updateSoft`）：`appendEvents` 给带 `actorUserId` 的 `brief_soft_updated` 打 `rateUser: 'soft_writes'`（该类型不在上面 `constraint_writes` 的类型集合中，两个桶互不占用）；写入前 `assertWithinRate` 以 `'soft_writes'` 为桶读 `by_room_actor` 前缀 `(roomId, actorUserId, 'soft_writes')` 且 `_creationTime > now − 3,600,000` 的行（`take(30)`），≥ 30 → `run.rate_limited { retryAfterMs }`，即每用户每房间每小时第 31 次被拒；被拒调用回滚、不计数，notes 未变的调用不写事件、不计数。

- 披露类：整行对房间成员 `room`（payload 已限定为 room 类）；`actorUserId`、`rateUser`、`rateRoom`、`restrictedRef`、`commitTs` 为 `system`。不变量：INV-05、INV-11、INV-12、INV-56。
