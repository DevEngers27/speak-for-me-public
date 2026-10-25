# 12 · 后端函数目录（part4）：runs、humanRequests、approvals、tasks

## 12.13 runs（公共写入）

`runStatusV` 取 canon §1.3（`negotiating` / `pending_approval` / `needs_input` / `executed` / `superseded` / `ended_no_agreement` / `canceled`；没有 `paused`）。守卫与 04 §4.3 的 run 迁移表一致；run 只经 `startRunTx` 插入，回合只经 `createTurnTx` + `beginAttempt`（10）。

#### `runs.start` · memberMutation · 节流 `constraint_writes` + `run_starts`（每房间每 24 小时 ≤ 6 个 run）
- **args** `{ roomId: v.id("rooms") }`；**returns** `v.object({ runId: v.id("runs"), created: v.boolean(), status: runStatusV })`
- **守卫** ① 成员；② `room.status === "open"`（`run.invalid_state{guard:"room_status"}`）；③ 当前已有非终态 run → 返回 `{ runId: 既有, created: false, status }`（不写、不计节流）；④ 就绪（04；`run.invalid_state{guard:"not_ready"}`）；⑤ `opsFlags.draining === false`（`run.draining`）；⑥ 节流；然后 `openRoomTx(allow: ["open"])`。
- **写**（`startRunTx(cause: "manual_start")`）`runs`（`runNo = room.nextRunNo`、`constraintsVersionAtStart`、`agentMode` 快照、`roundNo: 1`、`maxRounds` 与 `maxAttempts`（`maxRounds × 3 × 2`）与 `spendCapMicroUsd` 快照、`startedBy`）；`rooms.currentRunId` / `nextRunNo`；预检：全量约束下的可行集（`buyerFeasible`，04 §4.3.3）非空 → `createTurnTx`（provider propose，`candidateSnapshot` = `enumerateCandidates(viewFor("provider"))` ≤ 12 项、按 `candidateKey` 稳定排序、首位为 provider 视图下最低价含必需项候选，D10）+ `beginAttemptTx(origin: "turn_start")`；为空 → `needs_input` + `openHumanRequestTx`（恰好一个请求，D15）；`events`：`run_started{ runNo, cause }`（命令事件）、`turn_scheduled` 或 `run_needs_input`。
- **读** `rooms`、`opsFlags`、`runs`、`members`、`briefs`、`catalogItems`、`ledgerEntries`、`sharedFacts`、`events`（节流）。
- **幂等** 自然幂等（已有活跃 run 时返回它；并发开局由写锁串行）。**失败码** `auth.not_member`、`run.invalid_state`、`run.draining`、`run.rate_limited`。

#### `runs.retryTurn` · memberMutation · 节流 `constraint_writes`
- **args** `{ runId: v.id("runs") }`；**returns** `v.object({ attemptId: v.union(v.id("attempts"), v.null()) })`（`null`：回合已建但被停泊）
- **语义** `humanRequests.answer(retry_turn)` 的便捷别名，两者共用 `applyHumanAnswer`，写入完全相同（D15：回合失败走 `needs_input` + `agent_failed`）。
- **守卫** ① 成员；② `run` 是 `room.currentRunId` 且 `status === "needs_input"`（`run.invalid_state{guard:"run_status"}`）；③ 存在含 `retry_turn` 选项的 open `agent_failed` 请求（`run.invalid_state{guard:"no_failed_turn"}`；run 的 attempt / 美元上限触发时开的是 customer 的 `rounds_exhausted`，没有 `retry_turn`，也落在这里）；④ 调用者角色 === 请求的 `toRole`（`auth.role_forbidden`）；⑤ 非排空（`run.draining`）；⑥ 节流。
- **写** 请求 → `answered`（`answeredBy`、`answerOptionKey`、`answeredAt`）；run → `negotiating`；因为 `failed` 是 turn 终态，新建同角色、同 kind、同轮回合（新 `turnSeq`，`retryOfTurnId` 指向失败回合，04 §4.4）并 `beginAttemptTx(origin: retry_turn)`；`events`：`human_request_answered`（命令事件）、`run_resumed`、`turn_scheduled`。
- **失败码** `auth.not_member`、`auth.role_forbidden`、`run.invalid_state`、`run.draining`、`run.rate_limited`。

