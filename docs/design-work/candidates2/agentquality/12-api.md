# 12 后端函数目录

约定：公共函数都声明 `args` 与 `returns`；query 未登录 / 非成员返回 null；mutation 抛 `ConvexError({code})`；幂等列说明重复调用的效果。

## 12.1 公共 query

| 函数 | 参数 | 返回 | 鉴权 | 模块 |
| --- | --- | --- | --- | --- |
| `rooms.listMine` | — | `{roomId,title,roleKey,phase,needsMyAction}[]` | 登录 | rooms |
| `rooms.view` | roomId | `RoomViewDTO`（按角色投影：房间、成员显示名、readiness、当前 run 进度、当前提案 + displayState + 可见码、预算块（仅买方）、我的待办） | member | rooms |
| `briefs.mine` | roomId | 本角色 draft + 最新 confirmed + "房间将看到什么"预览 | member | briefs |
| `briefs.statuses` | roomId | 各角色 `{roleKey, version, confirmedAt}`（无内容） | member | briefs |
| `catalog.list` | roomId | confirmed 条目（provider 额外看到 draft） | member | catalog |
| `proposals.list` | roomId | 版本列表（terms 公开、displayState、按角色的可见码） | member | proposals |
| `runs.progress` | roomId | 当前 run：status、roundIndex、各 turn 的角色与状态（无内容） | member | runs |
| `turns.mine` | runId | 本角色 turns（decision、rationale、validation、flags、用量） | member，仅本角色 | agents |
| `humanRequests.mine` | roomId | targetRole = 本角色的 open / 历史请求（已渲染文本） | member | humanRequests |
| `events.list` | roomId, paginationOpts | 受众过滤后的渲染事件 | member | events |
| `changeOrders.get` | changeOrderId | 变更单 + 追溯链（按角色投影金额） | member | changeOrders |
| `tasks.mine` | roomId | 本人任务 | member | tasks |
| `usage.roomSummary` | roomId | 调用数、token、估算成本、p50/p95（无内容） | member | ops |

## 12.2 公共 mutation

| 函数 | 参数 | 返回 | 鉴权 | 幂等 |
| --- | --- | --- | --- | --- |
| `rooms.create` | title, goal, scenarioKey, myRoleKey, timeZone | roomId | 登录 + 允许名单 | 否（每次新房间） |
| `rooms.close` | roomId | — | owner | 是 |
| `invites.create` | roomId, roleKey | `{code}`（明文仅此一次） | owner | 旧 open 邀请被撤销 |
| `invites.revoke` | inviteId | — | owner | 是 |
| `invites.accept` | code | roomId | 登录 | 已是该房间该角色成员 → 返回 roomId |
| `briefs.saveDraft` | roomId, content, disclosures | version | 本角色 | upsert draft |
| `briefs.confirm` | roomId, draftVersion | `{constraintsVersion, bumped}` | 本角色 | 内容与上一 confirmed 相同 → 不新增 |
| `catalog.saveDraftItem` | roomId, item | — | provider | upsert draft |
| `catalog.confirm` | roomId | `{catalogRevision, bumped}` | provider | 无 draft → no-op |
| `catalog.retire` | roomId, itemKey | — | provider | 是 |
| `budgets.update` | roomId, newTotalCents, reason | 09 §9.5 | finance | 未变 → `{changed:false}` |
| `runs.start` | roomId | runId | member | 已有非终态 run → 返回它 |
| `runs.retryTurn` | runId | — | member | 非 paused → no-op |
| `runs.cancel` | runId | — | owner | 终态 → no-op |
| `decisions.submit` | proposalId, decision, reasonCode? | `{ok, executed, changeOrderId?, code?}` | member（kind 由角色推出） | 与本人最新决定相同 → 不追加 |
| `humanRequests.answer` | requestId, optionKey, disclose? | `{effectApplied}` | targetRole | 已答复 → 返回原结果 |
| `tasks.updateStatus` | taskId, status | — | assignee | 是 |

## 12.3 internal

| 函数 | 类型 | 作用 |
| --- | --- | --- |
| `agents.loadTurnContext` | internalQuery | 按 turn 读取本角色授权快照（07 §7.5） |
| `agents.beginAttempt` | internalMutation | G-T、总开关、调用上限、计数 +1 |
| `agents.runTurn` | internalAction | 10 §10.2 |
| `agents.completeTurn` | internalMutation | G-T → modelCalls → 归约 → effects |
| `agents.turnWatchdog` | internalMutation | 超时置 failed / paused |
| `seed.demoRoom` | internalMutation | 按 fixture 建房（CLI 调用） |
| `ops.checkModel` | internalAction | 部署后模型可用性自检 |
| `ops.exportUsage` | internalQuery | 运维导出（无内容字段） |

helper（非注册函数）：`bumpConstraints`、`startRunInternal`、`scheduleTurns`、`insertProposal`、`executeIfComplete`、`requireMember/requireRole`、`project*For`。
