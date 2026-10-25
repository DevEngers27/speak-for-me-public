# 12 · 后端函数目录（part5）：房间与协商视图 query

共同纪律：失败返回 `null`；不读 `Date.now()`（只读 `rooms.localDate` 与存储的时间戳）；不写 `console.*`；DTO 由 `convex/model/views/*` 逐字段构造，派生值继承输入里最严格的披露类（D11）；他方私密值只经 `sharedFacts` 与已确认目录进入投影（07 PV-05）；`commitTs` / `seq` / `tokenIdentifier` / `userId` 不出现在返回值中。字段级 validator 与 07 的披露矩阵、13 §13.8 的视图模型对账（TC-PRIV-10）；13 §13.8.3 的 Δ1–Δ6 已并入下文。

## 12.17 公共 query

#### `rooms.view` · memberQuery
- **args** `{ roomId: v.id("rooms") }`；**returns** `v.union(v.null(), roomViewV)`。房间页唯一的"带约束版本判断"的聚合（D19、frontend-ia D-FE-02）：`passesChecks`、审批槽位、待办、预算结论只在这里计算，其他 query 只带版本标记。
- **计算顺序**（privacy-disclosure §7.1）：① 读房间公开部分；② 用独立的 `loadRuleInput(ctx, roomId)` 读全量规则输入，跑 `checkProposal` / `evaluateApprovalSet`（08 §8.6.6），结果立即经 `projectForRole(viewer.role)` 裁剪，原始评估结果不进入 DTO 构造函数的作用域；③ 预算数字只来自查看者有权看的 `sharedFacts` 行（finance 本人读自己的简报与台账）；④ `toRoomView(已投影部件)` 显式列出每个输出字段。
- **读** `rooms`、`members`、`briefs`（只读本角色；他方只在规则输入中读）、`sharedFacts`、`catalogItems`、`runs`、`turns` / `attempts`（公开字段）、`proposals`（当前 + 历史 ≤ 20）、`approvals`、`humanRequests`、`ledgerEntries`（第 ② 步与 finance 本人）、`executions`（后续房间另读 `followsExecutionId` 指向的旧执行、其提案的 `lines` 快照与 `changeOrders.number`，供 `followUpOf`）、`invites`（仅创建者）。
- **`roomViewV` 结构**（字段级 validator 在 `convex/model/views/roomView.ts`）：