#### `runs.requestRenegotiation` · memberMutation · `creatorOnly` · 节流 `constraint_writes`
- **args** `{ roomId: v.id("rooms"), expectedRunId: v.id("runs") }`；**returns** `v.object({ runId: v.id("runs"), status: runStatusV })`
- **守卫** ① 创建者（`auth.not_creator`）；② `room.status === "open"`（已执行房间拒绝，D04）；③ `room.currentRunId === expectedRunId`（`run.invalid_state{guard:"run_changed"}`）；④ `run.status ∈ {pending_approval, needs_input}`（`run_status`，C40）；⑤ 非排空；⑥ 节流。
- **写** 旧 run → `superseded`（`endedReason: "renegotiation_requested"`），其 `active` 提案 → `superseded`，open 请求 → `superseded`（`closedReason: "renegotiation_requested"`）；`startRunTx(cause: "renegotiation_requested")`（不做"沿用旧提案"的预检，那只属于约束变化，D06）；旧审批行不改，因提案不再是当前提案而失效；`events`：`run_renegotiation_requested`（命令事件）、`run_ended`、`run_started`。
- **失败码** `auth.not_creator`、`run.invalid_state`、`run.draining`、`run.rate_limited`。

#### `runs.cancel` · memberMutation · `creatorOnly`
- **args** `{ runId: v.id("runs") }`；**returns** `v.object({ status: v.union(v.literal("canceled"), v.literal("unchanged")) })`
- **守卫** ① 创建者；② run 是 `room.currentRunId`（`run.invalid_state{guard:"run_changed"}`）；③ 已终态 → `unchanged`。
- **写** run → `canceled`（`endedReason: "canceled_by_creator"`）；`active` 提案 → `superseded`；open 请求 → `superseded`（`closedReason: "run_canceled"`）；非终态 turn → `stale`；`events`：`run_ended`。不调 `scheduler.cancel`：在途 attempt 由守卫 G1 拒收（D07）。之后任一成员可 `runs.start`。
- **失败码** `auth.not_creator`、`run.invalid_state`

## 12.14 humanRequests.answer

请求结构以 03 §3.9 为准：`options: [{ optionKey: "A".."E", templateKey, effect }]`，`effect.type` ∈ `raise_cap { amountCents }` / `drop_items { itemKeys }` / `extend_deadline { date }` / `choose_candidate { candidateKey }` / `disclose { field, toRoles }` / `retry_turn` / `pass_to_next { toRole }` / `keep_as_is` / `end_run`，另有只作说明、不可回答的 `blocked`（与 canon D15、05 §5.11.1 同形）。选项在开请求时由 `buildHumanRequests(toRole, viewFor(toRole))` 只用目标角色自己的视图生成，写入前 `assertOptionsProjected`（D11）。

#### `humanRequests.answer` · memberMutation（房间由 `requestId` 解析）· 节流 `constraint_writes`
- **args** `{ requestId: v.id("humanRequests"), optionKey: v.string() }`
- **returns** `v.union(v.object({ outcome: v.literal("applied"), effect: effectTypeV, constraintsVersion: v.number(), runId: v.union(v.id("runs"), v.null()), proposalId: v.union(v.id("proposals"), v.null()) }), v.object({ outcome: v.literal("regenerated"), requestId: v.id("humanRequests") }), v.object({ outcome: v.literal("superseded_by_clock"), constraintsVersion: v.number() }), v.object({ outcome: v.literal("already_answered") }))`
- **守卫**（04 §4.8.2 同序）① 成员；② 调用者角色 === `request.toRole`（`auth.role_forbidden`）；③ `request.status === "open"`：同一人同一选项已回答 → `already_answered`，其他 → `request.not_open`；④ `nowMs < expiresAt`（否则 `request.not_open`，cron 随后标 `expired`）；⑤ 房间 `open`、`request.runId === room.currentRunId` 且 run 为 `needs_input`（`run.invalid_state`）；⑥ `optionKey` 指向可回答的选项（不存在或 `blocked` → `request.option_unknown`）；⑦ 除 `end_run` 外非排空（`run.draining`）；⑧ 节流；然后 `openRoomTx(allow: ["open"])`；⑨ 效果自身校验。
- **处置**（`applyHumanAnswer`；带约束效果的选项先把请求置 `answered` 再写来源、再 bump，所以 bump 的"取代 open 请求"不会误伤它，`constraintRevisions.sourceRefs` 同时含请求与新简报，追溯链"cv N 由哪个回答造成"成立）：

