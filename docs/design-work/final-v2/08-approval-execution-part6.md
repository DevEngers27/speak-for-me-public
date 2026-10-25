# 08 审批与执行（part6）：8.6 执行事务、记录派生、执行之后、查询与投影

## 8.6.1 `executeIfComplete` 签名

```ts
// convex/model/executions.ts —— 事务内 helper（不注册为 Convex 函数，12 §12.19）；
// 唯一调用方：approvals.record 的 S13（approve，含 unchanged 的收敛检查）。
export async function executeIfComplete(tx: RoomTx, a: {
  proposalId: Id<'proposals'>;
  actorUserId: Id<'users'>;            // 提交最后一票的人（被调度函数无身份，统一显式传）
}): Promise<
  | { status: 'not_complete'; missingRoles: Role[] }
  | { status: 'executed'; executionId: Id<'executions'> }
>;
```

canon D03 要求它**自己重读**全部判定输入，而不是信任调用方传入的中间结果：同一事务内重读返回同一快照（加上本事务自己的写入），代价只是几次有界读取，换来"任何新调用点都不能绕过判定"。`tx` 是 `openRoomTx` 返回的写门面（03 §3.3.2，M-ROOM 已在 S12 或此处打开）。

## 8.6.2 执行分步（与 S0–S13 同一事务；任一步抛错 → 连同最后一票全部回滚）

| 步 | 动作 | 读 | 写 | 失败 → 结果 |
| --- | --- | --- | --- | --- |
| X0 | 重读 `room`（`tx.room`）、`run = room.currentRunId`、`proposal`、本提案审批整区间、`members.by_room_role`（每个必需角色 `take(2)`）、`ruleInput = loadRuleInput(tx, room, room.localDate)` | rooms、runs、proposals、approvals、members、briefs、catalogItems、ledgerEntries | — | — |
| X1 | `isCurrentForApproval` 为真（否则 `internal` + `invariant.guard_bypassed`）；`set = evaluateApprovalSet(...)`；`set.slots` 含 `self_conflict`（一人占两个必需席，D24 被破坏）→ `publicOpsLog('approval.self_conflict', { fn: 'approvals.record' })`，该角色计入 `missingRoles`、不执行（fail closed，K14 / U9）；未齐 → 返回 `not_complete{ missingRoles }`（无写入）；`verdict = checkProposal(ruleInput, proposal, room.localDate)`，不通过 → `approval.not_executable`（同事务内 S11 已通过，正常不可达） | — | — | 见左 |
| X2 | 一房一执行：`executions.by_room.eq(roomId).take(1)` 为空 | executions | — | `internal` + `invariant.room_already_executed`（fail closed） |
| X3 | `executionKey = composeKey('exec', proposal._id)`；`executions.by_executionKey.eq(key).take(1)` 为空 | executions | — | `internal` + `invariant.duplicate_execution`（fail closed：守卫已通过却命中 = E1 被破坏；正常重复请求早在 S3 返回 `alreadyExecuted`） |
| X4 | `chain = computeChangeOrderChain({ entries: ruleInput.ledgerEntries, deltaCents: proposal.terms.amountCents, capCents: ruleInput.capCents })` | （已读） | — | `budget.over` 或 invariant → `internal`（X1 已通过却在此失败 = 数据不一致） |
| X5 | `plan = planExecutionRecords(proposal, chain)` | — | — | `ExecutionPlanError` → `internal` + `publicOpsLog('invariant.execution_plan', { fn: 'approvals.record' })` |
| X6 | `provenance = inheritProvenance(room.provenance, proposal.provenance, ...lines 所引用目录行的 provenance)`（03 §3.3.3）；`number = room.followsExecutionId ? 前序 changeOrders.by_execution(followsExecutionId).number + 1 : 1` | catalogItems、changeOrders | — | 前序缺失 → `internal` |
| X7 | `tx.insert('executions', { roomId, runId, proposalId, proposalVersion, executionKey, constraintsVersion: room.constraintsVersion, termsKey, approvalIds: set.approvalIds, executedByUserId: actorUserId, scenarioKey, scenarioVersion, amountCents, committedBeforeCents: chain.amountBeforeCents, committedAfterCents: chain.amountAfterCents, capCentsAtExecution: chain.capCents, provenance, executedAt: now })` | — | executions | — |
| X8 | `tx.insert('ledgerEntries', { roomId, kind: 'commit', amountCents: plan.ledgerCommit.amountCents, executionId, recordedByUserId: actorUserId, provenance, createdAt: now })` | — | ledgerEntries | — |
| X9 | `tx.insert('changeOrders', { roomId, executionId, proposalId, proposalVersion, number, terms, lines, termsKey, baselineCents, priorApprovedDeltaCents, amountBeforeCents, deltaCents, amountAfterCents, constraintsVersion, followsExecutionId?, provenance, createdAt: now })` | — | changeOrders | — |
| X10 | 对 `plan.tasks` 逐条 `tx.insert('tasks', { roomId, executionId, taskKey: \`${executionId}:${taskKeySuffix}\`, itemKey, templateIndex, title, assigneeRole, dueDate, status: 'open', provenance, createdAt: now })` | — | tasks | — |
| X11 | `setStatus(proposal: active → executed)` | — | proposals | 非法迁移 → `internal` |
| X12 | `setStatus(run: pending_approval → executed)`，`endedReason: 'executed'` | — | runs | 同上 |
| X13 | `setStatus(room: open → executed)`，同时 `tx.patch(rooms, { executionId, executedAt: now })`（03 `MUTABLE_FIELDS`）；`currentRunId` 保持指向本 run | — | rooms | 同上 |
| X14 | 防御：本房 open `humanRequests`（`by_run_status`）→ `superseded`（`pending_approval` 下应为 0 条；> 0 → `publicOpsLog('invariant.open_request_at_execution', { fn: 'approvals.record' })`，执行事务在公开 mutation 内） | humanRequests | humanRequests | — |
| X15 | `events.append(tx, [{ type: 'room_executed', payload: { proposalVersion, amountCents, taskCount, changeOrderNumber: number }, restrictedRef: { table: 'executions', id: executionId } }])`（03 §3.11 的事件名，旧别名 `execution_completed`；`amountCents` = 公开目录价之和，金额链只在渲染时按查看者连接）；`setStatus` 自带的 `proposal_status_changed` / `run_ended` 事件由 03/04 定义 | — | events | — |
| X16 | **不**调用 `constraints.bump`（A8）；**不**调用 `ctx.scheduler`、action、`fetch`、外部 SDK（G8，结构测试） | — | — | — |
| X17 | 返回 `executed{ executionId }`；`approvals.record` 返回 `{ status: 'executed', executionId, alreadyExecuted: false }` | — | — | — |