```ts
{
  header: { roomId, title, scenarioKey, status, phase /* 04 derivePhase */, constraintsVersion,
            proposalVersion: number | null, viewingAs: role, isCreator, provenanceBadge },
  members: [{ role, displayName, isMe, joinedVia, briefConfirmed, briefVersion: number | null }],   // briefVersion：本人恒有；买方（customer / finance）互见对方版本；房间 open 后 provider 对非本人一律 null（07 DX-7、privacy-02：版本 +1 与 cv +1 同一提交会向 provider 暴露是谁改了约束；买方本就从 constraints_changed 的买方变体得知变更角色）
  seats: null | [{ role, state: "filled" | "invited" | "empty", inviteMode: "email" | "link" | null,
                   invitedEmail: string | null, inviteExpiresAt: number | null }],          // 仅创建者；从不含 token / 哈希
  todos: [{ kind, priority, refs: { proposalId?, proposalVersion?, requestId?, runId? } }],
  catalog: [{ itemKey, kind, title, priceCents, leadDays, revision }],        // 已确认目录 = provider 的显式披露
  sharedFacts: [{ fromRole, field, value, asOfBriefVersion: number | null }], // 只含有效受众包含查看者的；asOfBriefVersion 与 members[].briefVersion 同规则：房间 open 后对 provider 一律 null（07 DX-7、privacy-02）
  budget: { visibility: "none" }                                              // provider 恒为此分支
        | { visibility: "finance", capCents, committedCents, headroomCents, baselineRecorded,
            baselineSuggestionCents: number | null,                           // 后续房间预填（D04）
            proposalCents: number | null, totalAfterCents: number | null, overByCents: number | null,
            status: "within" | "over" | "no_proposal" }                       // Δ2：边界由服务端判定（$800 恰等于余量）
        | { visibility: "customer", capCents: number | null, committedCents: number | null,
            headroomCents: number | null },                                   // 逐字段来自 finance 共享的 sharedFacts，默认全 null（U1）
  currentProposal: null | {
    proposalId, version, termsKey, origin, provenance, createdAtConstraintsVersion,
    terms: { itemKeys, modifiers, deliveryDate, amountCents }, lines: [{ itemKey, kind, title, priceCents }],
    summaryText /* renderPublicText，按受众 */, diffFromPrevious: null | { previousVersion, changes: string[] },
    fit: { audience: "provider", value: "ok" | "blocked" }                   // 无 reasonCode、无 checkId（D12 ①）
       | { audience: "buyer", passesChecks, checks: [{ code, owner: "self" | "other", text }] },   // text 由服务端按 06 PARAM_AUDIENCE 裁剪后的参数渲染；DTO 不带开放 record（13 FE-D03）
                                                                              // 非所有者的掩码检查只给 private.constraint_unmet
    notIncludedForMe: string[] | null,                                        // 仅 customer：本人视图现算的"未纳入条目"（D11，不存储）
    approvals: [{ role, kind, displayName, isMe,
                  state: "pending" | "approved" | "rejected" | "stale_approve" | "stale_reject" | "withdrawn",
                  boundConstraintsVersion: number | null, reasonKey: string | null }],   // reasonKey 按场景 humanReasonKeys[].audience 裁剪：audience 'buyers' 的键（如 over_our_limit）对 provider 为 null（08 A13）
    allApproved,
    myAction: { canDecide, kind, disabledReasonCode: string | null, current: decision | null,
                completesSet: boolean, canWithdraw: boolean },               // Δ1："Your approval completes the set"
    recordsPreview: { changeOrderNumber, taskCount, myTaskTitles: string[], commitCents: number }, // = 当前提案 terms.amountCents（本次增减），三方可见（08 §8.6.6 的 deltaCents 行）；committedBefore / After、cap、headroom 不在此 DTO
    myAgentSuggestion: null | { action, proposalVersion, rationale, isSimulated },   // 只本方
  },
  proposalHistory: [{ proposalId, version, status, amountCents, deliveryDate, createdAtConstraintsVersion }],
                                                                              // Δ3；只存储状态、不实时重算；provider 视图中 stale 显示为 superseded
  run: null | { runId, runNo, status /* UI 派生枚举 */, roundNo, maxRounds, activeRole: role | null,   // provider 投影：needs_input 时 activeRole = null；非本方回合只见 scheduled | running | done
                attemptStatus: string | null,                                  // 只对本方回合给出；他方（含 provider）恒为 null（privacy-06）
                waiting: "backoff" | "spend_deferred" | "draining" | "run_cap" | null,   // 只对本方回合给出
                staleDiscarded: number,                                       // Δ6："1 late reply discarded"
                cause, endedReason: string | null, agentMode },
  openRequest: null | { mine: true, requestId, kind, options: v.array(openRequestOptionV) /* type 判别的封闭联合 */, expiresAt }
             | { mine: false, waitingOnRole: role, kind }                     // 买方看到 toRole
             | { mine: false, kind: "run_waiting" },                         // provider（非 toRole）：无 kind、无 toRole（D12 ⑦）
  execution: null | { executionId, proposalVersion, executedAt, changeOrderNumber,
                      approvalsSnapshot: [{ role, displayName, decidedAt }], // 来自 executions.approvalIds（D04）
                      followUpRoomId: string | null },
  followUpOf: null | { previousRoomId, changeOrderNumber,                    // 仅后续房间（followsExecutionId 非空）
                       deliveredItems: [{ itemKey, title }] },               // 旧执行的条款快照 lines；只读 "Delivered in CO-{n}"（§12.6，invariants-06）
}
```

