# 04 · 状态机（part4）：提案、审批、人工请求、目录项 / 任务 / 邀请

> 分片清单见 `04-state-machines.md` 顶部。

## 4.6 提案（proposal）

提案状态只有 `active`、`superseded`、`rejected`、`stale`、`executed`（canon §1.3，**没有** `endorsed` / `approved` / `blocked`：前两者分别由 `run.status === "pending_approval"` 与审批集合派生，`blocked` 是 `passesChecks` 的读时结论）。条款字段（`terms`、`termsKey = canonicalJson(terms)`、`lines[]`、`plannedTasks[]`、`requiredApprovals`、`version`、`createdAtConstraintsVersion`、`origin`、`runId`）写后不改；只有 `status` / `statusChangedAt` 经 `setStatus` 变化（canon D25）。

| # | from → to | 触发（调用者） | 守卫 | 同事务副作用 |
| --- | --- | --- | --- | --- |
| P1 | ∅ → `active` | `turns.complete`（provider `propose`，所选候选 `passesChecks` 通过）；`humanRequests.answer(choose_candidate)`（R15，全量重算通过） | 持久化守卫 G0–G3 / 回答守卫（4.8.2）通过 | `version = room.nextProposalVersion` 后 `++`（读写 room，OCC 保证房间内唯一单调，不因新 run 或 bump 重置，被阻断或被拒收的回合不消耗版本号）；服务端物化 `terms`（金额 = Σ `lines[].priceCents`，`deliveryDate = room.localDate + max(leadDays)`，canon D10/D22）；`origin: agent \| human_choice`、`sourceTurnId` / `sourceRequestId`、`provenance`（stub 代理产物为 `stub`）；本 run 旧 `active` → `superseded`（P2a）；`run.currentProposalId = 新 id`；事件 `proposal_created`（provider 只见 `fit`） |
| P2a | `active` → `superseded` | P1 | 同 run 出现更新版本 | — |
| P2b | `active` → `superseded` | run 非因约束变化而结束：`runs.cancel`、`rooms.close` / `rooms.forceClose`、`runs.requestRenegotiation`、R17（`end_run` / 轮次用尽 / 请求过期） | 该提案是被结束 run 的 `currentProposalId` | 事件随 run 迁移写 |
| P3 | `active` → `rejected` | `approvals.record(reject)`（必需审批人） | A-G1…A-G10 通过 | R10 / R11；被拒 `candidateKey` 进入本 run 阻断集 |
| P4 | `active` → `stale` | `constraints.bump` → `disposeCurrentRun`（09） | 该提案是被取代 run 的 `currentProposalId` | 事件 `proposal_status_changed`（"no longer valid under constraints vN"，按受众渲染） |
| P5 | `stale` → `active` | `startRunTx` 的 R2 分支 | 与 P4 在**同一事务**；`passesChecks(P, ruleInput@新 cv)` 通过；该行从未是 `rejected` | 新 run `currentProposalId = P`；不复制版本（RA-R11 否决） |
| P6 | `active` → `executed` | `executions.executeIfComplete` | 08 | 08 |

终态：`superseded`、`rejected`、`executed`。`stale` 只在 P4 的同一事务内可能经 P5 回到 `active`；事务提交后仍为 `stale` 的行永不再变——后续 bump 只看被取代 run 的当前提案（`keepCandidateId`），所以既不会复活被拒提案，也不会复活更早的过时提案（canon D06、inputs/07"复活被人拒绝的提案"）。

P2b 让"`active` ⇒ 是房间唯一非终态 run 的 `currentProposalId`"恒成立（INV-SM-06）；canon §1.3 已把 `superseded` 定义为"同 run 被新版本替代，或所属 run 非因约束变化而结束"，与 P2b 一致（4.15 Q3 已关闭）。

## 4.7 审批（approval）

`approvals` 只追加，一行一决定（canon D02）；`decision ∈ approve | reject | withdraw`；`(proposalId, userId)` 内 `seq` 由服务端在同事务"读最后一行 + 1"分配。

### 4.7.1 派生有效性（`evaluateApprovalSet`，唯一实现归 08）

对提案 P 的每个必需角色 r（`P.requiredApprovals` 快照），取 r 的**当前**成员 m，其在 P 上 `seq` 最大的行记为 last：

