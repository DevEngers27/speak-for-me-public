# 12 后端函数目录

> 约定：public 函数都声明 `args` 与 `returns`；query 未认证返回 null，mutation 抛 `ConvexError({code})`。"幂等"列说明重复调用的结果。所有金额参数经 `assertCents`，日期经 `assertIsoDate`。

## 1. 身份、房间、邀请

| 函数 | 类型 | 参数 | 返回 | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `users.ensure` | mutation | `{ displayName? }` | `Id<"users">` | 登录 | by_tokenIdentifier 先查后插 |
| `rooms.create` | mutation | `{ title, goal, timeZone, scenarioKey }` | `{ roomId }` | 允许名单 | 否（每次新房间）；同事务建 budgets、owner member |
| `rooms.listMine` | query | `{}` | 房间摘要[]（无金额） | 登录 | — |
| `rooms.view` | query | `{ roomId }` | `RoomView`（07 §4 投影） | member | — |
| `rooms.close` | mutation | `{ roomId }` | `null` | owner | 已 closed 返回 null |
| `invites.create` | mutation | `{ roomId, role }` | `{ inviteUrl }`（明文仅此一次） | owner | 否；同角色旧邀请 → revoked |
| `invites.accept` | mutation | `{ token }` | `{ roomId, role }` | 登录 | 已是该房成员且同角色 → 返回同结果 |
| `invites.revoke` | mutation | `{ inviteId }` | `null` | owner | 是 |

## 2. 简报与目录

| 函数 | 类型 | 参数 | 返回 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `briefs.mine` | query | `{ roomId }` | 草稿 + 最新确认版本 | member | 只读本人 |
| `briefs.saveDraft` | mutation | `{ roomId, fields, shareableFields }` | `null` | member，fields.kind = 本人角色 | 覆盖草稿 |
| `briefs.confirm` | mutation | `{ roomId, expectedDraftUpdatedAt }` | `{ version, bumped }` | member | 插 briefVersions；hardKey 变化才 bump + afterConstraintChange |
| `catalog.list` | query | `{ roomId }` | 当前修订[] | member | 价格对全员可见 |
| `catalog.saveItem` | mutation | `{ roomId, itemKey, kind, title, priceCents, leadTimeDays?, rushLeadTimeDays?, validUntil?, taskTitle? }` | `{ revision }` | provider | 新修订 + bump；有 validUntil 则 runAt 到期 |
| `catalog.retireItem` | mutation | `{ roomId, itemKey }` | `{ revision }` | provider | 已 retired → 返回同值 |
| `catalog.expireItem` | internalMutation | `{ catalogItemId }` | `null` | — | 不是当前修订则 no-op |

## 3. 账务

| 函数 | 类型 | 参数 | 返回 | 鉴权 | 幂等 / 守卫 |
| --- | --- | --- | --- | --- | --- |
| `budget.setLimit` | mutation | `{ roomId, newLimitCents, reasonCode, note, expectedRevision }` | `{ revision, constraintsVersion }` | finance | expectedRevision 防重放；NO_CHANGE / BUDGET_BELOW_COMMITTED |
| `budget.recordOpeningBalance` | mutation | `{ roomId, amountCents, note }` | `{ seq }` | finance，setup | by_operationKey `open:{budgetId}` 已存在 → OPENING_EXISTS |
| `budget.declareNoOpeningBalance` | mutation | `{ roomId }` | `null` | finance，setup | 已声明 → no-op |
| `budget.ledger` | query | `{ roomId }` | 08 §9 | customer, finance | — |
| `budget.reconcile` | query | `{ roomId }` | `{ ok, findings }` | finance | — |
| `budget.reconcileInternal` | internalQuery | `{ roomId }` | 同上 | — | 测试与运维 |

## 4. 协商

| 函数 | 类型 | 参数 | 返回 | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `runs.start` | mutation | `{ roomId }` | `{ runId }` | member | 已有活动 run → 返回它 |
| `runs.requestRenegotiation` | mutation | `{ roomId }` | `{ runId }` | member | 仅当 run 为 pending_approval/needs_input/confirmed；活动 run → superseded（不 bump） |
| `runs.retryTurn` | mutation | `{ roomId }` | `{ turnId }` | member | 只重试当前 failed 回合；非 failed → 返回 null |
| `turns.mine` | query | `{ roomId, runId? }` | 本角色回合（含 rationale、usage） | member | — |
| `agents.runTurn` | internalAction | `{ turnId }` | `null` | — | at-most-once；结果经 completeTurn 守卫 |
| `agents.completeTurn` | internalMutation | `{ turnId, output?, usage, stopReason, requestId?, latencyMs }` | `null` | — | 回合非 running → no-op（stale 记录） |
| `agents.failTurn` | internalMutation | `{ turnId, errorCode, usage? }` | `null` | — | 同上 |
| `agents.turnWatchdog` | internalMutation | `{ turnId }` | `null` | — | 非 running → no-op |
| `agents.context.build` | internalQuery | `{ turnId }` | `AgentContext`（白名单） | — | — |

## 5. 签字、请求、执行结果

| 函数 | 类型 | 参数 | 返回 | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- | --- |
| `decisions.approve` | mutation | `{ proposalId, expectedContentKey }` | `{ status: "recorded"|"already_approved"|"executed", changeOrderId?, missing? }` | 必需签字角色 | 08 §4 |
| `decisions.reject` | mutation | `{ proposalId, reasonCode, note?, noteShared }` | `{ runStatus }` | member | 最新已是同 cv reject → 返回当前状态 |
| `decisions.withdraw` | mutation | `{ proposalId }` | `null` | member | 最新非 approve → no-op |
| `requests.mine` | query | `{ roomId }` | 本角色为 target 的请求（含选项数值）+ 他方请求摘要 | member | — |
| `requests.answer` | mutation | `{ requestId, optionKey?, answerText? }` | `{ outcome }` | targetRole | 已 answered → 返回原 outcome |
| `changeOrders.list` / `get` | query | `{ roomId }` / `{ changeOrderId }` | 08 §11 投影 | member | — |
| `tasks.updateStatus` | mutation | `{ taskId, status }` | `null` | provider | 同状态 → no-op |
| `events.list` | query | `{ roomId, paginationOpts }` | 按受众过滤、读时渲染 | member | — |
| `seed.demoRoom` | internalMutation | `{ fixtureKey, userIds? }` | `{ roomId, inviteUrls }` | CLI | 否 |

## 6. 错误码（`ConvexError.data.code`）

NOT_AUTHENTICATED, NOT_MEMBER, ROLE_FORBIDDEN, NOT_OWNER, INVITE_INVALID, ROLE_TAKEN, ALREADY_MEMBER, ROOM_NOT_READY, ROOM_CLOSED, INVALID_TRANSITION, RUN_NOT_PENDING, STALE_PROPOSAL, CONTENT_MISMATCH, NOT_EXECUTABLE（附 projectedCode）, AMOUNT_OUT_OF_RANGE, INVALID_DATE, NOTE_REQUIRED, REVISION_CONFLICT, NO_CHANGE, REASON_MISMATCH, BUDGET_BELOW_COMMITTED, OPENING_EXISTS, OPENING_EXCEEDS_LIMIT, REQUEST_CLOSED, CALL_LIMIT_REACHED, AGENTS_DISABLED。