- `followUpOf` 的披露：旧执行的变更单在旧房间本就对三方可见（`executions.forRoom`），后续房间的成员恒为旧房间的同三人（D04 预分配、v1 不换人），所以不新增披露；不带金额（金额链只在旧房间的 `executions.forRoom` 按受众给出）。

- `run.status` 是由 04 存储状态映射的 UI 枚举（避免新增状态让 `returns` 校验失败）；已执行房间的审批槽位读 `executions.approvalIds`（D04）；阻断结论读时派生、不回写。
- **回合失败对他方不可见**（privacy-06）：`run` 的回合级字段一律由视图模型裁剪，不交给组件折叠（13 FE-D16）——他方回合（含 provider 看买方回合）的状态只映射为 `scheduled | running | done`（`failed` / `stale` 都显示 `done`），`attemptStatus` 与 `waiting` 为 `null`；provider 投影在 `needs_input` 时 `activeRole = null`、`openRequest = { mine: false, kind: "run_waiting" }`；DTO 不含 `runs.lastFailure`、`attempts.status` 或任何 `failureKind`；时间线的 `turn_failed` 对他方渲染为 "{Role} agent finished"（见下文 `timeline.page`）。因此 `agent_failed` 请求的 kind 与 toRole 不能从网络帧还原。**残余推断**：provider 仍能看到"哪一个买方角色的回合之后出现了 `run_waiting`"，从而知道是 customer 侧还是 finance 侧的回合把 run 带进了 `needs_input`（不知 kind、toRole、话题）；本章按 D12 的"每提案 ≤ 1 bit"政策接受，并作为 §12.25 Q18 交 07 登记或改为"provider 只见合并的买方阶段"。
- 读集较大，v1 规模下可接受；耗时由 Axiom `function_execution` 观测（15 §15.6）。

#### `rooms.listMine` · userQuery（无身份 / 未建档时例外地返回空页）
- **args** `{ paginationOpts: paginationOptsValidator }`；**returns** `paginationResultValidator(inboxCardV)`（不含 `null`：它是 userQuery 的例外，同 `users.viewer`——无身份或未建档时不做业务读，返回空页 `{ page: [], isDone: true, continueCursor: "" }`；`usePaginatedQuery` 要求返回类型是 `PaginationResult`，`PaginationResult | null` 编译不过，与 07 §7.12.1 的"空列表"一致），`inboxCardV = { roomId, title, myRole, status, phase, inboxSection: "needs_you" | "agents_working" | "waiting" | "done", topTodo: null | { kind, proposalVersion: number | null, constraintsVersion: number }, waitingOn: role[] | "others" | null, notice: null | "approval_no_longer_applies" | "request_closed", provenanceBadge, updatedAt }`（Δ4）
- **读** `members.by_user` 按加入时间倒序一次 `.paginate(paginationOpts)`（页大小上限 50、字符串游标；超过 50 个房间时其余在后续页，不截断）；对页内每个房间读 `rooms`、当前 `runs`、open `humanRequests`、当前提案、本人在当前提案上的最新审批、本人最新简报版本；`setup` 房间另调与 `rooms.view` 相同的 `roomReadiness`（04 §4.2.1：三席、各角色最新简报、≥ 1 个 confirmed item、baseline），得到缺口与负责角色；`executed` 房间另读本人角色的 open 任务（`tasks.by_room_assignee`，取 1）。`topTodo` / `inboxSection` / `waitingOn` 与 `rooms.view` 的 `todos` / `phase` 同源（共用 04 `derivePhase` 与 `roomReadiness`，不另写一套规则）。读集：非 `setup` 房间约 7 次、`setup` 房间约 10 次索引点查（13 §13.3）。只返回廉价字段，**不含任何金额**，不重算 `passesChecks`。provider 的 `waitingOn` 在对方处于 `needs_input` 时只给 `"others"`（D12 ⑦）。四分区即 D19 / 13 §13.3，只对已加载的页分组；`isDone === false` 时前端提供 "Load more" 并提示可能还有更多房间。`notice` 读时派生、不存储：只在它所指的事项仍未被取代且房间 `open` 时非 `null`；出现替代它的待办（对新的当前提案作决定、新的 open 请求）或房间执行 / 关闭后即为 `null`。