| 派生值 | 条件 | 界面文案（13 定稿） |
| --- | --- | --- |
| `pending` | 无行 | Awaiting decision |
| `withdrawn` | `last.decision === "withdraw"`（计为未决） | Withdrawn · awaiting decision |
| `effective` | `last` 为 approve ∧ `boundConstraintsVersion === room.constraintsVersion` ∧ `boundTermsKey === P.termsKey` | Approved under constraints v{cv} |
| `stale_approve` | `last` 为 approve ∧ `boundConstraintsVersion ≠ room.constraintsVersion` | No longer applies · approved under constraints v{old} |
| `rejected` | `last` 为 reject 且绑定当前 cv | Rejected under constraints v{cv} |
| `stale_reject` | `last` 为 reject 且绑定旧 cv（只在历史视图出现：被拒提案已终局） | Rejected under constraints v{old}（不得显示为 pending，RA-B30） |

完成 ⇔ 每个必需角色都是 `effective` 且被选中的 `userId` 两两不同；禁止计数式判定。前成员的行不计入。**房间 `executed` 之后不再实时派生**：结果页只读 `executions.approvalIds` 冻结快照（canon D04、R-J），之后任何事都不会把促成执行的审批显示为失效。

### 4.7.2 允许的追加

| 当前派生值 ＼ 决定 | `approve` | `reject` | `withdraw` |
| --- | --- | --- | --- |
| `pending` / `withdrawn` | ✓（需 `passesChecks`） | ✓ | 不插行，`unchanged`（没有可撤回的 approve） |
| `effective` | 不插行，返回 `{ status: "unchanged" }`（仍做一次执行收敛检查，12 §12.15 ⑪） | ✓（改变主意 → P3） | ✓（执行前；只能撤回本人在当前 cv 上的 approve，canon D02） |
| `stale_approve`（提案经 R2 沿用后） | ✓ 重批 | ✓ | 不插行，`unchanged`（本人没有当前 cv 上的 approve 可撤回，canon D02） |
| `rejected` / `stale_reject` | 提案已 `rejected`，A-G3 拒绝（`approval.not_current`） | 同左 | 同左（reject 终局，不可撤回） |
| 房间 `executed` | 对已执行提案的 approve → 幂等成功 `{ status: "executed", executionId, alreadyExecuted: true }`；其余 `approval.already_executed` | `approval.already_executed` | `approval.already_executed` |

### 4.7.3 `approvals.record` 规格

参数（与 12 §12.15 一致）：`{ proposalId, decision: "approve" | "reject" | "withdraw", expectedConstraintsVersion, expectedTermsKey, reasonKey: string | null, note: string | null }`；`reasonKey` 是场景声明的封闭枚举（不是 reasonCode）；`note` ≤ 500 码点、只给本人，不进事件、不进他方上下文（canon D13）。求值顺序与失败码以 08 §8.5.3 的 S0–S14 为准（12 §12.15 的 ①–⑪ 逐条对应）；下表按该顺序排列，编号只是其他章节引用的名字、不表示求值先后，第二列括注对应的 08 步号：

