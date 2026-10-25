# 03 · Convex schema v1（part10）：唯一写入口目录、唯一性落点

> 分片清单见 `03-schema.md` 顶部。

## 3.13 唯一写入口目录

### 3.13.1 本章定义的数据层 helper（`convex/model/*.ts`，经写门面）

| helper（调用者） | 参数 | 守卫（顺序；失败码） | 读 | 写 |
| --- | --- | --- | --- | --- |
| `openRoomTx`（一切房间作用域 mutation） | `roomId`、`{ allow: RoomStatus[] }` | 房间存在（否则 `auth.not_member`：与 12 §12.4 一致，不区分"不存在"与"非成员"）→ `status ∈ allow`（`run.invalid_state`） | `rooms` | `rooms.writeSeq + 1` |
| `addMember`（`rooms.create`、`invites.accept` 的 internal 写入口、`rooms.startFollowUp`） | `tx`、`{ userId, role, via, inviteId? }` | `role` ∈ 场景角色（`input.invalid`）→ `by_room_role` 为空（`invite.seat_taken`，12 §12.4）→ `by_room_user` 为空（`invite.already_member`）；房间状态由调用方按 07 §7.6 / 04 §4.9 检查 | `members` 两个索引 | `members`；`member_joined`；之后调用方 `openIfReady` |
| `insertBriefVersion`（`briefs.confirm`、`budget.setCap`、`humanRequests.answer`、`briefs.updateSoft`） | `tx`、`{ role, hardFields, softFields, disclosures, source, humanRequestId?, actorUserId }` | `schemaKey` 与 `role` 一致、值规则 3.2（`input.invalid` / `date.*` / `amount.out_of_range`）→ customer：`requiredItemKeys` / `preferredItemKeys` ⊆ 本房间曾确认过的 item 键 confirmed ∪ retired（`item.unknown`；只在 draft 行出现 → `item.unconfirmed`）→ `disclosures` 键 ∈ `SHAREABLE_FIELDS[role]` 且受众合法（`input.invalid`）→ finance：`capCents >= committedCents`（`budget.below_committed`，`params.minAllowedCapCents` 只给 finance）→ 与当前版本全等则返回 `unchanged`；`source: "soft_update"`（`briefs.updateSoft`）只校验 `notes`（NFC 后 ≤ 2,000 码点，`input.invalid`），照抄字段不重验 | `briefs.by_room_role_version`、finance 时 `ledgerEntries.by_room_kind`、customer 时 `catalogItems.by_room_item` | `briefs`；`materializeDisclosures`；`brief_confirmed`（带 `actorUserId`，计节流）；外层 `withConstraintChange`（09）。`soft_update` 版本只写 `briefs` 与 `brief_soft_updated`（计 `soft_writes`），无 `materializeDisclosures`、无外层 `withConstraintChange` |
| `materializeDisclosures`（`insertBriefVersion` 之后、`ledger.recordBaseline` 之后） | `tx`、`{ role, briefVersion }` | 对每个可共享字段：新值 / 新受众与最新 `sharedFacts` 行比较，无变化跳过；每行过 07 LP-3 闸门（`disclosure.blocked`） | `sharedFacts.by_room_from_field`、当前简报、finance 时台账 | `sharedFacts`（`appendSharedFact`，`seq + 1`）；有变化时 `disclosure_changed` |
| `appendSharedFact`（上一行、`sharedFacts.add`、`humanRequests.answer(disclose)`） | `tx`、`{ fromRole, field, value, audience, briefVersion, source, humanRequestId?, createdBy }` | 字段 ∈ 词表；`audience` 不含 `fromRole` 且 ⊆ 允许受众（finance 金额字段只许 `customer`，否则 `internal`）；值类型与词表一致（`input.invalid`）；日期窗口（`date.out_of_range`）；`itemKeys` ⊆ 本房间曾确认过的 item 键 confirmed ∪ retired（`item.unknown` / `item.unconfirmed`；与 `insertBriefVersion` 同一集合） | `sharedFacts` 最新行、`catalogItems` | `sharedFacts` |
| `appendCatalogRow`（`catalog.confirm` 批量、`catalog.retire`、`rooms.startFollowUp`） | `tx`、`rows[]`（≤ 14） | 键格式 → 同键 `kind` 不变（`item.duplicate`）→ 后续房间（`followsExecutionId` 非空）里 `itemKey ∈` 旧执行 `terms.itemKeys`（已交付键不得重新上架，`item.duplicate{ itemKeys }`，12 §12.12 ④、canon D04）→ 值规则（`amount.out_of_range` / `date.out_of_range` / `input.invalid`）→ 按 3.7 契约算 `(revision, editNo)` 或 `unchanged` → 写后在架 item ≤ 12、modifier ≤ 2、在架 item 的 `taskTemplates` 条数之和 ≤ `MAX_TASKS_PER_EXECUTION`（50，08 §8.4.4；任何候选的 `plannedTasks` 因此都不超过执行上限）（`item.limit_exceeded`） | `catalogItems.by_room_item` 前缀 `eq(roomId)` | `catalogItems`；`catalog_item_confirmed` / `catalog_item_retired`；外层 `withConstraintChange(catalog_changed)` |
| `appendLedgerEntry`（`ledger.recordBaseline`、`executeIfComplete`） | `tx`、`{ kind, amountCents, executionId?, recordedByUserId }` | `assertCents` → baseline：`room.status === 'setup'` 且 `by_room_kind(roomId, 'baseline')` 为空（`run.invalid_state`），无 `executionId`；commit：必有 `executionId` 且只能由执行事务调用（结构测试） | `ledgerEntries.by_room_kind` | `ledgerEntries`；baseline 时 `baseline_recorded` + `materializeDisclosures(finance)` + `openIfReady` |
| `insertProposal`（`turns.complete`、`humanRequests.answer(choose_candidate)`） | `tx`、`{ run, origin, authorRole, candidate, sourceTurnId? / sourceRequestId?, chosenBy? }` | 候选在当前 `RuleInput` 下 `passesChecks`（调用方已判，这里断言，`internal`）→ 物化 `terms` / `lines` / `plannedTasks` → `amount.claim_mismatch` 自检（`sum(lines) === amountCents`）→ `plannedTasks.length ≤ MAX_TASKS_PER_EXECUTION`（与 08 `planExecutionRecords` 同一常量，断言，`internal`：目录写入口已保证，插入成功的提案在 `recordsPreview` 与执行时不会因任务数被拒） | `rooms.nextProposalVersion`、当前目录、`loadRuleInput` | `proposals`；`rooms.nextProposalVersion + 1`；本 run 旧 `active` → `superseded`（`setStatus`）；`runs.currentProposalId`；`proposal_created` / `proposal_status_changed` |
| `appendEvents`（全部） | 见 3.11.2 | 见 3.11.2 | — | `events` |

