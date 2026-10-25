# 12 后端函数目录（事件溯源候选）

## 0. 通用约定

- 公共函数以 `getViewer` / `requireMember` / `requireRole` 开头；不接受 userId、role 参数。query 未认证/非成员返回 `null`；mutation 抛 `ConvexError({code})`（码表见 06 §5）。
- 所有公共函数声明 `args` 与 `returns`；返回 DTO 已按查看者角色投影（07）。
- 所有产生事件的公共 mutation 接受 `commandId: v.string()`（客户端每次表单提交生成一个 UUID）；重复提交返回 `{duplicate: true}`，不再写事件。
- "事件"列是成功时可能追加的事件；拒绝时不写任何东西。

## 1. 查询（query）

| 函数 | 参数 | 返回 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `health.viewer` | — | `{tokenIdentifier, subject} \| null` | 已认证 | /setup 诊断与 seed 取账号 |
| `users.me` | — | `{userId, displayName} \| null` | 已认证 | — |
| `rooms.listMine` | — | `RoomCard[] \| null` | 已认证 | 经 `members.by_user` |
| `rooms.view` | `{roomId}` | `RoomViewDTO \| null` | 成员 | 聚合快照：房间、成员、readiness、目录、当前/历史提案（派生状态、按角色投影的 reasonCodes 与买方专属金额）、审批面板（effective/stale）、当前 run 与回合状态（不含输出）、open 请求（按角色裁剪选项）、我的待办、变更单与任务；内部调用 `validateProposal` |
| `timeline.page` | `{roomId, beforeSeq?: number, limit: number ≤ 100}` | `{items: TimelineItemDTO[], nextBeforeSeq: number \| null}` | 成员 | 按 seq 倒序扫描 `by_room_seq`，经 `redactEvent` + `renderEvent`；被过滤掉的事件不占 limit（多取至 3×limit） |
| `briefs.mine` | `{roomId}` | `{draft, confirmed: BriefVersionDTO[]} \| null` | 成员 | 只查本人角色 |
| `briefs.statuses` | `{roomId}` | `{role, latestVersion, confirmedAt}[]` | 成员 | 他方只见版本与时间 |
| `turns.mine` | `{roomId, runNo?}` | `TurnDTO[]` | 成员 | 只返回本角色回合（含 rationale、question、用量） |
| `audit.trace` | `{roomId, operationId}` | `TraceNodeDTO[]` | 成员 | 沿 causationSeq 与领域键反查（14 §13），每个节点经 redact |
| `audit.constraintsAt` | `{roomId, version}` | `ConstraintsSnapshotDTO` | 成员 | 折叠约束事件（09 §5），按角色投影 |
| `invites.listForOwner` | `{roomId}` | `{role, status, expiresAt}[]` | owner | 不返回令牌 |

## 2. 命令（mutation）

