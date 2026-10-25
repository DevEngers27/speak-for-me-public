# 12 后端函数目录 · part1：约定、公共 query、公共 mutation

## 1. 通用约定

- 每个公共函数声明 `args` 与 `returns` validator；`returns` 只引用投影 DTO（07 §6）。
- 业务函数不接受"我是谁"参数（ID-1）；第一行是 `requireViewer` 或 `requireParticipant`。query 未认证或无权时返回 `null`（不泄露房间是否存在）；mutation 抛 `ConvexError({ code })`。
- 所有改变房间状态的 mutation：守卫 → 写入 → `emitEvent`（patch rooms，M-ROOM）→ 返回结构化结果。
- 幂等性标注：**天然幂等**（重复调用无副作用）、**业务幂等**（重复调用返回 unchanged 或已有结果）、**非幂等但有守卫**（第二次被状态守卫拒绝）。
- 模块即文件：`convex/users.ts`、`rooms.ts`、`invites.ts`、`briefs.ts`、`runs.ts`、`decisions.ts`、`requests.ts`、`tasks.ts`、`events.ts`、`executions.ts`、`turns.ts`、`usage.ts`、`health.ts`。

## 2. 公共 query

| 函数 | args | returns | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `users.me` | `{}` | `{ userId, displayName } \| null` | 登录 | — |
| `health.viewer` | `{}` | `{ tokenIdentifier, subject } \| null` | 登录 | 只返回本人身份；/setup 诊断与 seed 取账号 id 用（F13.4） |
| `rooms.listMine` | `{}` | `RoomCardDTO[] \| null` | 登录 | `by_userId` 取本人席位；卡片含 phase、"轮到你"待办数、isSimulated；不含任何预算数字 |
| `rooms.workspace` | `{ roomId }` | `WorkspaceDTO \| null` | 参与方 | 聚合快照（part2 §6）；内部对当前与历史提案实时调用 `evaluateProposal` 并投影 |
| `briefs.mine` | `{ roomId }` | `MyBriefDTO \| null` | 参与方（只本人） | 草稿、全部确认版本（含 changeReason）、"他方能看到什么"预览（由投影函数以他方角色身份生成） |
| `briefs.previewConfirm` | `{ roomId }` | `{ ruleFieldsChanged, invalidatesCurrentApprovals, issues } \| null` | 本人 | 确认前提示（09 §3） |
| `events.list` | `{ roomId, paginationOpts }` | 分页 `EventDTO[]` | 参与方 | 两路索引（room、本人 participant）按 seq 合并；payload 已投影，客户端用模板渲染 |
| `turns.mine` | `{ roomId, runId? }` | `MyTurnDTO[] \| null` | 参与方 | 只返回 `roleKey = 我的角色` 的回合，含 rationale 与动作 |
| `executions.get` | `{ roomId, number }` | `ExecutionDTO \| null` | 参与方 | 变更单详情；budgetSnapshot 按派生闭包投影 |
| `requests.mine` | `{ roomId }` | `RequestDTO[] \| null` | 参与方 | 本人为目标的 open 请求（问题、选项、效果预览） |
| `invites.listForRoom` | `{ roomId }` | `{ roleKey, status, expiresAt }[] \| null` | 房主 | 永不返回 token 或哈希 |
| `usage.room` | `{ roomId }` | `{ calls, budget, estimatedCostUsd, mine: CallDTO[] } \| null` | 参与方 | 合计全员可见（P12），明细只本角色 |

## 3. 公共 mutation