| effect | 回答时校验与写入 | run 去向 |
| --- | --- | --- |
| `raise_cap { amountCents }`（finance） | `assertCents`；`amountCents ≥ committedCents`（否则 `budget.below_committed`）；`insertBriefVersion(finance, capCents = amountCents, source: "request_answer", humanRequestId)`；`withConstraintChange(cause: "human_answer")` | 旧 run `superseded` → `react()` 开新 run（预检） |
| `drop_items { itemKeys }`（customer） | 结果 `requiredItemKeys` 非空（否则 `item.required_missing`）；customer 新简报版本；同上 | 同上 |
| `extend_deadline { date }`（customer） | `localDate ≤ date ≤ localDate + 365`（`date.out_of_range`）；customer 新简报版本；同上 | 同上 |
| `choose_candidate { candidateKey }`（customer） | 先 `rollLocalDateTx(room)`（09 §9.6.7）并重读 room / run / 请求：若推进日期触发了 `bump(cause: "clock")`（本请求随之 `superseded`），或本请求已不再 open、不属于当前 run → 返回 `superseded_by_clock{ constraintsVersion }`，提交时钟与 `react()` 的写入，不继续复核与物化、也不抛错（抛错会把日期推进一并回滚）；否则用全量视图复核 `passesChecks`：通过 → 若等于本 run 当前 `active` 且仍通过的提案则**复用同一 proposalId**，否则 `insertProposal(origin: "human_choice", authorRole: "customer", sourceRequestId, chosenBy)`；不通过 → 本请求 `superseded`（`closedReason: "regenerated"`，照记 `answerOptionKey`，canon D15、04 R19），该候选进入剔除集合，同事务按目标视图重新生成同 kind 请求，返回 `regenerated`（05 §5.11.4） | 通过 → `pending_approval`（04 的 `needs_input → pending_approval`）；不通过 → 留在 `needs_input` |
| `disclose { field, toRoles }`（被问方） | 经 §12.11 的同一闸门写 `sharedFacts`（`source: "request_answer"`，受众 = 该字段最新行受众 ∪ `effect.toRoles`——`toRoles` 在生成选项时写定，不再从 `sourceTurnId` 反推发问方；值从回答者当前简报复制）；闸门不通过 → `disclosure.blocked`，请求保持 open | `clarify` 请求 → `negotiating`，发问方同轮新开回合（04 R14）；`infeasible` 回退请求 → 同事务重跑预检：仍无解 → 新 `infeasible` 请求、留在 `needs_input`，有解 → `negotiating`（04 R20） |
| `retry_turn`（失败方） | 新建替代回合（`retryOfTurnId`）并 `beginAttemptTx(origin: retry_turn)` | `negotiating` |
| `pass_to_next { toRole }`（`infeasible` 请求的收件人） | 校验 `toRole` 是 `relaxationOrder` 中收件人的下一角色、本 run 未作过该转交（否则 `request.option_unknown`——选项本不该存在）；本请求 `answered`；同事务 `openHumanRequestTx` 以 `toRole` 的**自身视图**生成新的 `infeasible` 请求（目标视图里没有可放松选项时只含 `disclose` 回退项与 `end_run`）；不 bump、不建回合 | 留在 `needs_input`（04 R21）；返回 `applied`（`effect: "pass_to_next"`） |
| `keep_as_is` | 按 kind（05 §5.11.4）：`clarify` → 拒绝披露，发问方同轮新回合；`rounds_exhausted` → 延长一轮（`roundsExtended`，每 run 一次）；customer 的 `agent_escalated` → 下一轮；provider 的 `agent_escalated` → provider 同轮新回合；轮次已尽且不可延长 → 等价 `end_run` | `negotiating` 或 `ended_no_agreement` |
| `end_run` | — | `ended_no_agreement`（`endedReason: "no_agreement"`）；房间保持 `open`，之后可 `runs.start` |