| 函数 | 参数 | 返回 | 鉴权 | 事件 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `users.ensure` | — | `{userId}` | 已认证 | — | 先查后插 |
| `rooms.create` | `{title, goal, scenarioKey:"scope_change", timeZone, commandId}` | `{roomId, invites: {role, token}[]}` | `ROOM_CREATORS` | room_created | commandId（房间尚不存在：按 `(ownerUserId, commandId)` 查 `rooms` 的 `by_owner` 后比对 room_created 事件） |
| `invites.reissue` | `{roomId, role}` | `{token}` | owner | — | 旧令牌 revoked |
| `invites.accept` | `{token, displayName?}` | `{roomId, role}` | 已认证 | member_joined | 已是该角色成员 → 返回现状 |
| `briefs.saveDraft` | `{roomId, content, shareableFields}` | `{updatedAt}` | 本角色 | — | 覆盖写 |
| `briefs.confirm` | `{roomId, expectedDraftUpdatedAt, commandId}` | `{version, constraintsVersion}` | 本角色 | brief_confirmed（+ 反应：run_superseded、human_request_cancelled、run_started…） | commandId；草稿已变 → `INVALID_STATE` |
| `catalog.confirmItem` | `{roomId, item, commandId}` | `{itemKey, itemVersion}` | provider | catalog_item_confirmed（+ 反应） | 内容未变 → `noop` |
| `catalog.withdrawItem` | `{roomId, itemKey, commandId}` | `{}` | provider | catalog_item_withdrawn（+ 反应） | commandId |
| `budget.update` | `{roomId, newTotalCents, reason, commandId}` | `{constraintsVersion}` | finance | budget_changed（+ 反应，09 §3） | 金额未变 → `noop` |
| `runs.start` | `{roomId, restart?: boolean, commandId}` | `{runNo}` | 成员 | run_started（restart 时先 run_superseded{manual_restart}） | 已有活动 run 且非 restart → 返回它 |
| `runs.retryTurn` | `{roomId, runNo, commandId}` | `{turnSeq, attempt}` | 成员 | run_resumed{retry} | run 非 failed → `INVALID_STATE` |
| `approvals.decide` | `{roomId, proposalVersion, decision, reasonCode?, note?, commandId}` | `{status, operationId?, blockedReasonCodes?}` | 必需审批角色 | decision_recorded（+ execution_completed / run_resumed / run_needs_input） | 08 §7 三层 |
| `requests.answer` | `{roomId, requestNo, optionKey, commandId}` | `{effect}` | targetRole | human_request_answered（+ budget_changed / brief_confirmed / proposal_created / run_ready_for_approval / run_resumed / run_superseded） | 已回答 → 返回原结果 |
| `tasks.complete` | `{roomId, taskKey, commandId}` | `{}` | provider | task_completed | 已 done → noop |
| `rooms.close` | `{roomId, reason, commandId}` | `{}` | owner | room_closed（+ run_superseded、human_request_cancelled） | 已关闭 → noop |

## 3. 内部函数

| 函数 | 类型 | 参数 | 说明 |
| --- | --- | --- | --- |
| `agents.runTurn` | internalAction | `{turnId}` | 10 §2；try/catch → completeTurn / failTurn |
| `agentsInternal.getTurnContext` | internalQuery | `{turnId}` | 守卫预检 + 白名单上下文（07 §6） |
| `agentsInternal.completeTurn` | internalMutation | `{turnId, attempt, result}` | 持久化守卫 → runCommand |
| `agentsInternal.failTurn` | internalMutation | `{turnId, attempt, errorCode, usage?}` | 10 §2 |
| `agentsInternal.turnWatchdog` | internalMutation | `{turnId, attempt}` | 超时判失败 |
| `seed.scopeChangeRoom` | internalMutation | `{fixtureKey, accounts: {role, tokenIdentifier}[]}` | 只经 CLI；走同一命令管线，simulated |
| `audit.verifyRoom` | internalMutation | `{roomId}` | 哈希链 + 子事务回放比对，返回差异 |
| `audit.replayCompare` | internalMutation | `{roomId}` | 被 verifyRoom 以 `ctx.runMutation` 调用，比较后主动抛错回滚 |
| `audit.rebuildRoom` | internalMutation | `{roomId}` | 删除投影并回放（维护操作） |
| `audit.verifyRecent` | internalMutation（cron 每日） | — | 对近 24 小时有事件的房间逐个调度 verifyRoom |
| `audit.exportRoom` | internalQuery | `{roomId}` | 管理员导出事件序列（存档回放用，15 §3）；只经 CLI |
| `metrics.summary` | internalQuery | `{sinceMs}` | 调用数、失败数、p50/p95 延迟、token、stale 次数、人工介入次数 |

## 4. 关键 DTO（节选）

```ts
type ProposalCardDTO = {
  version: number; runNo: number; authorKind: "agent" | "rule" | "human_option"; authorRole: Role;
  items: { itemKey: string; title: string; priceCents: number }[]; termsLabel?: string;
  amountCents: number; deliveryDate: string; deferredItemKeys: string[];
  derivedStatus: "executed" | "current_executable" | "current_evaluating" | "current_blocked" | "superseded";
  checkedAgainstConstraintsVersion: number; reasonCodes: ReasonCode[];   // 已按角色投影
  buyer?: { committedAfterCents: number; totalCents: number; shortfallCents?: number; headroomAfterCents?: number };
  approvals: { role: Role; kind: "terms" | "budget"; state: "pending" | "approved" | "rejected" | "stale" | "stale_reject"; atConstraintsVersion?: number }[];
  simulated: boolean;
};
```
