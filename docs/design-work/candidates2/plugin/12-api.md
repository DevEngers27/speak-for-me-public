# 12 后端函数目录

通用约定：公共函数以 `getViewer/requireParticipant` 开头；不接受代表身份的 userId/roleKey；错误 `ConvexError({code})`；所有公共函数声明 `args` 与 `returns`。"幂等"列说明重复调用的结果。

## 1. 公共 query

| 函数 | 参数 | 返回 | 鉴权 | 备注 |
| --- | --- | --- | --- | --- |
| `users.me` | — | `{displayName} \| null` | 登录 | 未认证 null |
| `rooms.listMine` | — | `[{roomId,title,roleKey,status,needsMe:boolean}]` | 登录 | by_user |
| `rooms.view` | `{roomId}` | `RoomView`（引擎固定部分 + `scenario: plugin.viewValidator`） | 成员 | 唯一房间读模型；实时 `evaluate`；按 viewer 投影；含 `todo[]`（"Decisions needed from you"） |
| `briefs.mine` | `{roomId}` | 我的 draft 与最新 confirmed | 成员 | 只按 (roomId, 我的 roleKey) |
| `briefs.disclosurePreview` | `{roomId}` | 他方将看到的我的字段 | 成员 | 由同一投影函数生成 |
| `catalog.drafts` | `{roomId}` | 我作者的未确认条目 | catalog author | — |
| `turns.mine` | `{roomId, runId?}` | 本角色回合：状态、rationale、用量 | 成员 | 不返回他方回合内容 |
| `events.list` | `{roomId, cursor?}` | 分页、按 audience 过滤 | 成员 | `by_room_commit` desc |
| `ledger.myView` | `{roomId}` | 账户 cap/committed/变化历史 | account.visibleTo；变化历史仅 owner | — |
| `outcome.view` | `{roomId}` | 执行、按受众过滤的文档、任务 | 成员 | — |
| `health.viewer` | — | `{tokenIdentifier} \| null` | 登录 | `/setup` 诊断与 seed 取 ID |

## 2. 公共 mutation

| 函数 | 参数 | 鉴权 | 幂等 / 唯一性 | 主要写入 |
| --- | --- | --- | --- | --- |
| `users.ensure` | `{displayName?}` | 登录 | by_token 先查后插 | users |
| `rooms.create` | `{scenarioKey, title, goal, timeZone}` | ROOM_CREATORS | 非幂等（每次新房） | rooms、ledgerAccounts、invites；返回各角色邀请明文一次 |
| `rooms.close` | `{roomId}` | 创建者 | 已关闭则 no-op | room、run superseded |
| `invites.accept` | `{token}` | 登录 | 已是该席位 → 返回同一 participant | participants |
| `invites.rotate` | `{roomId, roleKey}` | 创建者 | — | invites |
| `briefs.saveDraft` | `{roomId, payload, disclosedFields}` | 成员（自己的角色） | 覆盖草稿 | briefDrafts |
| `briefs.confirm` | `{roomId, expectedDraftUpdatedAt}` | 同上 | 乐观并发：草稿已变 → `DRAFT_CHANGED` | briefVersions；可能 bump |
| `catalog.upsertDraft` | `{roomId, entryKey, payload}` | author | 同 entryKey 的未确认修订覆盖 | catalogEntries |
| `catalog.confirm` / `catalog.retire` | `{roomId, entryKey}` | author | 已是该状态 → no-op | 新修订；bump |
| `ledger.updateCap` | `{roomId, accountKey, newCapCents, reason}` | owner | 相同值 → `NO_CHANGE` | 09 §4 |
| `ledger.addExternalEntry` | `{roomId, accountKey, amountCents, label}` | owner | 非幂等（每次一条） | ledgerEntries；bump |
| `runs.start` | `{roomId}` | 成员 | 已有非终态 run → 返回它 | runs、turns |
| `runs.retryTurn` | `{roomId}` | 成员 | 只针对 currentRun 的 failed 回合；非 failed → no-op | turns |
| `runs.requestRenegotiation` | `{roomId, reasonCode}` | 成员 | 非 pending_approval → `INVALID_STATE` | R10 + R1 |
| `decisions.decide` | `{proposalId, decision, reasonCode?, note?}` | 必需审批角色 | 集合判定 + 状态守卫 + operationId | 08 |
| `requests.answer` | `{requestId, optionKey}` | targetRole | 已 answered → 返回原结果 | 05 §6 |
| `tasks.setStatus` | `{taskId, status}` | assigneeRole | 同值 no-op | tasks |

## 3. internal

| 函数 | 类型 | 职责 |
| --- | --- | --- |
| `agentTurns.run` | action | 10 §2 |
| `agentContext.build` | query | 白名单上下文（07 §6） |
| `turns.complete` / `turns.fail` / `turns.watchdog` | mutation | 回合守卫、推进、重排 |
| `seed.createFromFixture` | mutation | `{scenarioKey, fixtureKey, ownerTokenIdentifier}`；只经 CLI |
| `ops.metrics` | query | 调用次数、失败率、p50/p95、token、stale 次数 |

helper（非注册函数）：`buildSnapshot`、`bumpConstraints`、`startRunInternal`、`supersedeRun`、`scheduleTurn`、`insertProposal`、`executeIfComplete`、`writeEvent`、`assertCents`。