写入顺序：先 execution 拿到 id，台账、变更单、任务都引用它；execution 不回填任何反向 id（经 `by_execution` 反查），保持写后不改。执行后在途的迟到回合（理论上 `pending_approval` 期间不存在）在 `turns.complete` 的守卫 G1（`run.status === 'negotiating'`）失败 → attempt `stale`，`runs.reconcile` 对非 `negotiating` 的 run 是空操作（D07）。看门狗同理（K21）。

## 8.6.3 记录派生（首个场景，D27 主线数字）

前提：cv 2（14 §10 的编号），当前提案 v2 = 只含必需项（`sso_login` $500 + `audit_log_export` $300），finance 上限 $4,800，baseline $4,000，无此前 commit。

| 记录 | 内容 |
| --- | --- |
| `executions` | `executionKey: 'exec:<p2>'`，`constraintsVersion: 2`，`approvalIds: [customer@cv2, provider@cv2, finance@cv2]`，`amountCents: 80_000`，`committedBeforeCents: 400_000`，`committedAfterCents: 480_000`，`capCentsAtExecution: 480_000` |
| `ledgerEntries` | +1 `commit 80_000` → Σ = 400_000（baseline）+ 80_000 = 480_000；`headroomCents` 派生为 0 |
| `changeOrders` | `CO-1`：`terms { itemKeys: ['audit_log_export','sso_login'], modifiers: [], deliveryDate: '2026-11-16'（提案插入时物化，14 S8）, amountCents: 80_000 }`；`lines` 两行（50_000 / 30_000，带当时 revision 与标题）；G701 链 `400_000 → 0 → 400_000 → +80_000 → 480_000` |
| `tasks` | 由 `plannedTasks` 快照生成，例：`<exec>:sso_login:0` "Deliver SSO login"（provider，due = deliveryDate = 2026-11-16）、`<exec>:audit_log_export:0` "Deliver audit log export"（provider） |
| 状态 | v2 `executed`；run2 `executed`（`endedReason: executed`）；room `executed`（`executionId` 已写）；cv 仍为 2 |

界面固定文案："Internal record only — no payment, transfer, contract, or external system was changed."；`provenance !== 'live'` 时全部记录带 `SimulatedBadge`（D18/D19）。

## 8.6.4 执行边界（核心 7）

执行只写 `approvals`（最后一票）、`executions`、`ledgerEntries`、`changeOrders`、`tasks`、`proposals` / `runs` / `rooms`（状态与 `writeSeq` / `executionId` / `executedAt`）、`humanRequests`（防御性 supersede）、`events`。幂等只对内部记录承诺，不宣称外部 exactly-once。将来的外部集成走 outbox（17）：执行事务只追加一条 outbox 行，以 `executionKey` 作对方系统的 idempotency key / external_id，由独立 action 投递，失败不回滚执行；绝不在执行事务内调用外部系统。

## 8.6.5 执行之后