- 约束效果实际未改变硬投影（选项生成保证不应发生）→ 不 bump，按 04 R20 的方式同事务重跑预检：仍无解 → 生成新的 `infeasible` 请求，有解 → 建 provider 回合、run → `negotiating`；并 `publicOpsLog('request.effect_noop', { fn: 'humanRequests.answer' })`。约束效果只出现在 `infeasible` 请求，而 canon D15 规定 `infeasible` 不提供 `keep_as_is`，所以不能"按 `keep_as_is` 处理"（04 §4.8.2、09 §9.6.6）；绝不留下"`needs_input` 却无 open 请求"的 run。没有任何选项映射到 `rooms.close`。
- **读写** 读 `humanRequests`、`rooms`、`runs`、`turns`、`briefs`、`catalogItems`、`ledgerEntries`、`sharedFacts`、`opsFlags`；写 `humanRequests`、`briefs`、`sharedFacts`、`proposals`、`runs`、`turns`、`attempts`、`rooms`、`constraintRevisions`、`events`（`human_request_answered`；对非 `toRole` 的 provider 渲染为 "resumed"，D14）。
- **幂等** 自然幂等（`already_answered`）。
- **失败码** `auth.not_member`、`auth.role_forbidden`、`request.not_open`、`request.option_unknown`、`run.invalid_state`、`run.draining`、`run.rate_limited`，以及效果内的 `budget.below_committed`、`item.required_missing`、`date.out_of_range`、`disclosure.blocked`。

## 12.15 approvals.record

步骤与 08 §8.5.3（S0–S14）一一对应。