| 编号 | 守卫（08 步） | 失败码（不写任何行） |
| --- | --- | --- |
| A-G1 | （S0–S1，构造器）调用者已登录、已开通，且是 `P.roomId` 的成员（提案不存在亦同） | `auth.unauthenticated` / `auth.user_not_provisioned`；`auth.not_member` |
| A-G10 | （S1，与 A-G1 同一次读）`members.by_room_user` 只解析出一个席位；取到 2 行即 D24 被破坏。完成判定内"同一 userId 不得占两个必需槽"另由 08 `evaluateApprovalSet` 判为不齐（canon D24 第二道防线） | `approval.self_conflict` |
| A-G2 | （S3–S5）已执行快速路径：`P.status === "executed"` 时 approve 幂等返回 `executed{ alreadyExecuted: true }`，reject / withdraw 拒绝；房间 `setup` / `executed` / `closed` 拒绝（4.7.2 最后一行）；仅 approve：房间钉住的 `scenarioKey@scenarioVersion` 仍可解析（reject / withdraw 跳过） | `approval.already_executed`；`approval.not_current`（`setup`）/ `approval.already_executed`（`executed`）/ `run.invalid_state{guard:"room_status"}`（`closed`）；`run.invalid_state{guard:"scenario_version"}` |
| A-G3 | （S6，08 `isCurrentForApproval` 的提案一半）`P` 是 `room.currentRunId` 所指 run 的 `currentProposalId` 且 `P.status === "active"` | `approval.not_current` |
| A-G4 | （S6，同一谓词的 run 一半）该 run 的 `status === "pending_approval"`；当前性只看 `run.currentProposalId` 与 run 状态，**不**比较 `P.createdAtConstraintsVersion`（canon §1.3；R2 沿用的提案照样可批） | `approval.not_current` |
| A-G6 | （S7）调用者角色 ∈ `P.requiredApprovals[].role`（`kind` 由角色派生：customer / provider = terms，finance = budget）；先于 A-G5 求值 | `auth.role_forbidden` |
| A-G5 | （S8）`expectedConstraintsVersion === room.constraintsVersion` ∧ `expectedTermsKey === P.termsKey` | `approval.stale`（`params.currentConstraintsVersion`） |
| A-G9 | （S9–S10）按决定读本人 / 本提案审批行后去重：approve 与本人当前决定相同且绑定当前 cv → 记为 unchanged，先用已读的审批行跑 `evaluateApprovalSet`：未齐 → 直接返回 `unchanged`（不跑 A-G8）；已齐却未执行 → 继续 A-G8 与执行；withdraw 而本人当前决定不是绑定当前 cv 的 approve → 直接 `unchanged`（4.7.2，canon D02 / §1.5）；本人 approve 行 ≥ 60 且需写新行、或 withdraw 行 ≥ 10 → 限额（reject 永不受限） | 非错误（`unchanged`）；`run.rate_limited` |
| A-G7 | （S10）reject 时 `reasonKey` ∈ 场景枚举，其他决定为 `null`；`note` 长度与字符 | `input.invalid` |
| A-G8 | （S11）approve（含判定集合已齐的 unchanged）：同事务 `passesChecks(P, loadRuleInput(roomId))`——连同 A-G2…A-G4 的当前性即 canon §1.3 的 `isExecutable`（纵深防御，正常路径必过） | `approval.not_executable`（`reasonCodes` 按调用者投影，provider 为空） |

写入：`approvals` 行（`roomId`、`proposalId`、`userId`、`role`、`decision`、`seq`、`boundConstraintsVersion = room.constraintsVersion`、`boundTermsKey = P.termsKey`、`reasonKey?`、`note?`）+ 事件 `approval_recorded`（版本、角色、决定、cv；不含 note）。之后：reject → P3 + R10 / R11；approve → `evaluateApprovalSet` 完成则同事务 `executions.executeIfComplete`（R9、M3、P6）；withdraw → 无迁移。读：rooms、runs、proposals、members、审批行（approve 读本提案整区间，使并发的最后两票 OCC 冲突；reject 只读本人最新一行、withdraw 读本人区间，08 S9）、规则输入（briefs、catalogItems、`ledgerEntries.by_room` 区间）、`executions.by_executionKey`。

## 4.8 人工请求（humanRequest）

### 4.8.1 迁移

| # | from → to | 触发 | 守卫 | 副作用 |
| --- | --- | --- | --- | --- |
| H1 | ∅ → `open` | `openHumanRequestTx`：由 R3、R6、R11、R19、R20、R21 调用（系统） | run 在同事务进入或停留在 `needs_input`；该 run 无其他 open 请求（`humanRequests.by_run_status`）；`options` 非空且末项含出口（`end_run`）；`buildHumanRequests(toRole, viewFor(toRole))` 只用目标角色视图，写入前 `assertOptionsProjected`（canon D11）；无合格角色时按 4.8.3 兜底 | `expiresAt = now + HUMAN_REQUEST_TTL_DAYS(7)`；`constraintsVersion`（创建时）；事件 `human_request_opened`（provider 只见 `run_waiting`，除非它就是 `toRole`） |
| H2 | `open` → `answered` | `humanRequests.answer` / `runs.retryTurn`（`toRole` 成员） | 4.8.2 | `answeredBy`、`answerOptionKey`；按效果迁移 run |
| H3 | `open` → `expired` | `humanRequests.expireDue`（cron，每小时，`by_status_expiresAt`） | `now ≥ expiresAt` | R17（`request_expired`）；creator 待办；事件 `human_request_closed` |
| H4 | `open` → `superseded` | `constraints.bump`、`runs.requestRenegotiation`、`runs.cancel`、`rooms.close` / `rooms.forceClose`、R19 | — | `closedReason` ∈ `constraints_changed` / `renegotiation_requested` / `run_canceled` / `room_closed` / `regenerated`（03）；事件 `human_request_closed` |

