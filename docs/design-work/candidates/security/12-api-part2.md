# 12 后端函数目录（part2：public mutation / action、internal 函数）

## 12.4 public mutation 与 action

| 函数 | 类型 | 参数 | 返回 | 鉴权 / 守卫 | 幂等性 | 读写的表 |
| --- | --- | --- | --- | --- | --- | --- |
| `users.ensureMe` | mutation | `{ displayName? }` | `{ userId }` | 已认证 | 天然幂等（按 `by_tokenIdentifier` upsert） | users |
| `rooms.create` | mutation | `{ title, goal, scenarioKey, timeZone, myRoleKey }` | `{ roomId }` | 建房资格 | 非幂等（每次一个房间）；每用户每日上限 | rooms、participants、events |
| `rooms.close` | mutation | `{ roomId }` | `null` | 房主；未关闭 | 守卫幂等 | rooms、runs、humanRequests、roomInvites、events |
| `invites.issue` | action → `internal.invites.store` | `{ roomId, roleKey }` | `{ token, expiresAt }` | 房主；席位 open | 非幂等（每次新令牌，旧的自动撤销） | roomInvites |
| `invites.accept` | mutation | `{ token }` | `{ roomId }` | 已认证；07 §7.7 | 守卫幂等（已接受的令牌 → `INVITE_INVALID`） | roomInvites、participants、events；末尾 `activateRoomIfReady` |
| `invites.revoke` | mutation | `{ inviteId }` | `null` | 房主；`open` | 守卫幂等 | roomInvites |
| `briefs.saveDraft` | mutation | `{ roomId, content, notes, disclosures, catalogDraft?, baseVersion }` | `{ updatedAt }` | 本人席位；未关闭 | 天然幂等（覆盖草稿） | briefDrafts |
| `briefs.confirmExtractedField` | mutation | `{ roomId, fieldKey }` | `null` | 本人 | 天然幂等 | briefDrafts |
| `briefs.confirm` | mutation | `{ roomId, changeReason?, inherentDisclosuresAck: true }` | `{ version, hardChanged, constraintsVersion }` | 本人；04 B1 | 守卫幂等（相同内容 → `NO_CHANGES`） | briefVersions、constraintSnapshots、rooms、runs、humanRequests、events；可能调度回合 |
| `briefs.extractDraft` | action | `{ roomId, text }` | `{ filledFieldKeys }` | 本人；每日上限 | 非幂等（每次一次模型调用） | 经 internal：counters、briefDrafts、modelCalls |
| `catalog.publish` | mutation | `{ roomId, expectedVersion }` | `{ version, constraintsVersion }` | `catalog.publish`；每日 ≤ 5 次；草稿中无未确认的抽取字段 | 守卫幂等（`expectedVersion` 不等于当前最大版本 → `STALE_DRAFT`） | catalogVersions、constraintSnapshots、rooms、runs、events |
| `budget.update` | mutation | `{ roomId, newCapCents, reason }` | `{ constraintsVersion, nextRunStatus }` | `budget.update`；09 §9.5 | 守卫幂等（相同值 → `NO_CHANGES`） | 同 `briefs.confirm` |
| `decisions.decide` | mutation | `{ proposalId, kind, expectedConstraintsVersion, reasonCode?, note? }` | `{ status: "recorded", decisionId } \| { status: "executed", changeOrderId, duplicate }` | `decision.make`；04 §4.9 | 守卫幂等（执行后重复调用返回同一变更单） | decisions、events；最后一票：changeOrders、commitments、tasks、runs、constraintSnapshots、rooms |
| `requests.answer` | mutation | `{ requestId, optionKey, note? }` | `{ outcome: "proposal_created" \| "constraints_changed" \| "recorded" }` | 目标席位；04 H2 | 守卫幂等（已回答 → `REQUEST_CLOSED`） | humanRequests、proposals、briefVersions、runs、events |
| `runs.retry` | mutation | `{ roomId }` | `null` | `run.retry`；04 R8 | 守卫幂等（非 failed → `RUN_NOT_RETRYABLE`） | runs、agentTurns |
| `runs.requestRenegotiation` | mutation | `{ roomId }` | `{ runSeq }` | `run.renegotiate`；run 不在 `running`；每用户每日 5 次 | 非幂等，受限流 | runs、agentTurns、humanRequests、events、counters |
| `tasks.updateStatus` | mutation | `{ taskId, status }` | `null` | 调用者是 `assigneeParticipantId`（`task.update` 能力） | 天然幂等 | tasks、events |