| 函数 | args | returns | 鉴权 | 幂等性 | 守住 | 主要错误码 |
| --- | --- | --- | --- | --- | --- | --- |
| `users.ensure` | `{}` | `Id<"users">` | 登录 | 天然幂等 | ID-2 | UNAUTHENTICATED |
| `users.setDisplayName` | `{ displayName }` | `null` | 登录 | 天然幂等 | — | INVALID_NAME |
| `rooms.create` | `{ title, goal, timeZone, ownerRole }` | `{ roomId }` | 登录 + 创建策略 | 非幂等（每次一个房间）；客户端按钮防抖 | ID-3、VAL-3 | CREATION_NOT_ALLOWED、ROOM_LIMIT_REACHED、INVALID_TIMEZONE |
| `rooms.rename` | `{ roomId, title?, goal? }` | `null` | 房主 | 天然幂等 | ID-7 | NOT_ROOM_OWNER、ROOM_CLOSED |
| `rooms.close` | `{ roomId }` | `null` | 房主 | 业务幂等（已关闭返回） | RN-1、CS-6 | NOT_ROOM_OWNER |
| `invites.revoke` | `{ roomId, roleKey }` | `null` | 房主 | 天然幂等 | ID-6 | NOT_ROOM_OWNER |
| `briefs.saveDraft` | `{ roomId, content, disclosures, acknowledgements, baseVersionNo }` | `{ issues }` | 本人 | 天然幂等（覆盖草稿） | BR-2 | ROOM_CLOSED |
| `briefs.confirm` | `{ roomId, baseVersionNo, changeReason?, changeReasonShared? }` | `{ status: "confirmed" \| "unchanged", versionNo, constraintsVersion }` | 本人 | 业务幂等（内容未变返回 unchanged） | BR-1、BR-5、CS-1–CS-6、EX-5 | BRIEF_VERSION_CONFLICT、INVALID_BRIEF、BUDGET_BELOW_COMMITTED |
| `briefs.updateBudgetCap` | `{ roomId, newCapCents, reason?, reasonShared, baseVersionNo }` | 同上 | finance | 业务幂等 | 同上 | FORBIDDEN_ROLE、BUDGET_BELOW_COMMITTED |
| `runs.start` | `{ roomId }` | `{ runId, status }` | 参与方 | 业务幂等（已有活动 run 时返回它） | RN-1、RN-5、SIM-2 | ROOM_NOT_READY、RUN_COOLDOWN |
| `runs.requestRenegotiation` | `{ roomId, reasonCode }` | `{ runId, status }` | 参与方 | 非幂等但有守卫（冷却 10 秒） | RN-1、RN-2 | NO_ACTIVE_RUN、RUN_COOLDOWN、INVALID_REASON |
| `runs.retry` | `{ roomId }` | `{ runId, status }` | 参与方 | 业务幂等（run 不在 failed 时返回当前状态） | RN-2、RN-5 | AGENTS_DISABLED、CALL_BUDGET_EXHAUSTED |
| `decisions.record` | `{ proposalId, kind, reasonCode?, note?, notePublic? }` | `{ status: "recorded" \| "unchanged" \| "executed", executionId? }` | 必需审批角色 | 业务幂等（DE-5、EX-1） | DE-1–DE-5、EX-1–EX-6 | PROPOSAL_NOT_CURRENT、NOT_REQUIRED_APPROVER、NOT_EXECUTABLE、NOTHING_TO_WITHDRAW、INVALID_REASON |
| `requests.answer` | `{ requestId, optionKey }` | `{ status, effect }` | 请求目标 | 业务幂等（已关闭返回其最终状态） | HR-2、HR-3、CS-3 | NOT_REQUEST_TARGET、REQUEST_NOT_OPEN、REQUEST_STALE、OPTION_NOT_ANSWERABLE（revise_offer）、OPTION_NO_LONGER_FEASIBLE |
| `tasks.setStatus` | `{ taskId, status }` | `null` | 被指派角色 | 天然幂等 | 04 §6 迁移表 | NOT_TASK_ASSIGNEE、INVALID_TRANSITION |

### 3.1 关键 mutation 的内部步骤索引

| 函数 | 步骤所在 |
| --- | --- |
| `briefs.confirm`、`briefs.updateBudgetCap` | 09 part1 §3（`commitBriefVersion`）、§4（`bumpConstraints`）、09 part2 §5 |
| `runs.start` | 04 part1 §3.2 R-0a/b/c |
| `decisions.record` | 08 part1 §3–§4 |
| `requests.answer` | 04 part2 §5 H-1/H-2；05 part2 §4 选项效果 |
| `rooms.close` | 04 part1 §2.1 RM-2 |

### 3.2 `requests.answer` 的步骤

1. 读请求；`requireParticipant(ctx, request.roomId, { open: true })`；调用者是 `targetParticipantId`（HR-2）。
2. `status = open` 且 `request.constraintsVersion = room.constraintsVersion`，否则 `REQUEST_NOT_OPEN` / `REQUEST_STALE`。
3. 按 optionKey 取选项：`revise_offer` → `OPTION_NOT_ANSWERABLE`（导航型）；`choose_package` → 物化并评估，失败 → `OPTION_NO_LONGER_FEASIBLE`。
4. 应用效果（`applyOption`）：改规则字段的效果调用 `commitBriefVersion(origin = "request_answer")`，它会 bump 并通过 `onConstraintsChanged` 关闭整组与旧 run；`disclose` 调用 `commitBriefVersion`（只改 disclosures，不 bump）后 `closeRequest`；`choose_package` 插入 `human_choice` 提案并 R-5；`decline` → `closeRequest(declined)`。
5. 若请求尚未被第 4 步间接关闭，`closeRequest(answered)`；`closeRequest` 计算剩余 blocking 请求并按 R-4 / R-6 迁移 run（HR-4）。
6. 事件：请求目标的 participant 事件含所选效果；房间事件只含 status（P10）。