终态：`answered`、`expired`、`superseded`。请求不重开，需要时生成新请求。

### 4.8.2 `humanRequests.answer({ requestId, optionKey })`

守卫顺序（与 12 §12.14 一致）：成员 → 角色 = `request.toRole`（`auth.role_forbidden`）→ `request.status === "open"`（同一人同一选项重复提交 → `already_answered`，否则 `request.not_open`）→ `now < expiresAt`（`request.not_open`，cron 随后标 `expired`）→ room `open` 且 `request.runId === room.currentRunId` 且 run 为 `needs_input`（`run.invalid_state`）→ `optionKey ∈ request.options`（`request.option_unknown`）→ 除 `end_run` 外非排空（`run.draining`）→ 节流（`run.rate_limited`）→ 效果自身校验。

| `effect`（canon D15） | 收件人 | 回答时 | run 迁移 | bump |
| --- | --- | --- | --- | --- |
| `raise_cap { amountCents }` | finance | `assertCents`；`amountCents ≥ committedCents`（否则 `budget.below_committed`）；请求 → `answered`；写新 finance 简报版本（`capCents = amountCents`，`confirmedBy` = 回答者）；`withConstraintChange(cause: human_answer)` | R16 → `react()` | 是 |
| `drop_items { itemKeys }` | customer | 结果 `requiredItemKeys` 非空（否则 `item.required_missing`）；同上写 customer 新简报 | R16 | 是 |
| `extend_deadline { date }` | customer | `room.localDate ≤ date ≤ localDate + 365`（`date.out_of_range`）；写新简报 | R16 | 是 |
| `choose_candidate { candidateKey }` | customer | 全量 `passesChecks`：通过 → 与当前 active 提案同候选则复用，否则 P1（`human_choice`）；失败 → R19 | R15 / R19 | 否 |
| `disclose { field, toRoles }` | 被问方 | 经 `sharedFacts.add` 同一闸门（不通过 `disclosure.blocked`，请求保持 open）；`toRoles` 由选项生成时写定（clarify：发问角色；infeasible 回退：尚未获披露的放松角色） | R14（clarify）/ R20（infeasible 回退） | 否 |
| `retry_turn` | 失败方 | 新 turn | R14 | 否 |
| `keep_as_is` | 收件人 | 按 kind（05 §5.11.4）：`clarify` → 拒绝披露、发问方同轮新回合；`rounds_exhausted` → 延长一轮（`maxRounds += 1`、`roundsExtended = true`，每 run 一次；run 上限触发的请求不提供此选项；回答时以提供时的同一资格谓词复核，原因从请求的 `questionKey` 读回）；customer `agent_escalated` → 下一轮；provider `agent_escalated` → provider 同轮新回合；轮次已尽且不可延长 → 等价 `end_run`；`infeasible` / `agent_failed` 请求不提供（canon D15） | R14 / R17 | 否 |
| `pass_to_next { toRole }` | `infeasible` 请求的收件人 | 只出现在 `infeasible` 请求（含回退请求），且收件人不是 `relaxationOrder` 末位；`toRole` = 下一个角色；每 run 每个 (from, to) 至多一次（canon D15） | R21 | 否 |
| `end_run` | 收件人 | — | R17 | 否 |

- 带约束效果的回答先把本请求置 `answered`，再写来源、再 bump，所以 bump 的"取代 open 请求"不会误伤它；之后由 `react()` 开新 run（09 §9.4）。
- 若约束效果实际未改变硬投影（选项生成保证不应发生），不 bump，按 R20 的方式同事务重跑预检：仍无解 → `openHumanRequestTx` 生成新的 `infeasible` 请求，有解 → 建 provider 回合、run → `negotiating`；并 `publicOpsLog("request.effect_noop", { fn: "humanRequests.answer" })`（公开路径的闭集 logger，15 §15.6.2），绝不留下"`needs_input` 却无 open 请求"的 run（inputs/07）。约束效果只出现在 `infeasible` 请求里，而 canon D15 规定 `infeasible` 不提供 `keep_as_is`，所以这里不能"按 `keep_as_is` 处理"。
- **没有任何选项映射到 `rooms.close`**；关房只有 creator 的 `rooms.close`。

### 4.8.3 恰好一个请求与兜底