- **房间终态**：除 `tasks.markDone` 与旧房间任一成员的 `rooms.startFollowUp` 外一切写入被拒（A9；04 §4.2.2；12 §12.2 第 10 条）。审批面板与结果页对已执行提案读 `executions.approvalIds` 快照。
- **`tasks.markDone({ taskId })`**（公开 mutation，`memberMutation`，房间由 `taskId` 解析；函数名以 12 §12.16 为准，canon §1.6 已补录）：守卫：成员（`auth.not_member`）、`member.role === task.assigneeRole`（`auth.role_forbidden`，canon §1.3"只有被指派人可勾选"）、已 `done` → 返回 `{ status: 'unchanged' }`；否则经 `openRoomTx(ctx, roomId, { allow: ['executed'] })` patch `{ status: 'done', doneByUserId, doneAt }` 并写 `task_completed{ taskKey }`（03 §3.11），返回 `{ status: 'done' }`。读 tasks、members、rooms；写 rooms.writeSeq、tasks、events。v1 不支持 `done → open`。
- **后续变更**：`rooms.startFollowUp({ executionId })`（04/12 定义，D04）。08 提供：前序 `executions.committedAfterCents` 作为新房间 `ledger.recordBaseline` 的预填值（只对 finance 显示，须确认）；新房间变更单 `number` 接续（X6）。

## 8.6.6 查询与按角色投影

08 不新增公开 query，只规定以下三处由 08 的纯函数计算、按 07 投影：

1. **`rooms.view` 的当前提案卡与审批面板**（形状归 13 的 `approvalPanelV` / `recordsPreview`）：槽位逐项来自 `evaluateApprovalSet(...).slots`（`vacant` / `self_conflict` 只为防御，投影为 `pending` 并 `publicOpsLog('view.vacant_slot' | 'approval.self_conflict', { fn: 'rooms.view' })`——`rooms.view` 是公开 query，只能用闭集三键 logger）；`allApproved = set.complete`；`usedForExecution` 与已执行提案的槽位读 `executions.approvalIds`；`myAction.completesSet = (missingRoles 恰为 [我的角色])`（12 §12.17 / 13 Δ1 的字段名），界面据此显示 "Your approval completes the set — this executes now"；按钮携带 `expectedConstraintsVersion` / `expectedTermsKey`（取自同一次 `rooms.view`）。`recordsPreview` 由 `planExecutionRecords(proposal, computeChangeOrderChain(...))` 派生，再裁成 13 的字段（`commitCents = deltaCents`、`changeOrderNumber`、`taskCount`、`myTaskTitles`；字段名以 12 §12.17 为准），finance 另可见链上数字。
2. **`proposals.get` 的 `decisions`**（12 §12.17）：每行 `{ role, decision, decidedAt, boundConstraintsVersion, reasonKey, isMe, note }`；`reasonKey` 按场景 `humanReasonKeys[].audience` 裁剪（`room` 的键全员可见，`buyers` 的键如 `over_our_limit` 对 provider 为 `null`；A13、07 DX-6，12 已按此定稿）；`rooms.view` 审批槽位的 `reasonKey` 同此裁剪；`note` 只在 `isMe` 时返回；`userId` 不出 DTO。
3. **`executions.forRoom` 的 `amountChain`**（12 §12.17）与存储字段的映射：`baselineCents ← baselineCents`、`approvedToDateCents ← priorApprovedDeltaCents`、`committedBeforeCents ← amountBeforeCents`、`thisChangeCents ← deltaCents`、`committedAfterCents ← amountAfterCents`；`approvalsSnapshot` 来自 `approvalIds`。

| 字段 | customer | provider | finance |
| --- | --- | --- | --- |
| 槽位 approved / pending / withdrawn / stale_*、绑定 cv、时间（"等谁"） | 是 | 是 | 是 |
| reject 的 `role`（人的显式表态，07 DX-6） | 是 | 是 | 是 |
| reject 的 `reasonKey`（按 `humanReasonKeys[].audience`；不进任何他方代理上下文，05 §5.12；`buyers` 的键不进事件 payload） | 是 | 仅受众为 `room` 的键（`buyers` 的键如 `over_our_limit` 为 `null`） | 是 |
| `note` | 本人 | 本人 | 本人 |
| `approvals.userId` | 否（DTO 给 `isMe`） | 否 | 否 |
| 预览 / 变更单的 `terms`、`lines`、`deltaCents`、任务 | 是 | 是 | 是 |
| `baselineCents`、`priorApprovedDeltaCents`、`amountBeforeCents`、`amountAfterCents`（= committedBefore / After） | 仅当执行时生效的 `committedCents` 共享行存在（07 PV-12，不溯及既往） | 否 | 是 |
| `capCentsAtExecution` / 预览中的 cap | 同上，按 `capCents` 共享行 | 否 | 是 |
| `headroomAfterCents` | 同上，按 `headroomCents` 共享行 | 否 | 是 |
| 签字人（`approvalIds` → role、cv、时间）、`executedByUserId` 的角色 | 是 | 是 | 是 |
| `approval.not_executable` 的 `params` | 自有码或 `private.constraint_unmet` | 无 | 全部 |
| `provenance` 徽章 | 是 | 是 | 是 |

全部投影经 `projectForRole(role, dto)`（D11），派生值继承输入中最严格的披露类；矩阵由 16 的 Proxy 读取测试与金丝雀扫描对账。provider 的金额视图只剩 `deltaCents`（它自己的价格之和），对应 D12④"派生数值只给 finance"。