#### `rooms.previewChange` · memberQuery（**唯一定义**；01 F5、07 §7.11.1、09 §9.6.8、13 §13.8.1、14 S7 只引用本节）
- **args** `{ roomId, change: v.union(v.object({ kind: v.literal("cap"), newCapCents: v.number() }), v.object({ kind: v.literal("customer_hard"), requiredItemKeys: v.optional(v.array(v.string())), deadline: v.optional(v.string()) }), v.object({ kind: v.literal("catalog"), rows: v.array(v.object({ itemKey: v.string(), priceCents: v.optional(v.number()), leadDays: v.optional(v.number()), retire: v.optional(v.boolean()) })) })) }`（缺省字段 = 保持当前值）。变更种类的所有者（cap → finance、customer_hard → customer、catalog → provider）必须是查看者，否则返回 `null`（§12.2 第 2 条：公共 query 一律返回 `null`，不抛错）。参数先过与对应写入口相同的语义校验（`assertCents`、`leadDays` 为 0–365 的整数、日期窗口 `localDate ≤ d ≤ localDate + 365`、`itemKey` 属于本房间曾确认过的键）；任一不通过同样返回 `null`，不计算结论、不回显原始输入。
- **returns** `v.union(v.null(), v.object({ verdict: v.literal("unchanged") }), v.object({ verdict: v.literal("recheck"), nextConstraintsVersion: v.number(), invalidatedApprovals: v.number(), willSupersedeRun: v.boolean() }), v.object({ verdict: v.literal("after"), nextConstraintsVersion: v.number(), invalidatedApprovals: v.number(), willSupersedeRun: v.boolean(), verdictAfter: v.object({ proposalVersion: v.number(), budgetCheck: v.union(v.literal("pass"), v.literal("budget.over")), overByCents: v.optional(v.number()) }) }), v.object({ verdict: v.literal("rejected"), code: v.literal("budget.below_committed"), minAllowedCapCents: v.number() }))`
- **角色分支**（D12 ②）：只有 finance 的 `cap` 变更返回 `after`：`verdictAfter` **只含当前提案在新上限下的预算检查**（`budget.over` 的输入 finance 全部拥有，零新增信息；例 $4,800 时 `budget.over { overByCents: 10000 }`）；**不做** feasibility 枚举、不回答"仍存在可行方案"——在 U1 / C0 配置下那依赖 customer 未披露的必需项与截止日，会成为 finance 的零成本预言机（privacy-03；16 TC-PRIV-13 断言扰动 customer 私密值后 finance 的结果逐字节不变）。上限低于已承诺 → `rejected`（D23 的下限提前告诉 finance）。其余变更一律 `recheck`，只含不依赖假设性求值的信息：`nextConstraintsVersion`（房间 `setup` 时按"打开后为 1"）、`invalidatedApprovals`（当前提案上有效审批数）与 `willSupersedeRun`（当前是否有非终态 run，13 用它写 "This restarts the negotiation"）。硬投影不变返回 `unchanged`。
- 不写表、不计节流——正因如此它对非 finance 角色不提供任何求值结论。