`buildHumanRequests` 按场景 `relaxationOrder`（首个场景 `[customer.drop_items, finance.raise_cap]`，canon D15；customer 视图下若阻断来自截止日，同一请求可带 `extend_deadline`，选项细节由 14 定）选第一个"其自身视图下候选集为空、且单独放松自身一个硬字段即可非空"的角色（视图下候选集非空的角色看不到真正卡住的约束，被跳过；canon D15）；收件人不是 `relaxationOrder` 末位时，`infeasible` 请求另带 `pass_to_next { toRole: 下一个角色 }`（R21：是否出现只取决于位置，不泄露下一角色的约束是否卡住）；轮次用尽、provider 无可选候选（含 provider 本 run 已 propose 4 次，原因记 `no_candidates`）、run 的 attempt / 美元上限用尽（`call_limit` / `spend_limit` 只用于这两个 run 上限）→ customer 的 `rounds_exhausted`（`choose_candidate`（customer 视图可行者，零模型调用即可送审）/ `keep_as_is`（仅 `rounds` 情形、未延长过、provider 仍有可提候选且本 run 未满 4 次提案时提供；`no_candidates` / `call_limit` / `spend_limit` 不提供——再给一轮也必然立刻用尽；提供与回答共用同一资格谓词）/ `end_run`；`questionKey = request.rounds_exhausted.{rounds | no_candidates | call_limit | spend_limit}` 区分文案，05 §5.8.5）；回合失败（重试耗尽或不可重试）→ 失败方的 `agent_failed`（`retry_turn` / `end_run`）。若没有任何角色按自身视图存在放松选项（每一方单看自己都可行、合起来不可行），向 `relaxationOrder[0]` 的角色（customer）发 `kind: infeasible` 的**回退请求**（06 §11.2）：选项为它尚未向其他放松角色披露的硬字段各一个 `disclose { field, toRoles }`（如 `disclose { field: 'deadline', toRoles: ['finance'] }`）加 `end_run`，模板说明"No single change by one party makes an option feasible. Sharing your deadline with Finance lets the budget owner see the conflict."；回答 `disclose` 走 R20，同事务重跑预检——请求仍然恰好一个，任何一方的约束写入也仍可触发 bump 让 run 重新开始。

## 4.9 目录项、任务、邀请

| 对象 | # | from → to | 触发 | 守卫 / 说明 |
| --- | --- | --- | --- | --- |
| catalogItem | C1 | ∅ → `draft` | `rooms.startFollowUp`（只复制旧房间目录中 `itemKey ∉ followedExecution.terms.itemKeys` 的行，modifier 可复制；已执行条目在新房间只读显示 "Delivered in CO-n"，12 §12.6——否则 stub / 模型默认路径会把已执行条目再提一次、再承诺一次） | 新房间 `setup`；draft 不进任何他方视图、不进硬投影；每个 execution 至多一个后续房间（`rooms.by_followsExecutionId` 先查后插 + 旧房间写锁） |
| catalogItem | C2 | `draft` / ∅ → `confirmed` | `catalog.confirm`（provider） | 行只追加：draft 行（`revision 0`）从不修改，确认插入 `revision 1` 的新行；之后每次改动插新行，`revision` / `editNo` 规则见 09 §9.1.3 与 03 §3.7。"状态"指该 itemKey 当前行的 `status` |
| catalogItem | C3 | `confirmed` → `retired` | `catalog.retire`（provider） | 插入 `status: retired` 的新行（`revision + 1`）；投影变化 → bump |
| task | T1 | ∅ → `open` | `executions.executeIfComplete` | 只在执行事务内，来自 `proposal.plannedTasks` 快照，`taskKey = ${executionId}:${itemKey}:${templateIndex}` |
| task | T2 | `open` → `done` | `tasks.markDone`（`task.assigneeRole` 的成员，`auth.role_forbidden`） | room `executed`（唯一允许的执行后写入之一，4.2.2）；`done` 终态 |
| invite | — | 存储 `open → accepted \| superseded`（03 §3.5）；过期在 accept 时比较 `expiresAt`、不写状态 | `invites.accept`（被邀请人） | room `setup`；`now < expiresAt`（72h，mutation 内判定）；角色空缺且该用户在本房间无席位（`members.by_room_role` / `by_room_user` 区间读，OCC 串行）；邮箱邀请要求 `emailVerified`（canon D24）；写 `members` 后 `openIfReady` |