#### `approvals.record` · memberMutation（房间由 `proposalId` 解析）· 不计节流（reject 永远可做）
- **args** `{ proposalId: v.id("proposals"), decision: decisionV, expectedConstraintsVersion: v.number(), expectedTermsKey: v.string(), reasonKey: v.union(v.string(), v.null()), note: v.union(v.string(), v.null()) }`。客户端不传任何幂等键或角色（D03）。
- **returns** `v.union(v.object({ status: v.literal("recorded"), decision: decisionV, missingRoles: v.array(roleV) }), v.object({ status: v.literal("unchanged") }), v.object({ status: v.literal("executed"), executionId: v.id("executions"), alreadyExecuted: v.boolean() }))`
- **守卫** ① 成员（提案不存在亦为 `auth.not_member`；`members.by_room_user` 取到 2 行 → `approval.self_conflict`）；② 已执行快速路径：提案 `executed` 时 approve → 按 `executions.by_executionKey("exec:" + proposalId)` 返回 `executed{ alreadyExecuted: true }`（不写行、不写事件），reject / withdraw → `approval.already_executed`；③ 房间：`setup` → `approval.not_current`，`executed` → `approval.already_executed`，`closed` → `run.invalid_state{guard:"room_status"}`；④ 仅 approve：场景版本与房间钉住的一致（`run.invalid_state{guard:"scenario_version"}`；reject / withdraw 不跑规则，跳过此守卫，08 S5）；⑤ 当前性：提案是 `room.currentRunId` 的 `currentProposalId`、`status === "active"`、run 为 `pending_approval`（`approval.not_current`）；⑥ 调用者角色在 `proposal.requiredApprovals` 中（`auth.role_forbidden`）；⑦ `expectedConstraintsVersion === room.constraintsVersion` 且 `expectedTermsKey === proposal.termsKey`，否则 `approval.stale{ currentConstraintsVersion }`，不写行；⑧ 按决定分三种读法（08 S9 / S10）：**reject** 只读本人最新一行（`approvals.by_proposal_user` 前缀 `eq(proposalId).eq(userId)` 倒序 `first()`，不读他人行、不设任何上限）；**withdraw** 读本人区间 `eq(proposalId).eq(userId)`（按构造 ≤ 71 行），取最新行为本人当前决定并计 withdraw 行数——当前不是本 cv 上的 approve → 返回 `unchanged`，本人 withdraw 行 ≥ 10 → `run.rate_limited`；**approve** 读本提案整个审批区间求集合与本人当前决定：当前已是本 cv 上的 approve → 记为 unchanged，先用已读区间与当前成员跑纯函数 `evaluateApprovalSet`：未齐 → 直接返回 `unchanged`（不跑 ⑨、不 `openRoomTx`，§12.2 第 4 条），已齐却未执行 → 仍走 ⑨⑩⑪ 的收敛检查（**不受**人均上限阻挡），否则本次需写新行且本人 approve 行 ≥ 60 → `run.rate_limited`；`reject` 时 `reasonKey` 必须属于场景枚举，其他决定必须为 `null`，`note` ≤ 500 码点且无控制字符（`input.invalid`）；⑨ approve：以当前 `RuleInput`（`today = room.localDate`）跑 `checkProposal`，不通过 → `approval.not_executable{ reasonCodes }`（按调用者投影；正常路径不触发，触发时 `publicOpsLog('approval.not_executable', { fn: 'approvals.record' })`）。
- **写** ⑩ `openRoomTx(allow: ["open"])` → `approvals` 只追加一行（`seq + 1`、`role`、`kind` 由角色派生（customer / provider = `terms`，finance = `budget`）、`boundConstraintsVersion`、`boundTermsKey`、`reasonKey`、`note`（只给本人）、`runId`、`decidedAt`）；`events`：`approval_recorded{ proposalVersion, role, decision, boundConstraintsVersion, reasonKey? }`——`reasonKey` **只在**该键的场景受众为 `room` 时写进 payload；受众为 `buyers` 的键（v1 只有 finance 的 `over_our_limit`）不进 payload，只在 `timeline.page` 渲染时经 `restrictedRef → approvals` 对 customer / finance 连接（canon D14：payload 只含房间可见的值；08 S12）；`note` 只经 `restrictedRef` 对作者连接。
- **后续** ⑪ `reject` → 04/05 的 `onProposalRejected`：提案 `rejected`（终局），候选进入派生剔除集合 `excludedCandidateKeys(run)`；`roundNo < maxRounds` → run `negotiating`、`roundNo + 1`、新 provider propose 回合并 `beginAttemptTx`（排空时停泊，reject 本身照常成功；房间钉住的场景版本不可解析时 `createTurnTx` 不建回合，run 改走 `needs_input` + `agent_failed(end_run)`，04 U1、08 §8.5.4）；否则 → `needs_input` + 给 customer 的 `rounds_exhausted` 请求。`withdraw` → 只记录，run 保持 `pending_approval`；读本提案整个审批区间求写入后的集合，返回 `recorded{ decision: "withdraw", missingRoles }`（至少含本人角色，08 S13）。`approve`（含集合已齐的 unchanged）→ `executions.executeIfComplete`（同事务，§12.19）：未齐返回 `recorded{ missingRoles }`，齐则执行并返回 `executed{ alreadyExecuted: false }`。
- **读写** 读 `proposals`、`rooms`、`runs`、`members`、`approvals`、`RuleInput`、`executions`；写 `approvals`、`proposals`、`runs`、`turns`、`attempts`、`humanRequests`、`executions`、`ledgerEntries`、`changeOrders`、`tasks`、`rooms`、`events`。
- **幂等** 同一决定 → `unchanged`；执行至多一次由 `executionKey` 先查后插 + 房间写锁保证：最后两票并发时后提交者冲突重试，在 ② 或 `executeIfComplete` 内得到 `alreadyExecuted`（spikes §8 #1 在真实部署验证）。重复 reject（双击）第二次在 ⑤ 失败（`approval.not_current`），前端视为已处理。
- **失败码** `auth.not_member`、`auth.role_forbidden`、`run.invalid_state`、`approval.stale`、`approval.not_current`、`approval.already_executed`、`approval.not_executable`、`approval.self_conflict`、`run.rate_limited`、`input.invalid`。

## 12.16 tasks

#### `tasks.markDone` · memberMutation（房间由 `taskId` 解析）
- **args** `{ taskId: v.id("tasks") }`；**returns** `v.object({ status: v.union(v.literal("done"), v.literal("unchanged")) })`
- **守卫** ① 成员；② 调用者角色 === `task.assigneeRole`（`auth.role_forbidden`，canon §1.3"只有被指派人可勾选"）；③ 已 `done` → `unchanged`；④ `openRoomTx(allow: ["executed"])`——这是 D04"执行后拒绝写入"的业务例外（§12.25 Q3）。
- **写** `tasks.status → "done"`、`doneByUserId`、`doneAt`；`events`：`task_completed{ taskKey }`。**失败码** `auth.not_member`、`auth.role_forbidden`、`run.invalid_state`。