注：
- `invites.issue` 是 action，因为令牌需要真随机数（mutation 中的随机数语义待验证，V-6）。action 用 `ctx.auth` 取身份，把 `actorTokenIdentifier` 传给 internal mutation，后者独立完成全部鉴权与写入；action 本身不做任何授权判断。客户端调用 action 在断线时会失败且不重发（inputs/04 §1.4），房主重试即可。
- `briefs.extractDraft` 同理：额度预占与结果写入都在 internal mutation 中鉴权。
- 没有"执行"入口、没有"代理建议"入口、没有"设置必需审批人"入口、没有"读他人简报"入口——这些能力在 API 层不存在，而不是"存在但被拒绝"。

## 12.5 internal 函数

| 函数 | 类型 | 调用者 | 职责 |
| --- | --- | --- | --- |
| `invites.store` | internalMutation | `invites.issue` | 复核房主与席位，撤销旧邀请，存哈希 |
| `briefs.reserveExtraction` / `briefs.applyExtraction` | internalMutation | `briefs.extractDraft` | 鉴权 + 限额；写草稿与 `extractedFieldKeys` |
| `agentRuntime.runTurn` | internalAction | 调度器 | 10 §10.2 |
| `agentRuntime.beginTurn` | internalMutation | `runTurn` | 回合守卫、冻结候选、返回上下文 |
| `agentRuntime.completeTurn` | internalMutation | `runTurn` | 守卫、写结果、推进轮次 |
| `agentRuntime.failTurn` | internalMutation | `runTurn` | 记录失败、重试或 run → failed |
| `agentRuntime.turnWatchdog` | internalMutation | 调度器 | 超时处理 |
| `requests.expire` | internalMutation | 调度器 | 披露请求过期 |
| `admin.seedFixture` | internalMutation | CLI（`npx convex run admin:seedFixture '{…}'`） | `{ fixtureKey, accounts: { customer, provider, finance } }`（tokenIdentifier，账号须已 `ensureMe`）；走生产写入路径到激活点 |
| `admin.setCanCreateRooms` | internalMutation | CLI | 建房白名单 |
| `admin.purgeRoom` | internalMutation | CLI | 仅 `ALLOW_PURGE=1` 且（`isSimulated` 或两人复核标记）；删除该房间全部表行 |
| `admin.metrics` | internalQuery | CLI / 运维面板（服务端） | 10 §10.11 的指标；不返回任何内容字段 |

共享 helper（不是 Convex 函数，只在 mutation 内调用）：`startRun`、`scheduleTurn`、`resolveRound`、`openRequests`、`bumpConstraints`、`activateRoomIfReady`、`writeBriefVersion`、`writeCatalogVersion`、`insertProposal`、`executeInTx`、`appendEvent`、`bumpCounter`、`buildRoleView`、`buildAgentContext`、`loadConstraintInput`。每个"单一写入口"都在这里，03 §3.13 列出了它们守护的唯一性。

## 12.6 前端调用矩阵（摘要）

| 页面 | 订阅的 query | 调用的 mutation/action |
| --- | --- | --- |
| `/rooms` | `rooms.listMine`、`users.me` | `rooms.create`、`users.ensureMe` |
| `/invite/[token]` | `invites.peek` | `invites.accept` |
| `/rooms/[id]` 工作台 | `rooms.view`、`agents.myNotes`、`events.list` | `decisions.decide`、`requests.answer`、`runs.retry`、`runs.requestRenegotiation`、`budget.update` |
| `/rooms/[id]/brief` | `briefs.myDraft`、`briefs.myVersions`、`briefs.disclosurePreview`、`rooms.view` | `briefs.saveDraft`、`briefs.confirmExtractedField`、`briefs.confirm`、`briefs.extractDraft`、`catalog.publish` |
| `/rooms/[id]/results` | `results.view`、`decisions.history`、`budget.myLedger`（finance） | `tasks.updateStatus` |
| `/rooms/[id]/settings`（房主） | `invites.listForRoom` | `invites.issue`、`invites.revoke`、`rooms.close` |
| `/setup`（仅开发/管理员） | `health.viewer` | — |
