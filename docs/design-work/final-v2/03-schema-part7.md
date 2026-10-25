# 03 · Convex schema v1（part7）：提案、审批、人工请求

> 分片清单见 `03-schema.md` 顶部。迁移见 04 §4.6–4.8；审批判定与执行见 08；请求生成见 05 §5.11。

## 3.9 提案、审批、人工请求

### proposals（条款不可变；只有 status 可变）

```ts
proposals: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),                        // 创建它的 run（来历）；"属于哪个活跃 run"只由 runs.currentProposalId 表达
  version: v.number(),                        // = rooms.nextProposalVersion；房间内单调，不因新 run / bump 重置
  origin: v.union(v.literal("agent"), v.literal("human_choice")),
  authorRole: roleV,                          // agent：provider；human_choice：customer
  sourceTurnId: v.optional(v.id("turns")),    // origin === "agent" 必有
  sourceRequestId: v.optional(v.id("humanRequests")), // origin === "human_choice" 必有（04 R15）
  chosenBy: v.optional(v.id("users")),        // human_choice 的回答者
  candidateKey: v.string(),                   // canonical(itemKeys, modifiers)，3.4
  terms: termsV,                              // { itemKeys, modifiers, deliveryDate, amountCents }
  termsKey: v.string(),                       // canonicalJson(terms)；审批第二绑定（canon D25）
  lines: v.array(lineV),                      // 插入时目录快照：键集合 = itemKeys ∪ modifiers
  plannedTasks: v.array(plannedTaskV),        // 插入时由当时修订的 taskTemplates 派生；执行原样写入 tasks
  requiredApprovals: v.array(requiredApprovalV), // 场景快照，v1 三角色；写后不变
  createdAtConstraintsVersion: v.number(),    // 只作来历与展示；isExecutable 不比较它（canon §1.1）
  status: v.union(v.literal("active"), v.literal("superseded"), v.literal("rejected"),
                  v.literal("stale"), v.literal("executed")),
  statusChangedAt: v.number(),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_room_version", ["roomId", "version"])
  .index("by_run", ["runId"]),                // 本 run 创建的提案（P2a 取代）；被拒键按决定所在 run 取自 approvals.by_run_decision
```

- 唯一插入 helper `insertProposal(tx, …)`，只在两处被调用：`turns.complete`（provider `propose`，所选候选在当前 `RuleInput` 下 `passesChecks`，04 §4.3.4）与 `humanRequests.answer(choose_candidate)`（全量重算通过，04 R15）。**被规则阻断的候选不插提案**（`turns.outcome.blockedCandidateKey`，provider 只得 `blocked`），所以每一行在插入时都通过全部检查，不存 `checksAtCreation`。
- 物化（canon D10 / D22 / D25）：`terms.amountCents = sumCents(lines[].priceCents)`；`deliveryDate = room.localDate + 有效工期`（item 取 `max(leadDays)`，modifier 的缩短规则归 14），插入后不重算；`plannedTasks` 按 `terms.itemKeys` 顺序展开每个 item 当时修订的 `taskTemplates[i]` 为 `{ itemKey, templateIndex: i, title, assigneeRole, dueDate: terms.deliveryDate }`，modifier 无任务（08 §8.3.2）。`version` 在守卫通过后才分配，被拒收的回合不消耗版本号。
- **只有 `status` / `statusChangedAt` 可变**，且只经 04 的 `setStatus`；P5 `stale → active` 只在同一 bump 事务内发生（04 §4.6）。不存在 `endorsed` / `approved` / `blocked` / `deferredItemKeys` / `contentHash` / `publicSummary` 字段（canon §1.3、D11、D13、D25）。
- 披露类：除 `chosenBy`、`sourceTurnId`、`sourceRequestId`（`system`）外整行 `room`：金额 = 已公开目录价之和，条款不含任何私密派生集合（07 §7.9）。对 provider 的历史列表只投影 `superseded / rejected / executed / current`，`fit` 只对当前提案现算（canon D12 ①）。不变量：INV-07、INV-28、INV-35、INV-36、INV-37、INV-55。

### approvals（只追加；字段按 08 §8.3.3 定稿）