#### `briefs.mine` · memberQuery
- **args** `{ roomId }`；**returns** `v.union(v.null(), v.object({ role, latest: v.union(v.null(), v.object({ version, hardFields, softFields, disclosures, confirmedAt, source })), versions: v.array(v.object({ version, confirmedAt, source, changedHardFields: v.array(v.string()), notes: v.string() })), othersSee: v.array(v.object({ role: roleV, fields: v.array(v.object({ field, value, asOfBriefVersion })) })), finance: v.union(v.null(), v.object({ committedCents, baselineRecorded, baselineSuggestionCents: v.union(v.number(), v.null()) })) }))`
- **读** 只按 `(roomId, 调用者角色)` 读 `briefs.by_room_role_version` 与本角色的 `sharedFacts`；`othersSee` 即"What others can see from you"（D19），按每个他方角色的有效受众计算；finance 另读台账。不提供任何"确认后是否可行 / 剩余候选数"的预览（评委指出的无痕预言机）。`versions[].notes` 是各版本本人的 `softFields.notes`，13 §13.10 F 的 "Earlier guidance" 只由它渲染。

#### `catalog.list` · memberQuery
- **args** `{ roomId }`；**returns** `v.union(v.null(), v.object({ items: v.array(v.object({ itemKey, kind, title, priceCents, leadDays, revision, editNo, status, taskTemplates: v.array(v.object({ title, assigneeRole: roleV })) })), mine: v.union(v.null(), v.object({ drafts: v.array(catalogRowV), history: v.array(catalogRowV) })) }))`
- 所有成员见每个 itemKey 的当前非草稿行（已确认即披露，含任务模板，07 §7.8.3 路径 ①）；`mine` 只对 provider 填充（follow-up 房间的草稿与修订历史）。**读** `catalogItems.by_room_item` 前缀 `eq(roomId)`。

#### `proposals.get` · memberQuery（房间由 `proposalId` 解析；提案永久链接页）
- **args** `{ proposalId }`；**returns** `v.union(v.null(), v.object({ card: proposalCardV, decisions: v.array(v.object({ role, decision, decidedAt, boundConstraintsVersion, reasonKey: v.union(v.string(), v.null()), isMe, note: v.union(v.string(), v.null()) })) }))`
- `card` 与 `rooms.view.currentProposal` 同形；**只有当它是当前提案时**才带 `fit` / `checks`，否则只带存储状态（D12 ①、07：历史提案不实时重算）。`reasonKey` 按场景 `humanReasonKeys[].audience` 裁剪（`room` 全员可见；`buyers` 的键对 provider 为 `null`，08 A13、07 DX-6），`note` 只在 `isMe` 时返回，DTO 无 `userId`。**读** `proposals`、`approvals.by_proposal_user`、`members`。

**W2-14 option DTO（payload 键名 `disclose`、`toRole`、`effect` 为最终契约；`rooms.view.openRequest` 与 `humanRequests.get` 共用）**：仅目标查看者得到以下按 `type` 判别的封闭联合扩展；`shown` / `effectView` 不变。`disclose` 增加 `disclose: { field, toRoles }`（自己的字段、明确接收角色；clarify 包含提问方）；`pass_to_next` 增加 `toRole`；`raise_cap` 增加 `effect: { amountCents }`（finance 自身视图的新上限，绝对值）；`drop_items` 增加 `effect: { itemKeys }`（customer：从必需项中移除这些键，06 §11.1）；`extend_deadline` 增加 `effect: { date }`（customer 新截止日）。其余 type 无新增字段；`blocked` 不带效果或披露字段、不可回答。新增值来自写入前按目标自身视图验证的持久化效果，不重新读取他方简报；披露元数据不披露字段值、不写 sharedFacts（只有回答后才按 07 §7.8.3 / LP-3 写入）。非目标买方 `waitingOnRole` 与非目标 provider `run_waiting` 的 DTO 字节不变，provider 作为非目标人得不到上述任何字段。

