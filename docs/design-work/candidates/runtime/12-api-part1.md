# 12 后端函数目录（part1）：约定、public mutation 与 action

> 分片：part1 约定与全部写入函数；part2 全部查询（含 `rooms.workspace` 的 DTO）、internal 函数、helper。
> 约定：业务函数不接受 userId / roleKey；public 函数第一行是 07 §7.1 的 auth helper；所有 public 函数声明 `args` 与 `returns` validator（inputs/04 §1.1）；错误为 `ConvexError({ code })`（07 §7.9）。"幂等"列说明重复调用的结果。

## 12.1 public mutation

| 函数（模块） | 参数 | 返回 | 鉴权 | 幂等 / 并发 |
| --- | --- | --- | --- | --- |
| `users.ensure` | — | `{ userId }` | 已登录 | 按 tokenIdentifier 先查后插，重复调用返回同一 id |
| `rooms.create` | `{ scenarioKey, title, goal, timeZone, myRoleKey }` | `{ roomId }` | 已登录 + `ROOM_CREATION_POLICY` | 非幂等（每次一个新房间）；客户端提交后禁用按钮 |
| `rooms.close` | `{ roomId }` | `{ ok: true }` | 创建者 | 已关闭则直接返回 |
| `invites.accept` | `{ token }` | `{ roomId, roleKey }` | 已登录 | 令牌单次使用；本人已是该房间参与者 → `ALREADY_PARTICIPANT`（若正是用这张邀请加入的则返回同一结果） |
| `invites.revoke` | `{ inviteId }` | `{ ok: true }` | 创建者 | 已撤销 / 已接受则无操作 |
| `briefs.saveDraft` | `{ roomId, draft, privateNotes, disclosures }` | `{ updatedAt }` | 本人参与者 | 覆盖写，最后写入者胜（草稿不生效） |
| `briefs.confirm` | `{ roomId, fields, privateNotes, disclosures, changeNote?, expectedLatestVersion }` | `{ briefVersionId, version, constraintsVersion, bumped, effect: "none" \| "reapproval" \| "renegotiating" \| "needs_input" }` | 本人参与者 | `expectedLatestVersion` 乐观并发（`STALE_VIEW`）；与上一版本完全相同（fields、备注、披露都相同）→ 返回最新版本，不插入（RA-D08"无改动不产生新版本"） |
| `catalog.confirmItem` | `{ roomId, itemKey, attributes, expectedLatestVersion }` | `{ catalogItemId, version, constraintsVersion }` | provider（`ownsCatalog`） | 同上；属性未变 → 不插入 |
| `catalog.withdrawItem` | `{ roomId, itemKey, expectedLatestVersion }` | `{ catalogItemId, version, constraintsVersion }` | provider | 已撤回 → 无操作 |
| `ledger.recordBaseline` | `{ roomId, amountCents, note? }` | `{ commitmentId, constraintsVersion }` | finance | 每房间一次：已存在 → `INVALID_STATE` |
| `runs.start` | `{ roomId, expectedConstraintsVersion }` | `{ runId, created: boolean }` | 参与者 | 已有活跃 run → 返回它（`created: false`）；并发由 OCC 串行化（RT-11） |
| `runs.resume` | `{ runId }` | `{ turnId }` | 参与者 | 只对当前活跃且 failed 的 run；`resumeCount ≤ 2`；重复调用：第二次看到 run 已 running → `INVALID_STATE` |
| `runs.requestRenegotiation` | `{ roomId, expectedConstraintsVersion }` | `{ runId }` | 参与者 | 当前 run 为 awaiting_approval 或最近 run 已执行；受房间调用预算约束 |
| `proposals.proposeManually` | `{ roomId, runId, candidateKey, expectedConstraintsVersion }` | `{ proposalId }` | provider（提议方角色） | run 为当前活跃且 ∈ failed / waiting_human / awaiting_approval；候选与当前提案相同 → 返回当前提案 |
| `decisions.decide` | `{ proposalId, decision, expectedConstraintsVersion, expectedTermsKey, reasonCode?, reasonNote?, reasonNoteAudience? }` | `recorded` / `unchanged` / `executed` / `renegotiating`（08 §8.3） | `requiredApprovals` 内的角色 | 同决定 → `unchanged`；已执行后重复 approve → 返回已有执行；最后两票并发 → 恰好一次执行 |
| `requests.answer` | `{ requestId, optionKey, note? }` | `{ status, deepLink?, runId? }` | 目标角色 | 已回答 → 返回已有回答；请求已 superseded → `INVALID_STATE`（界面刷新） |
| `tasks.updateStatus` | `{ taskId, status }` | `{ ok: true }` | 被指派角色 | 状态相同 → 无操作、无事件 |
| `extraction.request` | `{ roomId, text }` | `{ jobId }` | 本人参与者 | 已有进行中的任务 → 返回它 |

### 写入函数内部调用的 helper（在调用者的事务内执行）

| 写入函数 | helper 调用链 |
| --- | --- |
| `briefs.confirm` / `catalog.*` / `ledger.recordBaseline` | 插入不可变行 → `bumpConstraints`（ruleKey 变化时）→ `onConstraintsChanged` → `supersedeRunTx` → `startRunTx` |
| `runs.start` / `runs.requestRenegotiation` | `startRunTx` →（`startTurn` → `scheduleAttempt`）或 `planHumanRequests` |
| `runs.resume` | `startTurn` → `scheduleAttempt` |
| `proposals.proposeManually` | `insertProposal` → run 迁移（T8–T10）→ 取代 open 请求 |
| `decisions.decide` | 插入决定 → `executeIfReady`（→ `scenario.writeExecution` → `bumpConstraints`）或 `supersedeRunTx` → `startRunTx` |
| `requests.answer` | `share_answer` → `supersedeRunTx` → `startRunTx`；其他效果只记录 |

## 12.2 public action

| 函数 | 参数 | 返回 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| `invites.create` | `{ roomId, roleKey }` | `{ inviteId, token, expiresAt }` | 创建者（action 内先 `runQuery` 校验，internal mutation 内再校验一次） | 在 action 中用 Web Crypto 生成令牌与哈希（mutation 的随机数为确定性播种，不宜做安全令牌）；调用 `internal.invites.storeInvite`；明文令牌只在此返回一次。action 在断线时会失败且不重发（inputs/04 §1.11），用户重试即可：每次生成新令牌并撤销同角色旧的 open 邀请 |

只有这一个 public action。所有其他写入都是 mutation，以获得事务、OCC 与断线安全重发。