```ts
approvals: defineTable({
  roomId: v.id("rooms"),
  proposalId: v.id("proposals"),
  runId: v.id("runs"),                        // 决定时的 room.currentRunId；审批判定不读，只供本 run 剔除集合派生（by_run_decision）
  userId: v.id("users"),
  role: roleV,                                // 取自 members，不接受客户端
  kind: approvalKindV,                        // 由角色派生（customer / provider = terms，finance = budget），只影响文案
  decision: decisionV,                        // approve | reject | withdraw
  seq: v.number(),                            // (proposalId, userId) 内 1..n，跨 cv 不重置
  boundConstraintsVersion: v.number(),        // = 写入时 room.constraintsVersion = expectedConstraintsVersion
  boundTermsKey: v.string(),                  // = proposal.termsKey = expectedTermsKey
  reasonKey: v.optional(rejectReasonKeyV),    // decision === "reject" 必有，其余必无（handler 断言）
  note: v.optional(v.string()),               // ≤ 500 码点；只给本人；不进事件 / 他方上下文；REDACTABLE
  decidedAt: v.number(),                      // 仅展示；任何排序都不读它
}).index("by_proposal_user", ["proposalId", "userId", "seq"])
  .index("by_run_decision", ["runId", "decision"]),  // 本 run 被人拒绝的提案（含 D06 沿用、runId 属旧 run 的提案）
```

- `by_proposal_user` 一个索引两种用法：前缀 `eq(proposalId)` = 本提案**整个**审批区间（`evaluateApprovalSet` 的输入，同时把并发的最后两票纳入同一冲突面），前缀 `eq(proposalId).eq(userId)` + `order("desc").first()` = 本人当前决定。`by_run_decision` 只服务 3.8 的剔除集合派生：`(runId, 'reject')` 的行 → `proposalId` → `candidateKey`；D06 沿用的提案 `proposals.runId` 仍是旧 run，在本 run 被拒时只有审批行记得"拒绝发生在哪个 run"（08 §8.5.4 第 2 条）。没有 `by_room` 索引：时间线读 `events`，不读本表。
- 唯一写者 `approvals.record`（08 §8.5）：`seq = 本人最大 seq + 1`；同 `(decision, boundConstraintsVersion)` 重复 → `unchanged` 不插行；没有任何 internal 函数写本表（INV-20）。
- 披露类：`role` / `kind` / `decision` / `seq` / `boundConstraintsVersion` / `decidedAt` 为 `room`；`reasonKey` 按场景 `humanReasonKeys[].audience`（`room` 或 `buyers`，如 finance 的 `over_our_limit` 只给买方，07 DX-6、08 A13）；`note` 为 `self`（作者本人）；`userId` / `runId` 为 `system`（DTO 给 `memberId`）。不变量：INV-20、INV-25 – INV-31。

### humanRequests（字段按 05 §5.11.1 定稿，本章补索引与关闭字段）

```ts
export const requestEffectV = v.union(
  v.object({ type: v.literal("raise_cap"), amountCents: v.number() }),         // toRole = finance；绝对目标上限
  v.object({ type: v.literal("drop_items"), itemKeys: v.array(v.string()) }),  // toRole = customer
  v.object({ type: v.literal("extend_deadline"), date: v.string() }),          // toRole = customer
  v.object({ type: v.literal("choose_candidate"), candidateKey: v.string() }), // toRole = customer
  v.object({ type: v.literal("disclose"), field: v.string(), toRoles: v.array(roleV) }), // 被问方；toRoles = 本次披露新增的受众
                                              // （clarify：发问角色；infeasible 回退：尚未获披露的放松角色；04 R14 / R20、05 §5.11.1、06 §11.1）
  v.object({ type: v.literal("retry_turn") }),                                 // 失败方
  v.object({ type: v.literal("pass_to_next"), toRole: roleV }),               // 仅 infeasible 请求（含回退请求）：relaxationOrder 中本收件人之后的下一角色；
                                              // 末位没有；每 run 每个 (from, to) 至多一次；不 bump（canon D15、04 R21）
  v.object({ type: v.literal("keep_as_is") }),
  v.object({ type: v.literal("end_run") }),
  v.object({ type: v.literal("blocked") }),   // 只作说明、不可选：成立需要他方未披露的值（canon D11，不写数字）
);
export const requestOptionShownV = v.object({ // 06 §11.1 RequestOption.shown 的存储镜像（封闭）：只放可由 viewFor(toRole) 推出的展示值
  itemKeys: v.optional(v.array(v.string())), modifiers: v.optional(v.array(v.string())),
  amountCents: v.optional(v.number()), deliveryDate: v.optional(v.string()), deltaCents: v.optional(v.number()),
});
humanRequests: defineTable({
  roomId: v.id("rooms"),
  runId: v.id("runs"),
  kind: v.union(v.literal("infeasible"), v.literal("rounds_exhausted"), v.literal("agent_escalated"),
                v.literal("clarify"), v.literal("agent_failed")),
  toRole: roleV,
  questionKey: v.string(),                    // 模板键（按 kind + cause 选择）
  topicKey: v.optional(v.string()),           // kind === "clarify"：场景话题表的键
  sourceTurnId: v.optional(v.id("turns")),    // clarify / escalate / agent_failed 的来源回合
  constraintsVersion: v.number(),             // 创建时的 cv；bump 时整体 superseded
  options: v.array(v.object({
    optionKey: v.string(),                    // "A".."E"，与模型的 "O1".."On" 区分
    templateKey: v.string(),
    effect: requestEffectV,
    shown: requestOptionShownV,               // 写入时的展示快照，写后不变；blocked 项与出口项为空对象
  })),                                        // 非空；末项为出口（end_run），blocked 项不可被回答
  status: v.union(v.literal("open"), v.literal("answered"), v.literal("expired"), v.literal("superseded")),
  expiresAt: v.number(),                      // createdAt + HUMAN_REQUEST_TTL_DAYS（7）天
  answeredBy: v.optional(v.id("users")),
  answerOptionKey: v.optional(v.string()),
  answeredAt: v.optional(v.number()),
  closedReason: v.optional(v.union(v.literal("constraints_changed"), v.literal("renegotiation_requested"),
    v.literal("run_canceled"), v.literal("room_closed"), v.literal("regenerated"))), // 仅 superseded 时
  closedAt: v.optional(v.number()),
  provenance: provenanceV,
  createdAt: v.number(),
}).index("by_run_status", ["runId", "status"])         // "每 run 至多一个 open"（INV-34 的 by_run_open 即本索引）
  .index("by_room_status", ["roomId", "status"])       // 收件箱 "Needs you"、执行时防御性检查
  .index("by_status_expiresAt", ["status", "expiresAt"]), // humanRequests.expireDue（cron）
```