#### `humanRequests.get` · memberQuery（房间由 `requestId` 解析；取舍页永久链接）
- **args** `{ requestId }`；**returns** `v.union(v.null(), v.object({ mine: v.literal(true), requestId, kind, status, options: v.array(openRequestOptionV) /* type 判别的封闭联合 */, answerOptionKey: string | null, closedReason: string | null, closedAtConstraintsVersion: number | null, expiresAt }), v.object({ mine: v.literal(false), requestId, waitingOnRole: roleV, kind, status }), v.object({ mine: v.literal(false), kind: v.literal("run_waiting") }))`
- 投影与 `rooms.view.openRequest` 同一规则（03 §3.9 的披露类、D12 ⑦）：`toRole` 本人得到开请求时写定的选项（非 open 时 `answerable` 一律为 `false`）、`status`、`answerOptionKey`、`closedReason`，以及 `closedReason === "constraints_changed"` 时的关闭约束版本 `constraintsVersion + 1`（请求在创建后的第一次 bump 中整体 `superseded`；其他关闭原因为 `null`）；非 `toRole` 的买方只得 `kind`、`toRole`、`status`；非 `toRole` 的 provider 只得 `run_waiting`（无 kind、无 toRole、无状态）。选项文本只用目标角色自身视图里的值渲染（D11）。**读** `humanRequests`、`members`。取舍页按 URL 中的 id 渲染，从不以当前 `openRequest` 替代另一个 id；已关闭的请求只读显示 "This request was closed: …" 与回答摘要。

#### `turns.mine` · memberQuery（本方代理笔记）
- **args** `{ roomId, runId: v.union(v.id("runs"), v.null()), paginationOpts: paginationOptsValidator }`（`null` = 当前 run）；**returns** 分页结果，项为 `{ turnSeq, roundNo, kind, status, action: string | null, proposalVersion: number | null, rationale: string | null, outcome: string | null, attempts: [{ attemptNo, status, errorCode: string | null, inputTokens, outputTokens, latencyMs, provenance }] }`
- 读 `turns.by_run_turnSeq`（一次 `paginate`）后按调用者角色过滤（页大小可能小于请求值，不泄露他方信息），再读 `attempts.by_turn`。`rationale`、动作与用量只给本方（D13；防止跨方从 token 数推断简报长度）。

#### `executions.forRoom` · memberQuery
- **args** `{ roomId }`；**returns** `v.union(v.null(), v.object({ executionId, proposalVersion, constraintsVersion, executedAt, provenance, approvalsSnapshot: v.array(v.object({ role, displayName, decidedAt })), changeOrder: v.object({ number, terms: termsV, lines: v.array(v.object({ itemKey, kind, title, priceCents })), amountChain: v.union(v.null(), v.object({ baselineCents: cn, approvedToDateCents: cn, committedBeforeCents: cn, thisChangeCents: v.number(), committedAfterCents: cn, capCentsAtExecution: cn, headroomAfterCents: cn })) }), tasks: v.array(v.object({ taskId, taskKey, title, assigneeRole, dueDate, status, canMarkDone })), whyChain: v.array(v.object({ step, constraintsVersion: v.union(v.number(), v.null()), proposalVersion: v.union(v.number(), v.null()), text, href: v.union(v.string(), v.null()) })) }))`（`cn = v.union(v.number(), v.null())`）
- `amountChain` 由存储字段映射（08 §8.6.6：`approvedToDateCents ← priorApprovedDeltaCents`、`committedBeforeCents ← amountBeforeCents`、`thisChangeCents ← deltaCents`、`committedAfterCents ← amountAfterCents`、`capCentsAtExecution ← executions.capCentsAtExecution`、`headroomAfterCents = capCentsAtExecution − amountAfterCents`）；provider 恒为 `null`；finance 得到全部字段；customer 逐字段按**执行时**生效的共享行获得（`committedCents` 行 → `baselineCents` / `approvedToDateCents` / `committedBeforeCents` / `committedAfterCents`，`capCents` 行 → `capCentsAtExecution`，`headroomCents` 行 → `headroomAfterCents`；未共享的字段为 `null`，禁止溯及既往，07 PV-12、08 §8.6.6）；`thisChangeCents` 是公开目录价之和（= `terms.amountCents`），对 customer 恒给出。`whyChain`（结果页 "Why this result"）由服务端从不可变行回溯组装，不从已加载的时间线页推断：执行 → 被执行提案 → 其 run（`cause`）→ run 由约束变更开启时，该 cv 的 `constraintRevisions` 行及被它置为 `stale` / `superseded` 的上一提案与失效审批 → run 内被回答的请求 → `approvalIds` 中的审批 → 执行；至多回溯 20 个约束版本（与 `proposalHistory` 同界），更早的折叠为一步。每步 `text` 用与 `timeline.page` 相同的受众模板（作者中立、provider 的 `run_waiting` 投影、`restrictedRef` 连接规则相同），`href` 只给查看者能打开的页面（提案永久链接 `/rooms/[roomId]/proposals/[proposalId]`；请求页只对 `toRole` 与买方给出，provider 为 `null`）。**读** `executions.by_room`、`changeOrders.by_execution`、`tasks.by_execution`、`approvals`（按 `approvalIds` 与失效审批）、`members`、`sharedFacts`、`proposals`、`runs`、`constraintRevisions`、`humanRequests`。