所有 helper 在第一个守卫失败时抛 `ConvexError({ code, params })` 且此前没有任何写入（12 §12.2 第 4 条）；`unchanged` 是成功返回值，不写行、不写事件、不计节流。

### 3.13.2 他章拥有的写入口（本章只登记"表 → 唯一写者"，供 CI grep 白名单）

| 表 | 插入 | 可变字段的写者 |
| --- | --- | --- |
| `users` | `users.ensureViewer` | 同左 |
| `rooms` | `rooms.create`、`rooms.startFollowUp`（新房间） | `openRoomTx`（writeSeq）、`setStatus`（04）、`constraints.bump`（cv）、`clock.rollLocalDate` 与其事务 helper `rollLocalDateTx`（localDate；后者由 `turns.complete` 在 G1–G3 之前、`humanRequests.answer(choose_candidate)` 在物化前同事务调用，09 §9.6.7、10 §10.7.2 步骤 2b）、`insertProposal`、`startRunTx`（currentRunId / nextRunNo）、`executeIfComplete`（executionId / executedAt） |
| `invites` | `invites.create`、`invites.insertLink` | `invites.accept`（及链接形态 internal 入口）、`invites.create`（置 `superseded`） |
| `runs` | `startRunTx`（04） | `setStatus`、`advanceRun`、`turns.beginAttempt`（attemptCount / reserved）、`turns.complete / fail` / `agents.watchdog`（结算、lastFailure） |
| `turns` | `createTurnTx`（04） | `setStatus`、`turns.beginAttempt`（currentAttemptNo / waitingReason / beginFnId）、`turns.complete`（result / outcome） |
| `attempts` | `turns.beginAttempt` | `turns.complete / fail`、`agents.watchdog`（重登记、超时） |
| `rawOutputs` | `turns.complete / fail` | 无（`ops.purgeRawOutputs` 删除） |
| `approvals` | `approvals.record`（08） | 无 |
| `humanRequests` | `openHumanRequestTx`（04） | `humanRequests.answer`、`runs.retryTurn`、`humanRequests.expireDue`、`constraints.bump` / `runs.*` / `rooms.close`（superseded） |
| `constraintRevisions` | `constraints.bump`（09） | 无 |
| `executions` / `changeOrders` / `tasks` | `executions.executeIfComplete`（08） | `tasks`：`tasks.markDone`（12 定名） |
| `opsFlags` / `spendCounters` | `ops.setDraining`（首次 upsert） / `turns.beginAttempt` | 同左 / `turns.complete / fail`、`agents.watchdog` |