- 唯一插入 helper `openHumanRequestTx`（04 H1），写入前 `assertOptionsProjected(toRole, options)`：每个金额、日期、条目都能由目标角色自己的视图推出；`raise_cap.amountCents` 只来自 finance 自身视图（`committedCents` + finance 视图内最便宜候选的金额，05 §5.11.2）。先查 `by_run_status`（`runId`, `open`）为空，配合房间写锁保证每 run 至多一个 open 请求。
- `shown` 是选项的展示快照：问题与选项文本只用它作模板参数渲染，不在读时按当前目录或视图重算历史选项。`choose_candidate` 选项的 `shown` 必须带全该候选物化时显示的条款 `{ itemKeys, modifiers, amountCents, deliveryDate }`。回答时 `humanRequests.answer` 按 14 §6.2 用 `shown.deliveryDate` 物化该 `candidateKey`（`lines` / `plannedTasks` 取当前目录行：任何定价修订都会 bump 并已使本请求 `superseded`，所以与显示时同一 `revision`），物化出的 `itemKeys` / `modifiers` / `amountCents` 与 `shown` 不全等 → `internal`、不写任何行（正常路径不可达；不走 R19，以免把一个从未被复核否决的键记入剔除集合）；通过全量复核后插入的提案条款即 `shown`（"人选的就是人看到的"）。
- 可变字段只有 `status` / `answeredBy` / `answerOptionKey` / `answeredAt` / `closedReason` / `closedAt`；请求不重开，需要时生成新请求（R19 `regenerated`；infeasible 回退请求以 `disclose` 回答后若预检仍无解，旧请求 `answered`、另开新请求，04 R20）。
- `disclose` 的受众在开请求时写定于选项（`toRoles`），回答时经 `appendSharedFact` 同一闸门写入，受众 = 该字段最新行受众 ∪ `toRoles`；不再从 `sourceTurnId` 反推发问方（infeasible 回退请求没有来源回合）。canon D15 现文同为 `disclose { field, toRoles }`（3.20 Q12 已关闭）。过期判定只在 cron / mutation 内比较 `expiresAt`（query 不读时钟）。
- 披露类：存在、`status`、`createdAt` 为 `room`；`kind` / `toRole` 为 `roles: [customer, finance]` 与 `toRole` 本人（provider 不是 `toRole` 时只见 `run_waiting`，canon D12 ⑦、07 DX-3）；`questionKey` / `topicKey` / `options` / `answer*` 为 `self(toRole)`；`sourceTurnId` / `answeredBy` 为 `system`。不变量：INV-10、INV-32、INV-34、INV-64、INV-65、INV-73。