#### `timeline.page` · memberQuery
- **args** `{ roomId, paginationOpts: paginationOptsValidator }`；**returns** `paginationResultValidator(timelineItemV)`，`timelineItemV = { eventId, type, at /* _creationTime */, actorKind: "human" | "agent" | "rules" | "system", actorRole: role | "system", text, refs: { proposalVersion: number | null, constraintsVersion: number | null, runNo: number | null }, privateToYou: boolean, provenance }`（03 的 `EventView.actor` 在 DTO 中展开为两个字段，Δ5）；从不包含 `payload` 或 `restrictedRef`。
- **读** `events.by_room_order` 倒序、一次 `.paginate()`，游标是字符串；每条事件按查看者选模板变体并 `renderPublicText`；带 `restrictedRef` 的只在查看者有权时连接被引用行并标 `privateToYou`；历史值按"值所属版本生效时的受众"判定（07 §7.8.3）。例：`constraints_changed` 对 provider 只显示 "Constraints changed (vN)"；`run_needs_input` / `human_request_opened` 对非 `toRole` 的 provider 渲染为 `run_waiting`（D14）；房间 `open` 后他人的 `brief_confirmed`、非本人的 `human_request_answered`、`superseded` 的 `human_request_closed`，以及 provider 不在新旧受众内的 `disclosure_changed`，凡与 `constraints_changed` 同一提交，对 provider 一律并入那一条 "Constraints changed (vN)"、不单独渲染（`human_request_answered` 单独出现时渲染为 "Negotiation resumed"；`disclosure_changed` 单独出现时只渲染 "{role} updated what they share"）；他人引起的约束变更提交内**全部**条目对 provider 的 `actorKind` / `actorRole` 置为 `"system"`（07 §7.17 的作者中立，视图模型负责，不在组件层隐藏）；`approval_recorded` 的 `buyers` 受众 `reasonKey` 只对 customer / finance 经 `restrictedRef` 连接；`turn_failed` 对他方渲染为 "{Role} agent finished"（03 §3.11.1，privacy-02 / 06）；16 TC-PRIV-21 断言由 finance `setCap`、customer 改截止日、`answer(raise_cap)` 引起的 bump，在显式共享给 provider 的值相同、DX 结论相同的前提下，provider 的 `rooms.view` 与 timeline 规范化后逐字节相同（`sharedFacts[].asOfBriefVersion` 对 provider 为 `null`）。事件全员可读、没有 `visibility` 字段，页大小因此稳定。

W2-13 append-only clarification: request options expose `type` as the public effect discriminator and `shown` as the immutable §3.9 display snapshot; `effectView` remains a compatibility alias of `shown`. `blocked` exposes an empty snapshot. Open question: §12.17 previously named only `effectView`; confirm `type` as the discriminator field name (used provisionally), including the existing `retry_turn` option.