## 3.14 唯一性落点（Convex 没有唯一约束）

| 逻辑唯一键 | 索引 | 唯一写入口 | 机制 |
| --- | --- | --- | --- |
| `users.tokenIdentifier` | `by_tokenIdentifier` | `users.ensureViewer` | 先查后插；并发首登依赖区间读冲突（V3）；重复行 → `.unique()` 失败关闭 + `ops.auditUsers` |
| 成员 `(roomId, role)`、`(roomId, userId)` | `by_room_role`、`by_room_user` | `addMember` | 先查后写 + 房间写锁 |
| 每 `(roomId, role)` 至多一个 open 邀请 | `invites.by_room_role` | `invites.create` / `invites.insertLink` | 插入前把同键 open 行置 `superseded` + 房间写锁 |
| `invites.tokenHash` | `by_tokenHash` | `invites.insertLink` | 32 字节随机数的哈希，碰撞可忽略；接受时 `take(2)`，多于一行 → `invite.invalid` |
| 简报 `(roomId, role, version)` 连续 | `by_room_role_version` | `insertBriefVersion` | 读当前最大版本 + 1 + 房间写锁 |
| `sharedFacts (roomId, fromRole, field, seq)` | `by_room_from_field` | `appendSharedFact` | 同上 |
| 目录 `(roomId, itemKey, revision, editNo)` | `by_room_item` | `appendCatalogRow` | 读当前行 + 房间写锁 |
| 每房间恰一条 baseline；每执行恰一条 commit | `ledgerEntries.by_room_kind` | `appendLedgerEntry` | setup 守卫 + 先查；commit 只在执行事务 |
| `constraintRevisions (roomId, version)` 连续 | `by_room_version` | `constraints.bump` | `version = room.constraintsVersion + 1`，同事务 patch rooms |
| 每房间至多一个非终态 run；`(roomId, runNo)` | `rooms.currentRunId`、`runs.by_room_runNo` | `startRunTx` | 读写 rooms（写锁） |
| 每个 execution 至多一个后续房间 | `rooms.by_followsExecutionId` | `rooms.startFollowUp` | 先查后插 + 旧房间 `openRoomTx({ allow: ['executed'] })` 写 `writeSeq` 串行（双击 / 并发只建一个；串行见 SC-T19，并发见 SC-T10；16 尚无对应用例编号，见 3.20 Q14） |
| `(runId, turnSeq)`；每 run 至多一个非终态 turn | `turns.by_run_turnSeq` | `createTurnTx` | `turnSeq = run.nextTurnSeq` + 断言无非终态行 |
| `(turnId, attemptNo)`；每 turn 至多一个 running attempt | `attempts.by_turn` | `turns.beginAttempt` | `attemptNo = currentAttemptNo + 1` + 写 turn |
| 提案 `(roomId, version)` | `proposals.by_room_version` | `insertProposal` | 读写 `rooms.nextProposalVersion` |
| `(proposalId, userId, seq)` | `approvals.by_proposal_user` | `approvals.record` | 读本提案整区间取本人最大 seq + 1 + 写锁 |
| 每 run 至多一个 open 请求 | `humanRequests.by_run_status` | `openHumanRequestTx` | 先查 `(runId, 'open')` + 写锁 |
| `executionKey`；每提案、每房间至多一次执行 | `by_executionKey`、`by_proposal`、`by_room` | `executeIfComplete` | 状态守卫为主，三个索引查重为辅，命中 fail closed |
| 每执行恰一张变更单 | `changeOrders.by_execution` | 同上 | 同事务插入，无其他写路径 |
| `tasks.taskKey` | `by_taskKey` | 同上 | 由 executionId 唯一与 plannedTasks 内唯一推出，对账复核 |
| `events (roomId, commitTs, seq)` | `by_room_order` | `appendEvents` | 同事务 `seq` 从 0 递增；不同事务 `commitTs` 是否必然不同待验证（techstack O4），房间写锁使同房间事务串行，冲突面只剩跨房间（键含 roomId，不影响） |
| `opsFlags` 单行；`spendCounters (scope, day)` | `by_key`、`by_scope_day` | `ops.setDraining`、`turns.beginAttempt` | 先查后插（全局行，依赖区间读冲突） |

所有 seed / 迁移脚本走同一入口，禁止 `t.run` 直插（spikes §1：直插重复行会让该键之后的 `.unique()` 永久失败关闭）。上表"机制"列里依赖 OCC 的条目全部进入 16 的真实部署并发套件（spikes §8 #1），convex-test 的结果只能标 `[serial]`。
