# 03 Convex schema v1（part4）：唯一性落点与不变量落点

> 分片清单见 part1。

## 3.14 唯一性落点（Convex 没有唯一索引，inputs/04 §1.6）

每条逻辑唯一性都"在唯一的写入口 mutation 内按索引先查后写"，依赖 OCC；并发正确性在真实部署上验证（16 RT-11 / AP-05）。

| 逻辑唯一键 | 索引 | 唯一写入口 |
| --- | --- | --- |
| `users.tokenIdentifier` | by_tokenIdentifier | `getOrCreateUser` |
| 每 (room, roleKey) 一个参与者 | by_room_and_roleKey | `rooms.create`、`invites.accept` |
| 每 (room, user) 一个参与者 | by_room_and_userId | 同上 |
| `invites.tokenHash` | by_tokenHash | `invites.storeInvite` |
| 每 (room, roleKey) 一个 open 邀请 | by_room_and_roleKey | `invites.storeInvite`（先 revoke 旧的） |
| 每参与者一个草稿 | by_participantId | `briefs.saveDraft` |
| (participant, version) 简报版本 | by_participantId_and_version | `briefs.confirm`（version = 最新 + 1） |
| (room, itemKey, version) 目录版本 | by_room_and_itemKey_and_version | `catalog.confirmItem`、`catalog.withdrawItem` |
| (room, version) 约束快照 | by_room_and_version | `bumpConstraints`（唯一修改 `rooms.constraintsVersion` 的函数） |
| (room, version) 提案 | by_room_and_version | `insertProposal`（唯一修改 `rooms.proposalSeq`） |
| (room, seq) run；每房间一个活跃 run | by_room_and_seq + `rooms.currentRunId` | `startRunTx` |
| 每 (run, round, role) 至多一个 open / completed turn | by_run_and_round | `startTurn` |
| (turn, attemptNo) | by_turnId_and_attemptNo | `scheduleAttempt` |
| `executions.operationKey`；每提案至多一次执行 | by_operationKey、by_proposalId | `executeIfReady` |
| 每房间一条 baseline 承诺 | by_room（kind 过滤，行数有界） | `ledger.recordBaseline` |
| 每次执行一条执行承诺 | by_executionId | `executeIfReady` |
| `systemState.key` | by_key | `getOrCreateSystemState` |
| `usageCounters` 行键 | by_scope_… | `incrementUsage` |
| 每参与者至多一个进行中的抽取任务 | by_participantId | `extraction.request` |

## 3.15 不变量落点（与 02 §2.6 的编号一致）

| 不变量 | 字段 / 函数落点 |
| --- | --- |
| I1 提案、决定、简报版本、目录版本、约束快照、执行记录不可变 | 3.1 第 6 条；IM-* 静态扫描 |
| I2 提案版本单调且唯一 | `rooms.proposalSeq` + `insertProposal` |
| I3 约束版本只经 `bumpConstraints` 改变，且每次都有快照行 | `constraintVersions` + 代码审查 |
| I4 审批绑定 (proposalId, constraintsVersion, termsKey) | `decisions` 字段 + G-D5 |
| I5 每提案至多执行一次；执行时预算不变式成立 | `executions.operationKey` + G-E2、G-E3 |
| I6 每房间至多一个活跃 run | `startRunTx` |
| I7 必需审批快照，且由不同 userId 满足 | `proposals.requiredApprovals` + G-E1 |
| I8 对他方可见的文本只由模板生成 | `events.payload` 受众约束 + 07 渲染器 |
| I9 金额为安全整数美分 | `assertCents` 于全部金额入口 |
| I10 可执行性实时计算，不存储 | `proposals` 无 status；`evaluateProposal` |
| I11 模型结果只在 G-A 守卫通过时生效 | `applyAttemptResult` |
| I12 每次模型请求一行用量 | `modelCalls` + `maxRetries: 0` |

I13–I20 的落点见 02 §2.6 第三列。
